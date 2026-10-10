import { randomUUID } from 'node:crypto';
import type { ClientMessage, ServerMessage, SessionState } from '@rta/shared';
import type { PtyHost } from '../terminal/pty-host.js';

const MAX_BUFFER_CHARS = 256 * 1024;

type Listener = (msg: ServerMessage) => void;

/** One shell process plus the browsers currently watching it. */
export class Session {
  state: SessionState = 'disconnected';
  private buffer = '';
  private listeners = new Set<Listener>();

  constructor(
    readonly id: string,
    private pty: PtyHost,
    onExit: () => void,
  ) {
    pty.onData((data) => {
      this.buffer = (this.buffer + data).slice(-MAX_BUFFER_CHARS);
      this.emit({ type: 'output', data });
    });
    pty.onExit(({ exitCode }) => {
      this.state = 'exited';
      this.emit({ type: 'exit', exitCode });
      onExit();
    });
  }

  /** Replays recent output, then streams. Returns the detach function. Never spawns. */
  attach(listener: Listener): () => void {
    if (this.buffer) listener({ type: 'output', data: this.buffer });
    this.listeners.add(listener);
    if (this.state !== 'exited') this.state = 'running';
    return () => {
      this.listeners.delete(listener);
      if (this.state === 'running' && this.listeners.size === 0) this.state = 'disconnected';
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

  private emit(msg: ServerMessage): void {
    this.listeners.forEach((l) => l(msg));
  }
}

export class SessionManager {
  private sessions = new Map<string, Session>();

  constructor(
    private spawn: (cols: number, rows: number) => PtyHost,
    private maxSessions: number,
  ) {}

  create(cols: number, rows: number): Session {
    if (this.sessions.size >= this.maxSessions) throw new Error('session limit reached');
    const id = randomUUID();
    const session = new Session(id, this.spawn(cols, rows), () => this.sessions.delete(id));
    this.sessions.set(id, session);
    return session;
  }

  get(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  shutdown(): void {
    this.sessions.forEach((s) => s.kill());
  }
}
