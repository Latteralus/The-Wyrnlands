import type { Migration } from './types';

export const migration_0003_sites: Migration = {
  id: '0003_sites',
  up: `
    -- Every settlement, farm, resource site, and business sits at grid
    -- coordinates (§5.1). "kind" is free text, not an enum: locations are
    -- data (§16), extended as settlement/construction modules land.
    CREATE TABLE sites (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      x INTEGER NOT NULL,
      y INTEGER NOT NULL
    );

    CREATE INDEX idx_sites_kind ON sites (kind);
  `,
};
