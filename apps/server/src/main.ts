import { loadConfig } from './config/index.js';
import { createServer } from './http/server.js';
import { SessionManager } from './sessions/session-manager.js';
import { spawnPty } from './terminal/pty-host.js';

const config = loadConfig();
const sessions = new SessionManager(
  (cols, rows) => spawnPty(config.SHELL_FILE, cols, rows),
  config.MAX_SESSIONS,
);
const server = createServer(config, sessions);

server.listen(config.PORT, config.HOST, () => {
  console.log(`listening on http://${config.HOST}:${config.PORT}`);
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    sessions.shutdown();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  });
}
