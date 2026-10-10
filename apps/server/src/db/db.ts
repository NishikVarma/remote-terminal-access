import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// Append-only. The applied count is stored in SQLite's `user_version`.
const migrations = [
  `CREATE TABLE devices (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL,
     token_hash TEXT NOT NULL UNIQUE,
     created_at INTEGER NOT NULL,
     expires_at INTEGER NOT NULL,
     last_seen_at INTEGER,
     revoked_at INTEGER
   );
   CREATE TABLE audit_events (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     ts INTEGER NOT NULL,
     type TEXT NOT NULL,
     device_id TEXT,
     detail TEXT
   );`,
];

export function openDb(path: string): DatabaseSync {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number };
  migrations.slice(row.user_version).forEach((sql, i) => {
    db.exec(`BEGIN; ${sql} PRAGMA user_version = ${row.user_version + i + 1}; COMMIT;`);
  });
  return db;
}
