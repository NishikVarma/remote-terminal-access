import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

export interface Device {
  id: string;
  name: string;
  createdAt: number;
  lastSeenAt: number | null;
  revokedAt: number | null;
}

interface Row {
  id: string;
  name: string;
  created_at: number;
  last_seen_at: number | null;
  revoked_at: number | null;
}

const toDevice = (r: Row): Device => ({
  id: r.id,
  name: r.name,
  createdAt: r.created_at,
  lastSeenAt: r.last_seen_at,
  revokedAt: r.revoked_at,
});

// Only the SHA-256 of a token is stored, so a leaked database cannot be used to log in.
const hash = (token: string) => createHash('sha256').update(token).digest('hex');

export class DeviceStore {
  constructor(
    private db: DatabaseSync,
    private ttlMs: number,
  ) {}

  /** Returns the secret token once; it cannot be recovered later. */
  create(name: string): { device: Device; token: string } {
    const token = randomBytes(32).toString('base64url');
    const now = Date.now();
    const id = randomUUID();
    this.db
      .prepare(
        'INSERT INTO devices (id, name, token_hash, created_at, expires_at) VALUES (?,?,?,?,?)',
      )
      .run(id, name, hash(token), now, now + this.ttlMs);
    return { device: { id, name, createdAt: now, lastSeenAt: null, revokedAt: null }, token };
  }

  /** The device for a valid, unrevoked, unexpired token; otherwise undefined. */
  authenticate(token: string | undefined): Device | undefined {
    if (!token) return undefined;
    const now = Date.now();
    const row = this.db
      .prepare(
        'SELECT * FROM devices WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ?',
      )
      .get(hash(token), now) as Row | undefined;
    if (!row) return undefined;
    this.db.prepare('UPDATE devices SET last_seen_at = ? WHERE id = ?').run(now, row.id);
    return toDevice(row);
  }

  list(): Device[] {
    const rows = this.db
      .prepare('SELECT * FROM devices ORDER BY created_at')
      .all() as unknown as Row[];
    return rows.map(toDevice);
  }

  /** Removes devices that were revoked or expired more than `graceMs` ago. */
  prune(graceMs: number): void {
    const cutoff = Date.now() - graceMs;
    this.db
      .prepare('DELETE FROM devices WHERE revoked_at < ? OR expires_at < ?')
      .run(cutoff, cutoff);
  }

  revoke(id: string): boolean {
    const r = this.db
      .prepare('UPDATE devices SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL')
      .run(Date.now(), id);
    return r.changes > 0;
  }
}
