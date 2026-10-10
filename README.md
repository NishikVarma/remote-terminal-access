# remote-terminal-access

Self-hosted, browser-based remote terminal for your own machine (initial target: Windows dev PC, accessed from a phone browser). AI troubleshooting is a later, optional layer.

**Status: Stage 1 (local terminal MVP).** Works in a browser on this machine. **No authentication yet** - loopback only, never expose to a network.

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

See `docs/ARCHITECTURE.md` and `docs/ROADMAP.md`.
