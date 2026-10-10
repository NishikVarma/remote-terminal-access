import { z } from 'zod';

const defaultShell =
  process.platform === 'win32' ? 'powershell.exe' : (process.env.SHELL ?? '/bin/sh');

const loopback = new Set(['127.0.0.1', 'localhost', '::1']);

const schema = z
  .object({
    HOST: z.string().default('127.0.0.1'),
    PORT: z.coerce.number().int().min(1).max(65535).default(8787),
    // Browser origins allowed to talk to the server. Wildcards are rejected on purpose.
    ALLOWED_ORIGINS: z
      .string()
      .default('http://localhost:5173')
      .transform((s) =>
        s
          .split(',')
          .map((o) => o.trim())
          .filter(Boolean),
      )
      .refine((list) => !list.includes('*'), 'wildcard origin is not allowed'),
    // Chosen by the operator, never by the client.
    SHELL_FILE: z.string().default(defaultShell),
    MAX_SESSIONS: z.coerce.number().int().min(1).default(5),
    SESSION_IDLE_MINUTES: z.coerce.number().min(1).default(30),
    DEVICE_TTL_DAYS: z.coerce.number().min(1).default(30),
    // Each open socket is pinged and its device re-validated this often.
    HEARTBEAT_SECONDS: z.coerce.number().positive().default(15),
    DB_PATH: z.string().default('data/rta.db'),
    // There is no TLS yet, so binding beyond loopback exposes the pairing code and cookie.
    ALLOW_INSECURE_BIND: z.enum(['true', 'false']).default('false'),
    // Extra hostnames (no port) the server answers to, e.g. a Tailscale name behind `tailscale serve`.
    ALLOWED_HOSTS: z
      .string()
      .default('')
      .transform((s) =>
        s
          .split(',')
          .map((h) => h.trim().toLowerCase())
          .filter(Boolean),
      ),
    // Set true when users reach the server over HTTPS (through a TLS-terminating proxy).
    COOKIE_SECURE: z.enum(['true', 'false']).default('false'),
    AUDIT_RETENTION_DAYS: z.coerce.number().positive().default(90),
    AUDIT_MAX_ROWS: z.coerce.number().int().min(100).default(10_000),
  })
  .refine((c) => loopback.has(c.HOST) || c.ALLOW_INSECURE_BIND === 'true', {
    message: 'HOST is not loopback; set ALLOW_INSECURE_BIND=true to accept plain-HTTP exposure',
    path: ['HOST'],
  });

export type Config = z.infer<typeof schema>;

export const loadConfig = (env: NodeJS.ProcessEnv = process.env): Config => schema.parse(env);
