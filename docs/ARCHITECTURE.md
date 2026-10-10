# Architecture (Stage 3)

Modular monolith, Node.js + TypeScript.

```
Browser (xterm.js) --HTTP POST /sessions--> create session
Browser (xterm.js) <--WebSocket /ws/:id--> Session <--> PtyHost (node-pty / ConPTY) <--> shell
```

- `apps/server/src/http/server.ts`: HTTP + WebSocket transport, Host/Origin checks, message validation.
- `apps/server/src/sessions/session-manager.ts`: owns sessions, replay buffer, limits, lifecycle.
- `apps/server/src/terminal/pty-host.ts`: the only file that imports node-pty.
- `apps/web`: plain TypeScript + xterm.js; Vite proxies `/sessions` and `/ws` to the server.
- `packages/shared`: WebSocket message schema (zod) used by both sides.

- `apps/server/src/auth`: pairing codes (in memory) and paired devices (SQLite, token stored as SHA-256 hash).
- `apps/server/src/audit`: append-only audit events. `apps/server/src/db`: SQLite via `node:sqlite` with versioned migrations.

## Pairing and access

1. Server prints an 8-digit single-use code (valid 2 min; 5 wrong guesses burn it). Only console access can create one.
2. Browser POSTs the code to `/pair`; the server sets an `HttpOnly; SameSite=Strict` cookie holding a random 256-bit token.
3. Every HTTP route except `/healthz` and `/pair`, and every WebSocket upgrade, requires a valid, unrevoked, unexpired device cookie (30 days, absolute).
4. A device sees only the sessions it created. Revoking a device kills its sessions and closes its open sockets.

## Rules

- The shell is chosen by server config (`SHELL_FILE`), never by the client.
- Attaching to an existing session never spawns a process.
- Every request must pass the Host check (DNS rebinding) and, if it has an Origin, the Origin allow-list.
- Output replay buffer is capped at 256 KiB; `MAX_SESSIONS` caps sessions; a session with no client is killed after `SESSION_IDLE_MINUTES`.
- Server binds `127.0.0.1` by default. A non-loopback `HOST` is refused at startup unless `ALLOW_INSECURE_BIND=true` (no TLS yet).
- Errors return a bare status code; stack traces are never sent to clients.

## Session states

- `running`: at least one client attached.
- `disconnected`: shell alive, no client; idle timer running, session killed after `SESSION_IDLE_MINUTES`.
- `exited`: shell ended (exit, crash, kill, idle expiry). The session is removed from the manager; a client that raced the exit gets an `exit` message.
- Spawn is synchronous, so there are no observable "created/starting" states. A spawn failure creates no session and returns 503, so there is no stored "failed" state either.

## Reliability

- Reconnect: the browser retries every second while the session exists (checked via `GET /sessions/:id`); attaching never spawns, and the replay buffer repaints the screen after a `term.reset()`.
- Dead peers: every socket is pinged every `HEARTBEAT_SECONDS` (15); no pong by the next tick -> terminated -> session becomes `disconnected`.
- Slow peers: a socket with more than 1 MiB unsent is terminated (not buffered). The shell keeps running and the client can reconnect.
- Several clients may attach to one session; it is `disconnected` only after the last leaves.
- Server hard-kill: on this Windows machine the shell and its children exit with the server (measured with `ping -t`).

## Threat model (Stage 2)

| Threat                                    | Mitigation                                         | Status |
| ----------------------------------------- | -------------------------------------------------- | ------ |
| Website opens WebSocket/POST to localhost | Origin allow-list, SameSite=Strict cookie          | tested |
| DNS rebinding                             | Host hostname allow-list                           | tested |
| Guessing the pairing code                 | single use, 2 min, 5 attempts                      | tested |
| Stolen database file                      | only token hashes stored                           | tested |
| Stolen/lost phone                         | revoke from another paired device; 30-day expiry   | tested |
| One device reading another's session      | per-device ownership                               | tested |
| Resource exhaustion                       | session cap, buffer cap, idle kill, payload limits | tested |

## Known limitations

- No TLS: the cookie is not `Secure`, so this is safe only on loopback. Needed before any LAN/remote use.
- Any local program on this PC can connect without a browser (no Origin) once it has a cookie; it still needs a valid token, but malware running as the same user can read the console or database. Out of scope.
- Any paired device can revoke any other (single-owner tool). No separate admin role.
- Audit log has no retention limit yet, and `auth_denied` can grow under scanning.
- `node:sqlite` is experimental in Node 22 (prints a warning); Postgres migration is planned.
- Open sockets re-check their device on each heartbeat (15 s), so expiry or revocation ends them within that window. Deleting a cookie in the browser does not end an open session; revoke the device instead.
- No login rate limit beyond the pairing code and no input rate limit. The 256 KiB replay buffer is not terminal-state aware, so a replay can start mid escape sequence.
