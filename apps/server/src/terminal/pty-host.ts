import * as nodePty from 'node-pty';

/** Platform-neutral PTY. Only this file imports node-pty. */
export interface PtyHost {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  onData(cb: (data: string) => void): void;
  onExit(cb: (e: { exitCode: number }) => void): void;
}

export function spawnPty(file: string, cols: number, rows: number): PtyHost {
  const p = nodePty.spawn(file, [], { name: 'xterm-256color', cols, rows, cwd: process.cwd() });
  return {
    write: (d) => p.write(d),
    resize: (c, r) => p.resize(c, r),
    kill: () => p.kill(),
    onData: (cb) => void p.onData(cb),
    onExit: (cb) => void p.onExit(cb),
  };
}
