import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuditLog } from '../audit/audit.js';
import { openDb } from '../db/db.js';
import { DeviceStore } from './devices.js';
import { PairingCodes } from './pairing.js';

afterEach(() => vi.useRealTimers());

describe('PairingCodes', () => {
  it('is single use', () => {
    const p = new PairingCodes();
    const code = p.issue();
    expect(p.redeem(code)).toBe(true);
    expect(p.redeem(code)).toBe(false);
  });

  it('expires after two minutes', () => {
    vi.useFakeTimers();
    const p = new PairingCodes();
    const code = p.issue();
    vi.advanceTimersByTime(120_001);
    expect(p.redeem(code)).toBe(false);
  });

  it('burns the code after five wrong guesses', () => {
    const p = new PairingCodes();
    const code = p.issue();
    const wrong = code === '00000000' ? '11111111' : '00000000';
    for (let i = 0; i < 5; i++) expect(p.redeem(wrong)).toBe(false);
    expect(p.redeem(code)).toBe(false);
  });

  it('a new code replaces the old one', () => {
    const p = new PairingCodes();
    const first = p.issue();
    const second = p.issue();
    if (first !== second) expect(p.redeem(first)).toBe(false);
    expect(p.redeem(second)).toBe(true);
  });
});

describe('DeviceStore', () => {
  it('authenticates a token, rejects unknown, revoked and expired ones', () => {
    vi.useFakeTimers();
    const store = new DeviceStore(openDb(':memory:'), 1000);

    const { device, token } = store.create('phone');
    expect(store.authenticate(token)?.id).toBe(device.id);
    expect(store.authenticate('wrong')).toBeUndefined();
    expect(store.authenticate(undefined)).toBeUndefined();

    expect(store.revoke(device.id)).toBe(true);
    expect(store.authenticate(token)).toBeUndefined();
    expect(store.revoke(device.id)).toBe(false);

    const second = store.create('laptop');
    vi.advanceTimersByTime(1001);
    expect(store.authenticate(second.token)).toBeUndefined();
  });

  it('stores only a hash of the token', () => {
    const db = openDb(':memory:');
    const { token } = new DeviceStore(db, 1000).create('phone');
    const rows = db.prepare('SELECT * FROM devices').all();
    expect(JSON.stringify(rows)).not.toContain(token);
  });
});

describe('retention', () => {
  it('prunes audit events by age and by row count', () => {
    vi.useFakeTimers();
    const audit = new AuditLog(openDb(':memory:'));
    audit.record('pair_failed');
    vi.advanceTimersByTime(10_000);
    for (let i = 0; i < 5; i++) audit.record('auth_denied');

    audit.prune(5_000, 100); // age: drops the first event
    expect(audit.recent()).toHaveLength(5);
    audit.prune(60_000, 2); // count: keeps only the newest two
    expect(audit.recent()).toHaveLength(2);
  });

  it('prunes devices revoked or expired longer ago than the grace period', () => {
    vi.useFakeTimers();
    const store = new DeviceStore(openDb(':memory:'), 1_000);
    const revoked = store.create('revoked');
    store.revoke(revoked.device.id);
    const active = new DeviceStore(openDb(':memory:'), 1_000_000);
    active.create('active');

    vi.advanceTimersByTime(10_000);
    store.prune(5_000);
    expect(store.list()).toHaveLength(0);
    active.prune(5_000);
    expect(active.list()).toHaveLength(1);
  });
});

describe('AuditLog', () => {
  it('records and returns newest first', () => {
    const audit = new AuditLog(openDb(':memory:'));
    audit.record('pair_failed');
    audit.record('device_revoked', 'd1', 'd2');
    expect(audit.recent().map((e) => e.type)).toEqual(['device_revoked', 'pair_failed']);
  });
});
