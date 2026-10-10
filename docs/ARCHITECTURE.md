# Architecture (Stage 0)

Modular monolith, Node.js + TypeScript.

```
Browser (xterm.js) <-- HTTP/WS --> Server (Express + ws)
                                     |-- sessions/  lifecycle state machine (Stage 1+)
                                     |-- terminal/  PtyHost interface -> node-pty (ConPTY)
                                     |-- audit/     security events (Stage 2)
```

- `apps/server`: HTTP/WS transport, config, terminal/session management.
- `apps/web`: React + Vite + xterm.js client.
- `packages/shared`: types shared by client and server.

## Rules

- Only `terminal/pty-host.ts` imports node-pty (isolates platform behaviour).
- The terminal works without any AI module; AI never authorizes its own actions.
- Server binds `127.0.0.1` by default. Local-network mode first; remote relay (outbound agent connection) is a later, separate design.

## Session states

created -> starting -> running <-> disconnected -> exited | failed

## Known limitations (Stage 0)

No authentication, no WebSocket endpoint, no session manager yet.
