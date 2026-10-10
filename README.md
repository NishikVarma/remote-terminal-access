# remote-terminal-access

Self-hosted, browser-based terminal for your own computer. Open a real shell on your Windows PC
from a phone or another browser, with device pairing, per-device session isolation, reconnect
handling and an audit log.

**Status:** working on Windows (ConPTY). Loopback-only by default. Phone access over HTTPS through a
private-network proxy is documented in [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) and the server side
is tested; the proxy flow itself is not covered by this repo's tests.

## What it does

- Real interactive PowerShell in the browser (xterm.js + node-pty).
- Pairing: the server prints a one-time code on the PC console; the browser exchanges it for a
  device cookie. Tokens are stored hashed.
- Sessions survive refreshes and dropped connections; a reconnect never starts a second shell.
- Device list with revoke, audit log, idle-session expiry, bounded buffers and retention.
- Touch toolbar (Esc, Tab, Ctrl, arrows) for phone keyboards.

## Requirements

Node >= 22, npm >= 10, Windows 10 1809+ (ConPTY).

## Quick start

```
npm install
npm run build
npm run start -w @rta/server     # prints http://127.0.0.1:8787 and a pairing code
```

Open http://localhost:8787, enter the pairing code shown in the server console. Type `pair` + Enter
in that console for a new code.

Development with hot reload:

```
npm run dev:server               # server on 127.0.0.1:8787
npm run dev:web                  # open http://localhost:5173 (must be "localhost", see ALLOWED_ORIGINS)
```

## Configuration

Copy `.env.example` to `.env` at the repo root; `npm run start` and `npm run dev` load it
automatically. Never commit `.env`. All settings are listed in `.env.example` and explained in
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

## Checks

```
npm run typecheck && npm run lint && npm run format:check && npm test && npm run build
```

CI runs the same steps on Windows (the PTY tests need ConPTY).

## Security notes

- There is no TLS in the app. It binds `127.0.0.1` and refuses any other address unless
  `ALLOW_INSECURE_BIND=true`. Use a TLS-terminating private-network proxy for phone access.
- A paired browser has full shell access to the PC. Treat pairing codes and the device list as
  sensitive; revoke devices you no longer use.
- Any paired device can revoke any other and read the audit log (single-owner design).
- See the threat model and known limitations in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Layout

```
apps/server     Express + ws, sessions, auth, audit, SQLite (node:sqlite)
apps/web        xterm.js client (plain TypeScript, Vite)
packages/shared message schemas shared by both
docs/           architecture, deployment, roadmap
```
