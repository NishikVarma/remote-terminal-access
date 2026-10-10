# remote-terminal-access

Self-hosted, browser-based remote terminal for your own machine (initial target: Windows dev PC, accessed from a phone browser). AI troubleshooting is a later, optional layer.

**Status: Stage 2 (device pairing).** Loopback only. A browser must be paired with a one-time code printed in the server console (type `pair` + Enter for a new one). Do not expose to a network yet: no TLS, see `docs/ARCHITECTURE.md`.

## Requirements

Node >= 22, npm >= 10. Windows 10 1809+ (ConPTY).

## Commands

```
npm install
npm run typecheck | lint | test | build
npm run dev:server    # http://127.0.0.1:8787
npm run dev:web       # open http://localhost:5173 (must be localhost, see ALLOWED_ORIGINS)
```

Copy `.env.example` to `.env` for configuration. Never commit `.env`.

See `docs/ARCHITECTURE.md`, `docs/DEPLOYMENT.md` (phone access over HTTPS) and `docs/ROADMAP.md`.
