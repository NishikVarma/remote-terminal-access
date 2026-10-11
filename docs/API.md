# HTTP and WebSocket API

The contract the browser client and companion apps rely on. Everything except `/healthz` and `/pair`
needs the device cookie issued by `/pair`. Every request must pass the Host and Origin checks (see
`ALLOWED_HOSTS` and `ALLOWED_ORIGINS` in `docs/DEPLOYMENT.md`); a browser page from another origin is
refused with 403.

## Pairing

| Method | Path       | Body                                  | Result                                                            |
| ------ | ---------- | ------------------------------------- | ----------------------------------------------------------------- |
| POST   | `/pair`    | `{ "code": "12345678", "name": "…" }` | 201 `{ deviceId }` and an `rta_device` cookie; 401 for a bad code |
| GET    | `/healthz` | -                                     | 200 `{ "status": "ok" }`                                          |

The code is printed on the engine's console (type `pair` there for a new one). It is single use, valid
for two minutes, and burned after five wrong attempts.

## Sessions

| Method | Path            | Body                         | Result                                                         |
| ------ | --------------- | ---------------------------- | -------------------------------------------------------------- |
| POST   | `/sessions`     | `{ "cols": 80, "rows": 24 }` | 201 `{ id }`; 503 when the session limit is reached            |
| GET    | `/sessions/:id` | -                            | 200 `{ id, state }`; 404 if unknown or owned by another device |
| DELETE | `/sessions/:id` | -                            | 204 (the shell is terminated); 404                             |

A device can only see sessions it created. `state` is `running` (a client is attached), `disconnected`
(shell alive, no client) or, briefly, `exited`.

## Devices and audit

| Method | Path           | Result                                                                      |
| ------ | -------------- | --------------------------------------------------------------------------- |
| GET    | `/devices`     | paired devices, each with `current: true` for the caller                    |
| DELETE | `/devices/:id` | 204; revokes the device, ends its sessions and closes its sockets with 4001 |
| GET    | `/audit?limit` | newest-first audit events, `limit` 1 to 200 (default 50)                    |

## Terminal WebSocket: `GET /ws/:id` (upgrade)

Refused during the upgrade with 403 (Origin/Host), 401 (no valid cookie) or 404 (no such session of
yours). The engine pings every `HEARTBEAT_SECONDS`; a client that stops answering is dropped and the
session stays alive for reconnection. On every attach the engine first replays up to 256 KiB of recent
output.

Client to engine (JSON text frames, validated; invalid frames are ignored):

```
{ "type": "input",  "data": "<up to 65536 characters>" }
{ "type": "resize", "cols": 1..500, "rows": 1..500 }
```

Engine to client:

```
{ "type": "output", "data": "<terminal bytes as text>" }
{ "type": "exit",   "exitCode": 0 }
```

Close codes: `4001` the device was revoked or its token expired (show the pairing form). An abnormal
close (1006) means the network dropped or the client was too slow (more than 1 MiB unsent), so
reconnect to the same session id.

## Notes for companion apps

- The browser's cookie and `Origin` are the only credentials. A server in the middle (for example a
  same-origin reverse proxy) must forward `Cookie`, `Origin` and `Set-Cookie` unchanged and send the
  engine's own `Host`.
- Use the engine's own origin allow-list: add the proxy's public origin to `ALLOWED_ORIGINS`.
- Commands are plain keystrokes: there is no separate "run command" endpoint, by design.
