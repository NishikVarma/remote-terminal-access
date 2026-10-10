import { z } from 'zod';

const defaultShell =
  process.platform === 'win32' ? 'powershell.exe' : (process.env.SHELL ?? '/bin/sh');

const schema = z.object({
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
  // How often open sockets re-validate their device (expiry, revocation).
  AUTH_RECHECK_SECONDS: z.coerce.number().positive().default(30),
  DB_PATH: z.string().default('data/rta.db'),
});

export type Config = z.infer<typeof schema>;

export const loadConfig = (env: NodeJS.ProcessEnv = process.env): Config => schema.parse(env);
