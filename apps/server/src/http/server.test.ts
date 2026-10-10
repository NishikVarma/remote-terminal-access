import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { ServerMessage } from '@rta/shared';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { loadConfig } from '../config/index.js';
import { SessionManager } from '../sessions/session-manager.js';
import { spawnPty } from '../terminal/pty-host.js';
import { waitFor } from '../test-utils.js';
import { createServer } from './server.js';

const ORIGIN = 'http://localhost:5173';
const config = loadConfig({ ALLOWED_ORIGINS: ORIGIN, SHELL_FILE: 'powershell.exe' });
let server: http.Server;
let sessions: SessionManager;

async function start(): Promise<string> {
  sessions = new SessionManager((c, r) => spawnPty(config.SHELL_FILE, c, r), 3);
  server = createServer(config, sessions);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return `127.0.0.1:${(server.address() as AddressInfo).port}`;
}

afterEach(async () => {
  sessions.shutdown();
  await new Promise((r) => server.close(r));
});

const post = (base: string, origin?: string) =>
  fetch(`http://${base}/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) },
    body: '{}',
  });

describe('HTTP + WebSocket server', () => {
  it('serves /healthz', async () => {
    const base = await start();
    const res = await fetch(`http://${base}/healthz`);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('rejects requests from a foreign Origin and a foreign Host', async () => {
    const base = await start();
    expect((await post(base, 'http://evil.example')).status).toBe(403);

    const ws = new WebSocket(`ws://${base}/ws/anything`, { origin: 'http://evil.example' });
    const status = await new Promise((r) =>
      ws.on('unexpected-response', (_q, res) => r(res.statusCode)),
    );
    expect(status).toBe(403);

    const status2 = await new Promise((r) =>
      http
        .get(`http://${base}/healthz`, { headers: { host: 'evil.example' } }, (res) =>
          r(res.statusCode),
        )
        .on('error', () => r(undefined)),
    );
    expect(status2).toBe(403);
  });

  it('returns 404 for an unknown session', async () => {
    const base = await start();
    const ws = new WebSocket(`ws://${base}/ws/nope`, { origin: ORIGIN });
    const status = await new Promise((r) =>
      ws.on('unexpected-response', (_q, res) => r(res.statusCode)),
    );
    expect(status).toBe(404);
  });

  it.runIf(process.platform === 'win32')(
    'runs a real shell over WebSocket and reattaches without a second process',
    async () => {
      const base = await start();
      const { id } = (await (await post(base, ORIGIN)).json()) as { id: string };

      const connect = async () => {
        const out: ServerMessage[] = [];
        const ws = new WebSocket(`ws://${base}/ws/${id}`, { origin: ORIGIN });
        ws.on('message', (m) => out.push(JSON.parse(m.toString())));
        await new Promise((r) => ws.once('open', r));
        return { ws, text: () => out.map((m) => (m.type === 'output' ? m.data : '')).join('') };
      };

      const first = await connect();
      first.ws.send(JSON.stringify({ type: 'input', data: 'echo marker-123\r' }));
      await waitFor(() => first.text().includes('marker-123'));
      first.ws.close();
      await waitFor(() => sessions.get(id)?.state === 'disconnected');

      const second = await connect();
      await waitFor(() => second.text().includes('marker-123')); // replayed from buffer
      second.ws.close();

      expect((await fetch(`http://${base}/sessions/${id}`)).status).toBe(200);
      expect((await fetch(`http://${base}/sessions/${id}`, { method: 'DELETE' })).status).toBe(204);
      await waitFor(() => sessions.get(id) === undefined);
    },
  );
});
