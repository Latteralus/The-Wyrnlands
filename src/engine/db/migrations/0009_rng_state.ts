import type { Migration } from './types';

export const migration_0009_rng_state: Migration = {
  id: '0009_rng_state',
  up: `
    -- Persists the RNG's current numeric state (mulberry32's whole state is
    -- this one 32-bit value — see rng.ts's SeededRng), synced on every
    -- Engine.export() call. NULL for a brand-new world (Engine's constructor
    -- falls back to hashing rng_seed in that case) or an older save
    -- predating this column. Lets an Engine rehydrated from exported bytes
    -- resume the exact same draw sequence instead of restarting it from
    -- rng_seed — required for checkpoint/rehydration (checkpoint.ts) to
    -- preserve §4.2's determinism guarantee across the reinstantiation
    -- boundary, and incidentally fixes the same gap for ordinary save/load.
    ALTER TABLE world_meta ADD COLUMN rng_state INTEGER;
  `,
};
