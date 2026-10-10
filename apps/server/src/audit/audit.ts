import type { DatabaseSync } from 'node:sqlite';

export type AuditType =
  | 'pair_succeeded'
  | 'pair_failed'
  | 'auth_denied'
  | 'device_revoked'
  | 'session_created'
  | 'session_deleted'
  | 'session_expired';

export interface AuditEvent {
  id: number;
  ts: number;
  type: AuditType;
  deviceId: string | null;
  detail: string | null;
}

/** Never pass tokens, pairing codes or terminal content as `detail`. */
export class AuditLog {
  constructor(private db: DatabaseSync) {}

  record(type: AuditType, deviceId: string | null = null, detail: string | null = null): void {
    this.db
      .prepare('INSERT INTO audit_events (ts, type, device_id, detail) VALUES (?,?,?,?)')
      .run(Date.now(), type, deviceId, detail);
  }

  recent(limit = 100): AuditEvent[] {
    const rows = this.db
      .prepare('SELECT id, ts, type, device_id, detail FROM audit_events ORDER BY id DESC LIMIT ?')
      .all(limit) as unknown as Array<{
      id: number;
      ts: number;
      type: AuditType;
      device_id: string | null;
      detail: string | null;
    }>;
    return rows.map((r) => ({
      id: r.id,
      ts: r.ts,
      type: r.type,
      deviceId: r.device_id,
      detail: r.detail,
    }));
  }
}
