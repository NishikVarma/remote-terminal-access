import { randomInt, timingSafeEqual } from 'node:crypto';

const TTL_MS = 120_000;
const MAX_FAILURES = 5;

/** One active, single-use pairing code. Only someone at the server console can obtain one. */
export class PairingCodes {
  private current?: { code: string; expiresAt: number; failures: number };

  issue(): string {
    const code = String(randomInt(0, 100_000_000)).padStart(8, '0');
    this.current = { code, expiresAt: Date.now() + TTL_MS, failures: 0 };
    return code;
  }

  /** True once per issued code. Five wrong guesses burn the code. */
  redeem(attempt: string): boolean {
    const cur = this.current;
    if (!cur || Date.now() > cur.expiresAt) return false;

    const a = Buffer.from(attempt);
    const b = Buffer.from(cur.code);
    if (a.length === b.length && timingSafeEqual(a, b)) {
      this.current = undefined;
      return true;
    }
    if (++cur.failures >= MAX_FAILURES) this.current = undefined;
    return false;
  }
}
