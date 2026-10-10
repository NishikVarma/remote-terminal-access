import { describe, expect, it } from 'vitest';
import { ctrlChar } from './keys-toolbar.js';

describe('ctrlChar', () => {
  it('maps letters to control codes regardless of case', () => {
    expect(ctrlChar('c')).toBe('\x03');
    expect(ctrlChar('C')).toBe('\x03');
    expect(ctrlChar('d')).toBe('\x04');
    expect(ctrlChar('z')).toBe('\x1a');
  });

  it('maps [ to Escape and \\ to FS', () => {
    expect(ctrlChar('[')).toBe('\x1b');
    expect(ctrlChar('\\')).toBe('\x1c');
  });

  it('ignores digits, multi-character input and escape sequences', () => {
    expect(ctrlChar('1')).toBeUndefined();
    expect(ctrlChar('ab')).toBeUndefined();
    expect(ctrlChar('\x1b[A')).toBeUndefined();
    expect(ctrlChar('')).toBeUndefined();
  });
});
