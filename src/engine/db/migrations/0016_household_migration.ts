import type { Migration } from './types';

export const migration_0016_household_migration: Migration = {
  id: '0016_household_migration',
  up: `
    -- §11.4 Migration / §10's last, previously-unmodeled adaptation-ladder
    -- rung ("migrate"). Mirrors companies' insolvent_since_tick/closed_at_tick
    -- pair exactly: destitute_since_tick is the first tick a household had no
    -- employed members and a balance below the charity threshold, cleared on
    -- recovery; departed_at_tick is set once, for good, when a household stays
    -- destitute past its grace period and emigrates (population/cadence.ts's
    -- applyHouseholdMigrationWeeklyCadence).
    ALTER TABLE households ADD COLUMN destitute_since_tick INTEGER;
    ALTER TABLE households ADD COLUMN departed_at_tick INTEGER;
  `,
};
