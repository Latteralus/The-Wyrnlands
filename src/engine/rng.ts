export type Rng = () => number;

// A Rng that also exposes its current internal state — mulberry32's whole
// state is the single 32-bit `a` value, so capturing it is enough to resume
// the exact same sequence later via createRng(savedState). Needed so a
// checkpoint/rehydration cycle (see checkpoint.ts) doesn't silently reset
// the draw sequence, which would break §4.2's "same DB + same seed = same
// result" determinism guarantee across the boundary. Structurally still a
// plain Rng (has the same call signature) — every existing caller that only
// wants `() => number` keeps working unchanged.
export interface SeededRng {
  (): number;
  getState(): number;
}

// mulberry32 — small, fast, deterministic for a given 32-bit seed.
export function createRng(seed: number): SeededRng {
  let a = seed >>> 0;
  const next = (() => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }) as SeededRng;
  next.getState = () => a;
  return next;
}

// FNV-1a: turns an arbitrary string seed (e.g. a save name) into the
// 32-bit integer createRng() expects.
export function hashSeed(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
