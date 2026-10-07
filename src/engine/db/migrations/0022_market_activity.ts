import type { Migration } from './types';

export const migration_0022_market_activity: Migration = {
  id: '0022_market_activity',
  up: `
    -- An observational trade journal. Existing economic/history tables and
    -- NPC decision inputs keep their original semantics.
    CREATE TABLE market_activity (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      site_id TEXT NOT NULL,
      tick INTEGER NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('purchase', 'listed', 'withdrawn', 'imported', 'exported', 'direct', 'sold_to_stall')),
      good_type TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      unit_price INTEGER NOT NULL,
      seller_id TEXT,
      buyer_id TEXT
    );
    CREATE INDEX idx_market_activity_site_tick ON market_activity (site_id, tick DESC, id DESC);
    CREATE INDEX idx_market_activity_site_good_tick ON market_activity (site_id, good_type, tick DESC, id DESC);
    CREATE INDEX idx_market_consignments_owner_site ON market_consignments (consignor_id, site_id);
  `,
};
