import type { Migration } from './types';

export const migration_0004_inventory_and_audit: Migration = {
  id: '0004_inventory_and_audit',
  up: `
    -- Running totals the audit checks the live tables against. Updated only
    -- by the sanctioned produce/destroy/faucet/sink functions below — if a
    -- bug (or a raw query) mutates items/wallets directly, these drift out
    -- of sync with reality and the nightly audit (§4.2, §16) catches it.
    ALTER TABLE world_meta ADD COLUMN goods_created INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE world_meta ADD COLUMN goods_destroyed INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE world_meta ADD COLUMN coin_faucet_total INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE world_meta ADD COLUMN coin_sink_total INTEGER NOT NULL DEFAULT 0;

    -- Single-container rule (§16): container_id is a loose reference to
    -- whatever currently holds the item (an entity's person, a site's
    -- storage, ...); those container kinds don't exist as distinct tables
    -- yet, so this isn't a real foreign key.
    CREATE TABLE items (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      quality_tier INTEGER NOT NULL DEFAULT 1,
      container_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('active', 'consumed', 'spoiled', 'worn_out')),
      created_at_tick INTEGER NOT NULL,
      destroyed_at_tick INTEGER
    );

    CREATE INDEX idx_items_container ON items (container_id);
    CREATE INDEX idx_items_status ON items (status);

    -- Every item's life (§7.1): produced by whom, hauled by whom, consumed
    -- when. Queryable end to end for a single item.
    CREATE TABLE provenance_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id TEXT NOT NULL REFERENCES items (id),
      tick INTEGER NOT NULL,
      event_type TEXT NOT NULL CHECK (event_type IN ('produced', 'transferred', 'consumed', 'spoiled', 'worn_out')),
      actor_id TEXT,
      from_container_id TEXT,
      to_container_id TEXT,
      note TEXT
    );

    CREATE INDEX idx_provenance_item_tick ON provenance_events (item_id, tick);

    -- Money conservation (§8.1): constant except through designed
    -- faucets/sinks. One wallet per entity for now; business ledgers are a
    -- later module (§9.3).
    CREATE TABLE wallets (
      owner_id TEXT PRIMARY KEY REFERENCES entities (id),
      balance INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE audits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tick INTEGER NOT NULL,
      total_coin INTEGER NOT NULL,
      total_goods INTEGER NOT NULL,
      passed INTEGER NOT NULL,
      note TEXT
    );
  `,
};
