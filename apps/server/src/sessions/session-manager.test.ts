import type { ServerMessage } from '@rta/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PtyHost } from '../terminal/pty-host.js';
import { SessionManager } from './session-manager.js';

afterEach(() => vi.useRealTimers());

function fakePty() {
  let onData: (d: string) => void = () => {};
  let onExit: (e: { exitCode: number }) => void = () => {};
  const pty: PtyHost & { emit(d: string): void; written: string[] } = {
    written: [],
    write: (d) => void pty.written.push(d),
    resize: () => {},
    kill: () => onExit({ exitCode: 0 }),
    onData: (cb) => void (onData = cb),
    onExit: (cb) => void (onExit = cb),
    emit: (d) => onData(d),
  };
  return pty;
}

function setup(maxSessions = 2, idleMs = 60_000, onExpire = vi.fn()) {
  const ptys: ReturnType<typeof fakePty>[] = [];
  const spawn = vi.fn(() => {
    const p = fakePty();
    ptys.push(p);
    return p;
  });
  return {
    manager: new SessionManager(spawn, { maxSessions, idleMs }, onExpire),
    spawn,
    ptys,
    onExpire,
  };
}

describe('SessionManager', () => {
  it('reattaching replays output without spawning a second shell', () => {
    const { manager, spawn, ptys } = setup();
    const session = manager.create('dev', 80, 24);
    const detach = session.attach(() => {});
    ptys[0]!.emit('hello');
    detach();
    expect(session.state).toBe('disconnected');

    const seen: ServerMessage[] = [];
    manager.getOwned(session.id, 'dev')!.attach((m) => seen.push(m));
    expect(seen).toEqual([{ type: 'output', data: 'hello' }]);
    expect(session.state).toBe('running');
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('bounds the replay buffer', () => {
    const { manager, ptys } = setup();
    const session = manager.create('dev', 80, 24);
    ptys[0]!.emit('x'.repeat(300 * 1024));
    const seen: ServerMessage[] = [];
    session.attach((m) => seen.push(m));
    expect((seen[0] as { data: string }).data.length).toBe(256 * 1024);
  });

  it('enforces the session limit and frees a slot on exit', () => {
    const { manager } = setup(1);
    const s = manager.create('dev', 80, 24);
    expect(() => manager.create('dev', 80, 24)).toThrow('session limit');
    s.kill();
    expect(manager.getOwned(s.id, 'dev')).toBeUndefined();
    expect(() => manager.create('dev', 80, 24)).not.toThrow();
  });

  it('sends exit to attached clients and ignores input afterwards', () => {
    const { manager, ptys } = setup();
    const s = manager.create('dev', 80, 24);
    const seen: ServerMessage[] = [];
    s.attach((m) => seen.push(m));
    s.kill();
    s.handle({ type: 'input', data: 'late' });
    expect(seen).toEqual([{ type: 'exit', exitCode: 0 }]);
    expect(ptys[0]!.written).toEqual([]);
  });

  it('propagates spawn failure without leaking a session', () => {
    const manager = new SessionManager(
      () => {
        throw new Error('no such shell');
      },
      { maxSessions: 1, idleMs: 1000 },
    );
    expect(() => manager.create('dev', 80, 24)).toThrow('no such shell');
    expect(() => manager.create('dev', 80, 24)).toThrow('no such shell');
  });

  it('isolates sessions by owner and kills by owner', () => {
    const { manager } = setup();
    const mine = manager.create('a', 80, 24);
    const theirs = manager.create('b', 80, 24);
    expect(manager.getOwned(mine.id, 'b')).toBeUndefined();
    manager.killOwnedBy('a');
    expect(manager.getOwned(mine.id, 'a')).toBeUndefined();
    expect(manager.getOwned(theirs.id, 'b')).toBe(theirs);
  });

  it('kills a session nobody is attached to after the idle time', () => {
    vi.useFakeTimers();
    const { manager, onExpire } = setup(2, 1000);
    const s = manager.create('dev', 80, 24);
    const detach = s.attach(() => {});
    vi.advanceTimersByTime(5000);
    expect(manager.getOwned(s.id, 'dev')).toBe(s); // attached: not expired

    detach();
    vi.advanceTimersByTime(1001);
    expect(onExpire).toHaveBeenCalledWith(s);
    expect(manager.getOwned(s.id, 'dev')).toBeUndefined();
  });
});
