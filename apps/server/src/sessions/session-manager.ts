import { randomUUID } from 'node:crypto';
import type { ClientMessage, ServerMessage, SessionState } from '@rta/shared';
import type { PtyHost } from '../terminal/pty-host.js';

const MAX_BUFFER_CHARS = 256 * 1024;

type Listener = (msg: ServerMessage) => void;

/** One shell process, its owner device, and the browsers currently watching it. */
export class Session {
  state: SessionState = 'disconnected';
  private buffer = '';
  private listeners = new Set<Listener>();
  private idleTimer?: NodeJS.Timeout;

  constructor(
    readonly id: string,
    readonly ownerId: string,
    private pty: PtyHost,
    private idleMs: number,
    private onExit: () => void,
    private onIdle: () => void,
  ) {
    pty.onData((data) => {
      this.buffer = (this.buffer + data).slice(-MAX_BUFFER_CHARS);
      this.emit({ type: 'output', data });
    });
    pty.onExit(({ exitCode }) => {
      this.state = 'exited';
      clearTimeout(this.idleTimer);
      this.emit({ type: 'exit', exitCode });
      this.onExit();
    });
    this.armIdleTimer();
  }

  /** Replays recent output, then streams. Returns the detach function. Never spawns. */
  attach(listener: Listener): () => void {
    if (this.buffer) listener({ type: 'output', data: this.buffer });
    this.listeners.add(listener);
    clearTimeout(this.idleTimer);
    if (this.state !== 'exited') this.state = 'running';
    return () => {
      this.listeners.delete(listener);
      if (this.state === 'running' && this.listeners.size === 0) {
        this.state = 'disconnected';
        this.armIdleTimer();
      }
    };
  }

  handle(msg: ClientMessage): void {
    if (this.state === 'exited') return;
    if (msg.type === 'input') this.pty.write(msg.data);
    else this.pty.resize(msg.cols, msg.rows);
  }

  kill(): void {
    this.pty.kill();
  }

  // A session nobody is attached to is killed after idleMs.
  private armIdleTimer(): void {
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.onIdle();
      this.kill();
    }, this.idleMs);
    this.idleTimer.unref();
  }

  private emit(msg: ServerMessage): void {
    this.listeners.forEach((l) => l(msg));
  }
}

export interface SessionLimits {
  maxSessions: number;
  idleMs: number;
}

export class SessionManager {
  private sessions = new Map<string, Session>();

  constructor(
    private spawn: (cols: number, rows: number) => PtyHost,
    private limits: SessionLimits,
    private onExpire: (session: Session) => void = () => {},
  ) {}

  create(ownerId: string, cols: number, rows: number): Session {
    if (this.sessions.size >= this.limits.maxSessions) throw new Error('session limit reached');
    const id = randomUUID();
    const session: Session = new Session(
      id,
      ownerId,
      this.spawn(cols, rows),
      this.limits.idleMs,
      () => this.sessions.delete(id),
      () => this.onExpire(session),
    );
    this.sessions.set(id, session);
    return session;
  }

  /** Sessions are isolated: a device only sees the ones it created. */
  getOwned(id: string, ownerId: string): Session | undefined {
    const s = this.sessions.get(id);
    return s?.ownerId === ownerId ? s : undefined;
  }

  killOwnedBy(ownerId: string): void {
    this.sessions.forEach((s) => s.ownerId === ownerId && s.kill());
  }

  shutdown(): void {
    this.sessions.forEach((s) => s.kill());
  }
}
