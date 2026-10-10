# Architecture (Stage 1)

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

## Rules

- The shell is chosen by server config (`SHELL_FILE`), never by the client.
- Attaching to an existing session never spawns a process.
- Every request must pass the Host check (DNS rebinding) and, if it has an Origin, the Origin allow-list.
- Output replay buffer is capped at 256 KiB; session count is capped by `MAX_SESSIONS`.
- Server binds `127.0.0.1` by default.

## Session states

running (a client is attached) <-> disconnected (no client, shell alive) -> exited (removed from the manager).

## Known limitations

- No authentication or device pairing (Stage 2). Anyone who can reach the port and passes the Host/Origin check gets a shell.
- No WebSocket backpressure handling, no idle expiry, no heartbeat.
- A session only has one replay buffer; no scrollback persistence.
- Browser UI was smoke-tested through the proxy only, not exercised in a real browser by automated tests.
