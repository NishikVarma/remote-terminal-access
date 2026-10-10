import type { ServerMessage } from '@rta/shared';
import { describe, expect, it, vi } from 'vitest';
import type { PtyHost } from '../terminal/pty-host.js';
import { SessionManager } from './session-manager.js';

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

function setup(max = 2) {
  const ptys: ReturnType<typeof fakePty>[] = [];
  const spawn = vi.fn(() => {
    const p = fakePty();
    ptys.push(p);
    return p;
  });
  return { manager: new SessionManager(spawn, max), spawn, ptys };
}

describe('SessionManager', () => {
  it('reattaching replays output without spawning a second shell', () => {
    const { manager, spawn, ptys } = setup();
    const session = manager.create(80, 24);
    const detach = session.attach(() => {});
    ptys[0]!.emit('hello');
    detach();
    expect(session.state).toBe('disconnected');

    const seen: ServerMessage[] = [];
    manager.get(session.id)!.attach((m) => seen.push(m));
    expect(seen).toEqual([{ type: 'output', data: 'hello' }]);
    expect(session.state).toBe('running');
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('bounds the replay buffer', () => {
    const { manager, ptys } = setup();
    const session = manager.create(80, 24);
    ptys[0]!.emit('x'.repeat(300 * 1024));
    const seen: ServerMessage[] = [];
    session.attach((m) => seen.push(m));
    expect(seen[0]).toMatchObject({ type: 'output' });
    expect((seen[0] as { data: string }).data.length).toBe(256 * 1024);
  });

  it('enforces the session limit and frees a slot on exit', () => {
    const { manager } = setup(1);
    const s = manager.create(80, 24);
    expect(() => manager.create(80, 24)).toThrow('session limit');
    s.kill();
    expect(manager.get(s.id)).toBeUndefined();
    expect(() => manager.create(80, 24)).not.toThrow();
  });

  it('sends exit to attached clients and ignores input afterwards', () => {
    const { manager, ptys } = setup();
    const s = manager.create(80, 24);
    const seen: ServerMessage[] = [];
    s.attach((m) => seen.push(m));
    s.kill();
    s.handle({ type: 'input', data: 'late' });
    expect(seen).toEqual([{ type: 'exit', exitCode: 0 }]);
    expect(ptys[0]!.written).toEqual([]);
  });

  it('propagates spawn failure without leaking a session', () => {
    const manager = new SessionManager(() => {
      throw new Error('no such shell');
    }, 1);
    expect(() => manager.create(80, 24)).toThrow('no such shell');
    expect(() => manager.create(80, 24)).toThrow('no such shell'); // still not "limit reached"
  });
});
