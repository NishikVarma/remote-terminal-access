import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DeviceStore } from '../auth/devices.js';
import { openDb } from './db.js';

describe('openDb', () => {
  it('reopens an existing database without re-running migrations or losing data', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'rta-')), 'rta.db');

    const first = openDb(file);
    const { token } = new DeviceStore(first, 60_000).create('phone');
    first.close();

    const second = openDb(file);
    const version = second.prepare('PRAGMA user_version').get() as { user_version: number };
    expect(version.user_version).toBe(1);
    expect(new DeviceStore(second, 60_000).authenticate(token)?.name).toBe('phone');
    second.close();
  });
});
