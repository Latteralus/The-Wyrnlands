import type { Migration } from './types';

export const migration_0005_survival: Migration = {
  id: '0005_survival',
  up: `
    -- §6 Survival & Needs. Levels are 0-100; decay/restore happen through
    -- needs.ts only, never a raw UPDATE, so collapse triggers can't be
    -- silently bypassed.
    CREATE TABLE needs (
      entity_id TEXT PRIMARY KEY REFERENCES entities (id),
      hunger REAL NOT NULL DEFAULT 100,
      thirst REAL NOT NULL DEFAULT 100,
      energy REAL NOT NULL DEFAULT 100,
      warmth REAL NOT NULL DEFAULT 100,
      updated_at_tick INTEGER NOT NULL DEFAULT 0
    );

    -- §13.2 skill model. "Labor" is the only v1 skill Stage 2 needs (common-
    -- land gathering, pre-employment); trade skills (Farming, Woodcutting,
    -- ...) arrive with jobs/production in Stage 3+.
    CREATE TABLE skills (
      entity_id TEXT NOT NULL REFERENCES entities (id),
      skill TEXT NOT NULL,
      xp INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (entity_id, skill)
    );

    -- Gear durability lives on the item itself (NULL for non-gear goods);
    -- items already carries quality_tier from Stage 0.
    ALTER TABLE items ADD COLUMN durability INTEGER;

    -- Worn gear per slot (§6 shelter/gear layer, §14.2 character sheet).
    -- One item per slot; equipping into an occupied slot unequips the old one.
    CREATE TABLE gear (
      entity_id TEXT NOT NULL REFERENCES entities (id),
      slot TEXT NOT NULL,
      item_id TEXT NOT NULL REFERENCES items (id),
      equipped_at_tick INTEGER NOT NULL,
      PRIMARY KEY (entity_id, slot)
    );

    -- Finite seeded stock (§Stage 2) — no restocking/smoothed pricing yet,
    -- that's Stage 5 (§8.1 rule 4). One row per (site, good).
    CREATE TABLE market_listings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      site_id TEXT NOT NULL REFERENCES sites (id),
      good_type TEXT NOT NULL,
      price INTEGER NOT NULL,
      quantity INTEGER NOT NULL,
      UNIQUE (site_id, good_type)
    );
  `,
};
