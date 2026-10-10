import { mkdtempSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { ServerMessage } from '@rta/shared';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { AuditLog } from '../audit/audit.js';
import { DeviceStore } from '../auth/devices.js';
import { PairingCodes } from '../auth/pairing.js';
import { loadConfig } from '../config/index.js';
import { openDb } from '../db/db.js';
import { SessionManager } from '../sessions/session-manager.js';
import { spawnPty } from '../terminal/pty-host.js';
import { waitFor } from '../test-utils.js';
import { createServer } from './server.js';

const ORIGIN = 'http://localhost:5173';
const config = loadConfig({ ALLOWED_ORIGINS: ORIGIN, SHELL_FILE: 'powershell.exe' });
let server: http.Server;
let sessions: SessionManager;
let pairing: PairingCodes;
let audit: AuditLog;
let base: string;

async function start(
  deviceTtlMs = 86_400_000,
  heartbeatSeconds = 15,
  env: Record<string, string> = {},
  webDir?: string,
): Promise<void> {
  const db = openDb(':memory:');
  audit = new AuditLog(db);
  pairing = new PairingCodes();
  sessions = new SessionManager((c, r) => spawnPty(config.SHELL_FILE, c, r), {
    maxSessions: 3,
    idleMs: 60_000,
  });
  const devices = new DeviceStore(db, deviceTtlMs);
  const cfg = {
    ...loadConfig({ ALLOWED_ORIGINS: ORIGIN, SHELL_FILE: 'powershell.exe', ...env }),
    HEARTBEAT_SECONDS: heartbeatSeconds,
  };
  server = createServer({ config: cfg, sessions, devices, pairing, audit, webDir });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `127.0.0.1:${(server.address() as AddressInfo).port}`;
}

afterEach(async () => {
  sessions.shutdown();
  await new Promise((r) => server.close(r));
});

interface CallInit {
  method?: string;
  cookie?: string;
  origin?: string;
  body?: unknown;
}

const call = (path: string, init: CallInit = {}) =>
  fetch(`http://${base}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      'content-type': 'application/json',
      origin: init.origin ?? ORIGIN,
      ...(init.cookie ? { cookie: init.cookie } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });

/** Pairs a new "browser"; returns its cookie header value and device id. */
async function pair(name = 'phone'): Promise<{ cookie: string; id: string }> {
  const res = await call('/pair', { method: 'POST', body: { code: pairing.issue(), name } });
  expect(res.status).toBe(201);
  const { deviceId } = (await res.json()) as { deviceId: string };
  return { cookie: res.headers.get('set-cookie')!.split(';')[0]!, id: deviceId };
}

async function newSession(cookie: string): Promise<string> {
  const res = await call('/sessions', { method: 'POST', cookie, body: {} });
  return ((await res.json()) as { id: string }).id;
}

const wsStatus = (path: string, headers: Record<string, string>) =>
  new Promise<number | undefined>((resolve) => {
    const ws = new WebSocket(`ws://${base}${path}`, { headers });
    ws.on('unexpected-response', (_q, res) => resolve(res.statusCode));
    ws.on('open', () => resolve(undefined));
    ws.on('error', () => {});
  });

describe('origin and host checks', () => {
  it('rejects a foreign Origin and a foreign Host before anything else', async () => {
    await start();
    expect((await call('/healthz', { origin: 'http://evil.example' })).status).toBe(403);
    expect(await wsStatus('/ws/x', { origin: 'http://evil.example' })).toBe(403);

    const status = await new Promise((r) =>
      http
        .get(`http://${base}/healthz`, { headers: { host: 'evil.example' } }, (res) =>
          r(res.statusCode),
        )
        .on('error', () => r(undefined)),
    );
    expect(status).toBe(403);
  });
});

describe('static web client', () => {
  it('serves the built page without login while the API stays protected', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rta-web-'));
    writeFileSync(join(dir, 'index.html'), '<h1>pairing page</h1>');
    await start(86_400_000, 15, {}, dir);

    const page = await call('/');
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('pairing page');
    expect((await call('/sessions', { method: 'POST', body: {} })).status).toBe(401);
    expect((await call('/', { origin: 'http://evil.example' })).status).toBe(403);
  });
});

describe('behind an HTTPS proxy', () => {
  const hostStatus = (host: string) =>
    new Promise((r) =>
      http
        .get(`http://${base}/healthz`, { headers: { host } }, (res) => r(res.statusCode))
        .on('error', () => r(undefined)),
    );

  it('accepts only the configured extra hostnames', async () => {
    await start(86_400_000, 15, { ALLOWED_HOSTS: 'Pc.Tailnet.ts.net' });
    expect(await hostStatus('pc.tailnet.ts.net')).toBe(200);
    expect(await hostStatus('pc.tailnet.ts.net:443')).toBe(200);
    expect(await hostStatus('evil.example')).toBe(403);
  });

  it('marks the device cookie Secure only when configured', async () => {
    const cookieFor = async (env: Record<string, string>) => {
      await start(86_400_000, 15, env);
      const body = { code: pairing.issue(), name: 'phone' };
      const res = await call('/pair', { method: 'POST', body });
      const cookie = res.headers.get('set-cookie')!;
      sessions.shutdown();
      await new Promise((r) => server.close(r));
      return cookie;
    };
    expect(await cookieFor({ COOKIE_SECURE: 'true' })).toMatch(/; Secure/i);
    expect(await cookieFor({})).not.toMatch(/; Secure/i);
  });
});

describe('pairing and authentication', () => {
  it('serves /healthz without authentication', async () => {
    await start();
    expect(await (await call('/healthz')).json()).toEqual({ status: 'ok' });
  });

  it('refuses everything else without a valid device cookie', async () => {
    await start();
    expect((await call('/sessions', { method: 'POST', body: {} })).status).toBe(401);
    expect((await call('/devices')).status).toBe(401);
    const forged = { method: 'POST', cookie: 'rta_device=forged', body: {} };
    expect((await call('/sessions', forged)).status).toBe(401);
    expect(await wsStatus('/ws/x', { origin: ORIGIN })).toBe(401);
  });

  it('rejects wrong and reused pairing codes and audits them', async () => {
    await start();
    const code = pairing.issue();
    const wrong = code === '00000000' ? '11111111' : '00000000';
    const attempt = (c: string) => call('/pair', { method: 'POST', body: { code: c, name: 'x' } });
    expect((await attempt(wrong)).status).toBe(401);
    expect((await attempt(code)).status).toBe(201);
    expect((await attempt(code)).status).toBe(401);
    expect(audit.recent().map((e) => e.type)).toEqual([
      'pair_failed',
      'pair_succeeded',
      'pair_failed',
    ]);
  });

  it('answers malformed JSON with 400 and no stack trace', async () => {
    await start();
    const res = await fetch(`http://${base}/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN },
      body: '{bad',
    });
    expect(res.status).toBe(400);
    expect(await res.text()).not.toMatch(/node_modules|SyntaxError/);
  });

  it('sets an HttpOnly, SameSite=Strict cookie', async () => {
    await start();
    const body = { code: pairing.issue(), name: 'phone' };
    const cookie = (await call('/pair', { method: 'POST', body })).headers.get('set-cookie')!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
  });
});

describe('sessions', () => {
  it('returns 404 for an unknown session', async () => {
    await start();
    const { cookie } = await pair();
    expect(await wsStatus('/ws/nope', { origin: ORIGIN, cookie })).toBe(404);
  });

  it('isolates sessions between devices', async () => {
    await start();
    const phone = await pair('phone');
    const laptop = await pair('laptop');
    const id = await newSession(phone.cookie);
    expect((await call(`/sessions/${id}`, { cookie: phone.cookie })).status).toBe(200);
    expect((await call(`/sessions/${id}`, { cookie: laptop.cookie })).status).toBe(404);
    expect(await wsStatus(`/ws/${id}`, { origin: ORIGIN, cookie: laptop.cookie })).toBe(404);
    const del = { method: 'DELETE', cookie: laptop.cookie };
    expect((await call(`/sessions/${id}`, del)).status).toBe(404);
  });

  it('lists devices with a current flag and serves a bounded audit log, both authenticated', async () => {
    await start();
    expect((await call('/audit')).status).toBe(401);

    const phone = await pair('phone');
    const laptop = await pair('laptop');
    const list = (await (await call('/devices', { cookie: phone.cookie })).json()) as Array<{
      name: string;
      current: boolean;
    }>;
    expect(list.map((d) => [d.name, d.current])).toEqual([
      ['phone', true],
      ['laptop', false],
    ]);

    const events = (await (
      await call('/audit?limit=1', { cookie: laptop.cookie })
    ).json()) as Array<{
      type: string;
    }>;
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('pair_succeeded');
  });

  it('revoking a device ends its sockets and sessions and blocks its cookie', async () => {
    await start();
    const phone = await pair('phone');
    const laptop = await pair('laptop');
    const id = await newSession(phone.cookie);

    const headers = { origin: ORIGIN, cookie: phone.cookie };
    const ws = new WebSocket(`ws://${base}/ws/${id}`, { headers });
    await new Promise((r) => ws.once('open', r));
    const closed = new Promise<number>((r) => ws.once('close', r));

    const revoke = { method: 'DELETE', cookie: laptop.cookie };
    expect((await call(`/devices/${phone.id}`, revoke)).status).toBe(204);

    expect(await closed).toBe(4001);
    const create = { method: 'POST', cookie: phone.cookie, body: {} };
    expect((await call('/sessions', create)).status).toBe(401);
    expect(await wsStatus(`/ws/${id}`, headers)).toBe(401);
    await waitFor(() => sessions.getOwned(id, phone.id) === undefined);
    const revoked = audit.recent().find((e) => e.type === 'device_revoked');
    expect(revoked).toMatchObject({ deviceId: laptop.id, detail: phone.id });
  });

  it('closes an open socket once its device token expires', async () => {
    await start(400, 0.1);
    const { cookie } = await pair();
    const id = await newSession(cookie);
    const ws = new WebSocket(`ws://${base}/ws/${id}`, { headers: { origin: ORIGIN, cookie } });
    await new Promise((r) => ws.once('open', r));
    const code = await new Promise<number>((r) => ws.once('close', r));
    expect(code).toBe(4001);
  });

  it('drops a client that stops answering pings, leaving the session alive', async () => {
    await start(86_400_000, 0.1);
    const { cookie, id: deviceId } = await pair();
    const id = await newSession(cookie);
    const headers = { origin: ORIGIN, cookie };
    const ws = new WebSocket(`ws://${base}/ws/${id}`, { headers, autoPong: false });
    await new Promise((r) => ws.once('open', r));
    await new Promise((r) => ws.once('close', r));
    await waitFor(() => sessions.getOwned(id, deviceId)?.state === 'disconnected');
  });

  it('lets two clients watch one session and only disconnects after the last leaves', async () => {
    await start();
    const { cookie, id: deviceId } = await pair();
    const id = await newSession(cookie);
    const open = async () => {
      const ws = new WebSocket(`ws://${base}/ws/${id}`, { headers: { origin: ORIGIN, cookie } });
      await new Promise((r) => ws.once('open', r));
      return ws;
    };
    const [a, b] = [await open(), await open()];
    a.close();
    await new Promise((r) => a.once('close', r));
    await new Promise((r) => setTimeout(r, 100));
    expect(sessions.getOwned(id, deviceId)?.state).toBe('running');
    b.close();
    await waitFor(() => sessions.getOwned(id, deviceId)?.state === 'disconnected');
  });

  it.runIf(process.platform === 'win32')(
    'drops a slow client instead of buffering unboundedly; the shell survives',
    async () => {
      await start();
      const { cookie, id: deviceId } = await pair();
      const id = await newSession(cookie);
      const ws = new WebSocket(`ws://${base}/ws/${id}`, { headers: { origin: ORIGIN, cookie } });
      await new Promise((r) => ws.once('open', r));
      (ws as unknown as { _socket: { pause(): void } })._socket.pause(); // stop reading
      const flood = "1..120000 | ForEach-Object { 'x' * 100 }" + String.fromCharCode(13);
      ws.send(JSON.stringify({ type: 'input', data: flood }));
      await waitFor(() => sessions.getOwned(id, deviceId)?.state === 'disconnected', 20_000);
      expect(sessions.getOwned(id, deviceId)).toBeDefined();
    },
    30_000,
  );

  it.runIf(process.platform === 'win32')(
    'runs a real shell over WebSocket and reattaches without a second process',
    async () => {
      await start();
      const { cookie, id: deviceId } = await pair();
      const id = await newSession(cookie);

      const connect = async () => {
        const out: ServerMessage[] = [];
        const ws = new WebSocket(`ws://${base}/ws/${id}`, { headers: { origin: ORIGIN, cookie } });
        ws.on('message', (m) => out.push(JSON.parse(m.toString())));
        await new Promise((r) => ws.once('open', r));
        return { ws, text: () => out.map((m) => (m.type === 'output' ? m.data : '')).join('') };
      };

      const first = await connect();
      first.ws.send(JSON.stringify({ type: 'input', data: 'echo marker-123\r' }));
      await waitFor(() => first.text().includes('marker-123'));
      first.ws.close();
      await waitFor(() => sessions.getOwned(id, deviceId)?.state === 'disconnected');

      const second = await connect();
      await waitFor(() => second.text().includes('marker-123'));
      second.ws.close();

      expect((await call(`/sessions/${id}`, { method: 'DELETE', cookie })).status).toBe(204);
      await waitFor(() => sessions.getOwned(id, deviceId) === undefined);
    },
  );
});
