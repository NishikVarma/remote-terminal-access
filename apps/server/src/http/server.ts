import { createServer as createHttpServer, type IncomingMessage, type Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { clientMessageSchema } from '@rta/shared';
import express from 'express';
import { WebSocketServer } from 'ws';
import { z } from 'zod';
import type { Config } from '../config/index.js';
import type { SessionManager } from '../sessions/session-manager.js';

const createBody = z.object({
  cols: z.number().int().min(1).max(500).default(80),
  rows: z.number().int().min(1).max(500).default(24),
});

export function createServer(config: Config, sessions: SessionManager): Server {
  const hostnames = new Set(['127.0.0.1', 'localhost', '[::1]', config.HOST]);

  // Blocks DNS rebinding (Host) and cross-site requests (Origin). Non-browser
  // clients send no Origin; a browser page always does.
  const isAllowed = (req: IncomingMessage): boolean => {
    const host = (req.headers.host ?? '').replace(/:\d+$/, '');
    const origin = req.headers.origin;
    return hostnames.has(host) && (!origin || config.ALLOWED_ORIGINS.includes(origin));
  };

  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => (isAllowed(req) ? next() : void res.sendStatus(403)));
  app.use(express.json({ limit: '1kb' }));

  app.get('/healthz', (_req, res) => void res.json({ status: 'ok' }));

  app.post('/sessions', (req, res) => {
    const body = createBody.safeParse(req.body ?? {});
    if (!body.success) return void res.sendStatus(400);
    try {
      res.status(201).json({ id: sessions.create(body.data.cols, body.data.rows).id });
    } catch (e) {
      res.status(503).json({ error: e instanceof Error ? e.message : 'cannot start session' });
    }
  });

  app.get('/sessions/:id', (req, res) => {
    const s = sessions.get(req.params.id);
    return s ? void res.json({ id: s.id, state: s.state }) : void res.sendStatus(404);
  });

  app.delete('/sessions/:id', (req, res) => {
    const s = sessions.get(req.params.id);
    s?.kill();
    res.sendStatus(s ? 204 : 404);
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: 128 * 1024 });
  const reject = (socket: Duplex, status: string) => socket.end(`HTTP/1.1 ${status}\r\n\r\n`);

  const server = createHttpServer(app);
  server.on('upgrade', (req, socket, head) => {
    if (!isAllowed(req)) return reject(socket, '403 Forbidden');
    const id = /^\/ws\/([\w-]+)$/.exec(req.url ?? '')?.[1];
    const session = id ? sessions.get(id) : undefined;
    if (!session) return reject(socket, '404 Not Found');

    wss.handleUpgrade(req, socket, head, (ws) => {
      const detach = session.attach((msg) => ws.send(JSON.stringify(msg)));
      ws.on('message', (raw) => {
        try {
          const msg = clientMessageSchema.safeParse(JSON.parse(raw.toString()));
          if (msg.success) session.handle(msg.data);
        } catch {
          // Malformed JSON from the client is ignored.
        }
      });
      ws.on('close', detach);
    });
  });
  return server;
}
