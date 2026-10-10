# remote-terminal-access

Self-hosted, browser-based remote terminal for your own machine (initial target: Windows dev PC, accessed from a phone browser). AI troubleshooting is a later, optional layer.

**Status: Stage 0 (skeleton).** No terminal UI yet; no authentication yet. Do not expose to a network.

## Requirements

Node >= 22, npm >= 10. Windows 10 1809+ (ConPTY).

## Commands

```
npm install
npm run typecheck | lint | test | build
npm run dev:server    # http://127.0.0.1:8787/healthz
npm run dev:web
```

Copy `.env.example` to `.env` for configuration. Never commit `.env`.

See `docs/ARCHITECTURE.md` and `docs/ROADMAP.md`.
