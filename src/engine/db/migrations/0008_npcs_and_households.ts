import type { Migration } from './types';

export const migration_0008_npcs_and_households: Migration = {
  id: '0008_npcs_and_households',
  up: `
    -- §10 Households: the central economic unit. A household is also an
    -- entities row — same "reuse the entity/wallet/item machinery" precedent
    -- as companies (§Stage 3's decision): it owns a wallet (shared money)
    -- and holds shared food/goods in its own inventory container, exactly
    -- like a person or a company does, with no separate "business account"
    -- concept invented for it.
    CREATE TABLE households (
      id TEXT PRIMARY KEY REFERENCES entities (id),
      name TEXT NOT NULL,
      home_site_id TEXT NOT NULL REFERENCES sites (id)
    );

    -- One person belongs to at most one household at a time.
    CREATE TABLE household_members (
      entity_id TEXT PRIMARY KEY REFERENCES entities (id),
      household_id TEXT NOT NULL REFERENCES households (id)
    );

    CREATE INDEX idx_household_members_household ON household_members (household_id);

    -- §9.8 staffing: a job slot can now hold more than one worker (a farm
    -- has more than one hand). Stage 3's "at most one active employment per
    -- slot" becomes "at most capacity."
    ALTER TABLE job_slots ADD COLUMN capacity INTEGER NOT NULL DEFAULT 1;

    -- §9.2 "every business has an owner whose Management skill modifies the
    -- whole operation." Nullable: a company can exist before an owner is
    -- assigned (Stage 3's Oster Farm predates NPCs entirely).
    ALTER TABLE companies ADD COLUMN owner_id TEXT REFERENCES entities (id);
  `,
};
