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

  it('reports one canonical state, whether or not a draw has happened since it was restored', () => {
    const original = createRng(hashSeed('state-roundtrip'));
    for (let i = 0; i < 50; i++) original();
    const saved = original.getState();
    const restored = createRng(saved);
    // Same number straight after restoring (no draw yet) as the original holds...
    expect(restored.getState()).toBe(saved);
    expect(saved).toBeGreaterThanOrEqual(0);
    // ...and the same sequence from there on.
    expect(Array.from({ length: 5 }, () => restored())).toEqual(Array.from({ length: 5 }, () => original()));
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
