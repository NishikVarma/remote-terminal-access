import { describe, expect, it } from 'vitest';
import { waitFor } from '../test-utils.js';
import { spawnPty } from './pty-host.js';

describe.runIf(process.platform === 'win32')('spawnPty (Windows ConPTY)', () => {
  it('runs a command and reports the exit code', async () => {
    const pty = spawnPty('powershell.exe', 80, 24);
    let out = '';
    let exitCode: number | undefined;
    pty.onData((d) => (out += d));
    pty.onExit((e) => (exitCode = e.exitCode));

    pty.write('echo hello-pty\r');
    await waitFor(() => out.includes('hello-pty'));
    pty.resize(100, 30);
    pty.write('exit 3\r');
    await waitFor(() => exitCode !== undefined);
    expect(exitCode).toBe(3);
  });
});
