import { describe, expect, it } from 'vitest';
import { createRng, hashSeed } from './rng';

describe('createRng', () => {
  it('produces identical sequences for the same seed', () => {
    const a = createRng(hashSeed('wyrnlands'));
    const b = createRng(hashSeed('wyrnlands'));
    const seqA = Array.from({ length: 5 }, () => a());
    const seqB = Array.from({ length: 5 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  it('diverges for different seeds', () => {
    const a = createRng(hashSeed('seed-a'));
    const b = createRng(hashSeed('seed-b'));
    expect(a()).not.toBe(b());
  });

  it('stays within [0, 1)', () => {
    const rng = createRng(hashSeed('bounds-check'));
    for (let i = 0; i < 1000; i++) {
      const value = rng();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});
