import type { Migration } from './types';

export const migration_0015_rolled_starting_conditions: Migration = {
  id: '0015_rolled_starting_conditions',
  up: `
    -- §5.4 "Starting Conditions Are Rolled... current season" — which of the
    -- four seasons tick 0 falls in, rolled once at world creation
    -- (Engine.ensureWorldMeta) from the seeded RNG and applied consistently
    -- by time/clock.ts's deriveCalendar from then on. 0 = spring (the
    -- previous, un-rolled default), so existing saves/tests are unaffected.
    ALTER TABLE world_meta ADD COLUMN start_season_index INTEGER NOT NULL DEFAULT 0;
  `,
};
