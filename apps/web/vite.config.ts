import { defineConfig } from 'vite';

// The browser only talks to Vite; it forwards API and WebSocket traffic to the server.
export default defineConfig({
  server: {
    proxy: {
      '/sessions': 'http://127.0.0.1:8787',
      '/pair': 'http://127.0.0.1:8787',
      '/devices': 'http://127.0.0.1:8787',
      '/audit': 'http://127.0.0.1:8787',
      '/ws': { target: 'ws://127.0.0.1:8787', ws: true },
    },
  },
});
