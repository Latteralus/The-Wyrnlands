import type { Migration } from './types';

export const migration_0011_company_growth: Migration = {
  id: '0011_company_growth',
  up: `
    -- §9.5 "Growth & Upgrades": upgrade tiers expand job slots (and, later,
    -- storage/workstations once those exist). Starts at 1 for every existing
    -- and future company. companies/decisions.ts's tryUpgrade raises this and
    -- each tier's job_slots.capacity together, capped at the §9.5 hard cap of
    -- 20 employees per business.
    ALTER TABLE companies ADD COLUMN tier INTEGER NOT NULL DEFAULT 1;
  `,
};
