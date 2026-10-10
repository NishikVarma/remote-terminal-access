import { createInterface } from 'node:readline';
import { ZodError } from 'zod';
import { AuditLog } from './audit/audit.js';
import { DeviceStore } from './auth/devices.js';
import { PairingCodes } from './auth/pairing.js';
import { loadConfig } from './config/index.js';
import { openDb } from './db/db.js';
import { createServer } from './http/server.js';
import { SessionManager } from './sessions/session-manager.js';
import { spawnPty } from './terminal/pty-host.js';

function configOrExit() {
  try {
    return loadConfig();
  } catch (e) {
    if (!(e instanceof ZodError)) throw e;
    const problems = e.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    console.error(`Invalid configuration - ${problems.join('; ')}`);
    return process.exit(1);
  }
}

const config = configOrExit();
const db = openDb(config.DB_PATH);
const audit = new AuditLog(db);
const devices = new DeviceStore(db, config.DEVICE_TTL_DAYS * 86_400_000);
const pairing = new PairingCodes();
const sessions = new SessionManager(
  (cols, rows) => spawnPty(config.SHELL_FILE, cols, rows),
  { maxSessions: config.MAX_SESSIONS, idleMs: config.SESSION_IDLE_MINUTES * 60_000 },
  (s) => audit.record('session_expired', s.ownerId, s.id),
);
const server = createServer({ config, sessions, devices, pairing, audit });

const printCode = () =>
  console.log(
    `Pairing code: ${pairing.issue()} (single use, valid 2 minutes). Type "pair" for a new one.`,
  );

server.listen(config.PORT, config.HOST, () => {
  console.log(`listening on http://${config.HOST}:${config.PORT}`);
  printCode();
});

// Pairing codes are only ever issued from the machine's own console.
createInterface({ input: process.stdin }).on('line', (line) => {
  if (line.trim() === 'pair') printCode();
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    sessions.shutdown();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  });
}
