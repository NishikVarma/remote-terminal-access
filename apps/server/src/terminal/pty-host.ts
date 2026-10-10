import * as nodePty from 'node-pty';

/** Platform-neutral PTY abstraction. Only this module may import node-pty. */
export interface PtyHost {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  onData(cb: (data: string) => void): void;
  onExit(cb: (e: { exitCode: number; signal?: number }) => void): void;
}

export interface PtySpawnOptions {
  file: string;
  args: string[];
  cwd: string;
  cols: number;
  rows: number;
}

export function spawnPty(opts: PtySpawnOptions): PtyHost {
  const p = nodePty.spawn(opts.file, opts.args, {
    name: 'xterm-256color',
    cols: opts.cols,
    rows: opts.rows,
    cwd: opts.cwd,
    env: process.env as Record<string, string>,
  });
  return {
    write: (d) => p.write(d),
    resize: (c, r) => p.resize(c, r),
    kill: () => p.kill(),
    onData: (cb) => void p.onData(cb),
    onExit: (cb) => void p.onExit(cb),
  };
}
