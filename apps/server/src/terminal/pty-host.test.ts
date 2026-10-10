import { describe, expect, it } from 'vitest';
import { spawnPty } from './pty-host.js';

describe.runIf(process.platform === 'win32')('PtyHost (Windows ConPTY spike)', () => {
  it('runs a command in PowerShell and exits cleanly', async () => {
    const pty = spawnPty({
      file: 'powershell.exe',
      args: ['-NoLogo', '-NoProfile'],
      cwd: process.cwd(),
      cols: 80,
      rows: 24,
    });
    let out = '';
    pty.onData((d) => (out += d));
    const exit = new Promise<{ exitCode: number }>((r) => pty.onExit(r));
    await new Promise((r) => setTimeout(r, 1500));
    pty.write('echo hello-pty\r');
    pty.resize(100, 30);
    await new Promise((r) => setTimeout(r, 1000));
    pty.write('exit\r');
    const e = await exit;
    expect(out).toContain('hello-pty');
    expect(e.exitCode).toBe(0);
  }, 20000);
});
