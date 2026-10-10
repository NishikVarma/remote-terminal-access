import { describe, expect, it } from 'vitest';
import { loadConfig } from './index.js';

describe('loadConfig', () => {
  it('defaults to loopback binding', () => {
    const c = loadConfig({});
    expect(c.HOST).toBe('127.0.0.1');
    expect(c.PORT).toBe(8787);
  });
  it('rejects invalid port', () => {
    expect(() => loadConfig({ PORT: '99999' })).toThrow();
  });
});
