import { createServer as createHttpServer, type IncomingMessage, type Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { clientMessageSchema } from '@rta/shared';
import express from 'express';
import { WebSocketServer, type WebSocket } from 'ws';
import { z } from 'zod';
import type { AuditLog } from '../audit/audit.js';
import type { Device, DeviceStore } from '../auth/devices.js';
import type { PairingCodes } from '../auth/pairing.js';
import type { Config } from '../config/index.js';
import type { SessionManager } from '../sessions/session-manager.js';

const COOKIE = 'rta_device';

const size = z.number().int().min(1).max(500);
const createBody = z.object({ cols: size.default(80), rows: size.default(24) });
const pairBody = z.object({ code: z.string().max(32), name: z.string().trim().min(1).max(50) });

export interface Deps {
  config: Config;
  sessions: SessionManager;
  devices: DeviceStore;
  pairing: PairingCodes;
  audit: AuditLog;
}

const tokenOf = (req: IncomingMessage): string | undefined =>
  req.headers.cookie
    ?.split(';')
    .map((c) => c.trim().split('='))
    .find(([name]) => name === COOKIE)?.[1];

export function createServer({ config, sessions, devices, pairing, audit }: Deps): Server {
  const hostnames = new Set(['127.0.0.1', 'localhost', '[::1]', config.HOST]);
  const ttlMs = config.DEVICE_TTL_DAYS * 86_400_000;

  // Blocks DNS rebinding (Host) and cross-site requests (Origin). Non-browser
  // clients send no Origin; a browser page always does.
  const isAllowed = (req: IncomingMessage): boolean => {
    const host = (req.headers.host ?? '').replace(/:\d+$/, '');
    const origin = req.headers.origin;
    return hostnames.has(host) && (!origin || config.ALLOWED_ORIGINS.includes(origin));
  };

  // Open WebSockets per device, so revoking a device cuts it off immediately.
  const sockets = new Map<string, Set<WebSocket>>();

  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => (isAllowed(req) ? next() : void res.sendStatus(403)));
  app.use(express.json({ limit: '1kb' }));

  app.get('/healthz', (_req, res) => void res.json({ status: 'ok' }));

  app.post('/pair', (req, res) => {
    const body = pairBody.safeParse(req.body);
    if (!body.success) return void res.sendStatus(400);
    if (!pairing.redeem(body.data.code)) {
      audit.record('pair_failed');
      return void res.sendStatus(401);
    }
    const { device, token } = devices.create(body.data.name);
    audit.record('pair_succeeded', device.id, device.name);
    res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'strict', maxAge: ttlMs });
    res.status(201).json({ deviceId: device.id });
  });

  // Everything below requires a paired, unrevoked device.
  app.use((req, res, next) => {
    const device = devices.authenticate(tokenOf(req));
    if (!device) {
      audit.record('auth_denied', null, req.path);
      return void res.sendStatus(401);
    }
    res.locals.device = device;
    next();
  });

  app.post('/sessions', (req, res) => {
    const body = createBody.safeParse(req.body ?? {});
    if (!body.success) return void res.sendStatus(400);
    const device = res.locals.device as Device;
    try {
      const s = sessions.create(device.id, body.data.cols, body.data.rows);
      audit.record('session_created', device.id, s.id);
      res.status(201).json({ id: s.id });
    } catch (e) {
      res.status(503).json({ error: e instanceof Error ? e.message : 'cannot start session' });
    }
  });

  app.get('/sessions/:id', (req, res) => {
    const s = sessions.getOwned(req.params.id, (res.locals.device as Device).id);
    return s ? void res.json({ id: s.id, state: s.state }) : void res.sendStatus(404);
  });

  app.delete('/sessions/:id', (req, res) => {
    const device = res.locals.device as Device;
    const s = sessions.getOwned(req.params.id, device.id);
    if (s) {
      audit.record('session_deleted', device.id, s.id);
      s.kill();
    }
    res.sendStatus(s ? 204 : 404);
  });

  app.get('/devices', (_req, res) => void res.json(devices.list()));

  // Any paired device may revoke any device (single-owner tool). Revoking also ends its sessions.
  app.delete('/devices/:id', (req, res) => {
    const id = req.params.id;
    if (!devices.revoke(id)) return void res.sendStatus(404);
    audit.record('device_revoked', (res.locals.device as Device).id, id);
    sessions.killOwnedBy(id);
    sockets.get(id)?.forEach((ws) => ws.close(4001, 'revoked'));
    res.sendStatus(204);
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: 128 * 1024 });
  const reject = (socket: Duplex, status: string) => socket.end(`HTTP/1.1 ${status}\r\n\r\n`);

  const server = createHttpServer(app);
  server.on('upgrade', (req, socket, head) => {
    if (!isAllowed(req)) return reject(socket, '403 Forbidden');
    const device = devices.authenticate(tokenOf(req));
    if (!device) {
      audit.record('auth_denied', null, 'ws');
      return reject(socket, '401 Unauthorized');
    }
    const id = /^\/ws\/([\w-]+)$/.exec(req.url ?? '')?.[1];
    const session = id ? sessions.getOwned(id, device.id) : undefined;
    if (!session) return reject(socket, '404 Not Found');

    wss.handleUpgrade(req, socket, head, (ws) => {
      const mine = sockets.get(device.id) ?? new Set<WebSocket>();
      sockets.set(device.id, mine.add(ws));
      const detach = session.attach((msg) => ws.send(JSON.stringify(msg)));
      ws.on('message', (raw) => {
        try {
          const msg = clientMessageSchema.safeParse(JSON.parse(raw.toString()));
          if (msg.success) session.handle(msg.data);
        } catch {
          // Malformed JSON from the client is ignored.
        }
      });
      ws.on('close', () => {
        mine.delete(ws);
        detach();
      });
    });
  });
  return server;
}
