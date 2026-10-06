import type { Migration } from './types';

// The 2026-10-06 economy balancing pass (DECISIONS.md). SQLite has no ALTER
// for CHECK constraints, so the three tables whose allowed values grow are
// rebuilt (same approach as 0006), copying rowids/ids explicitly so
// insertion order — which market.ts's oldest-first stock rotation relies
// on — and AUTOINCREMENT sequences are preserved exactly.
export const migration_0019_economy_balance: Migration = {
  id: '0019_economy_balance',
  up: `
    -- §8.1 rule 2 "export purchases": an item the merchant buys for export
    -- leaves the settlement's economy — a goods sink alongside consumption,
    -- spoilage and wear, logged in its provenance like any other ending.
    CREATE TABLE items_new (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      quality_tier INTEGER NOT NULL DEFAULT 1,
      container_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('active', 'consumed', 'spoiled', 'worn_out', 'exported')),
      created_at_tick INTEGER NOT NULL,
      destroyed_at_tick INTEGER,
      durability INTEGER
    );
    INSERT INTO items_new (rowid, id, type, quality_tier, container_id, status, created_at_tick, destroyed_at_tick, durability)
      SELECT rowid, id, type, quality_tier, container_id, status, created_at_tick, destroyed_at_tick, durability FROM items;
    DROP TABLE items;
    ALTER TABLE items_new RENAME TO items;
    CREATE INDEX idx_items_container ON items (container_id);
    CREATE INDEX idx_items_status ON items (status);
    CREATE INDEX idx_items_container_type_status ON items (container_id, type, status);

    CREATE TABLE provenance_events_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id TEXT NOT NULL REFERENCES items (id),
      tick INTEGER NOT NULL,
      event_type TEXT NOT NULL CHECK (event_type IN ('produced', 'transferred', 'consumed', 'spoiled', 'worn_out', 'exported')),
      actor_id TEXT,
      from_container_id TEXT,
      to_container_id TEXT,
      note TEXT
    );
    INSERT INTO provenance_events_new (id, item_id, tick, event_type, actor_id, from_container_id, to_container_id, note)
      SELECT id, item_id, tick, event_type, actor_id, from_container_id, to_container_id, note FROM provenance_events;
    DROP TABLE provenance_events;
    ALTER TABLE provenance_events_new RENAME TO provenance_events;
    CREATE INDEX idx_provenance_item_tick ON provenance_events (item_id, tick);

    -- §9.3: owners draw income from a profitable business. A draw is not an
    -- operating cost — summarizeLedger keeps it out of net profit.
    CREATE TABLE company_ledger_entries_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id TEXT NOT NULL REFERENCES companies (id),
      tick INTEGER NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('revenue', 'material_cost', 'wage', 'tax', 'owner_draw')),
      amount INTEGER NOT NULL,
      note TEXT,
      -- Units bought/sold, where the line is a trade (NULL otherwise) — lets
      -- a demand-aware owner plan from what actually sold.
      quantity INTEGER
    );
    INSERT INTO company_ledger_entries_new (id, company_id, tick, kind, amount, note)
      SELECT id, company_id, tick, kind, amount, note FROM company_ledger_entries;
    DROP TABLE company_ledger_entries;
    ALTER TABLE company_ledger_entries_new RENAME TO company_ledger_entries;
    CREATE INDEX idx_company_ledger_company_tick ON company_ledger_entries (company_id, tick);

    -- §11.4 migration push: "unemployment, hunger, ...". A running tally:
    -- +1 for each day the household couldn't feed everyone, -1 (to a floor
    -- of 0) for each day it could. A "days since" clock was tried first and
    -- reset every time a weekly burst of parish alms fed everyone for one
    -- day, so a mostly-hungry household never accumulated anything.
    ALTER TABLE households ADD COLUMN hunger_days INTEGER NOT NULL DEFAULT 0;

    -- §9.5/§9.6 growth and "hiring/dismissal": a job slot's capacity is the
    -- positions currently posted; max_capacity is what the company's
    -- upgrade tier supports. Dismissals shrink capacity, re-posting grows it
    -- back (free) up to max_capacity; only an upgrade raises max_capacity.
    ALTER TABLE job_slots ADD COLUMN max_capacity INTEGER;
    UPDATE job_slots SET max_capacity = capacity;

    -- Upgrades are a deliberate, occasional investment, not something a
    -- full roster triggers every few days (decisions.ts's cooldown).
    ALTER TABLE companies ADD COLUMN last_upgraded_tick INTEGER;

    -- All money was re-denominated ×5 in this pass (goods/catalog.ts's
    -- header: whole-coin prices of 1-3 were too coarse for smoothed pricing
    -- to work). An older world is rescaled consistently — every stored
    -- amount and the conservation counters together, so the nightly audit
    -- still balances. (A no-op on a fresh database: these tables are empty
    -- when migrations run.) Event-log message text is history and keeps the
    -- amounts it was written with.
    UPDATE wallets SET balance = balance * 5;
    UPDATE market_listings SET price = price * 5;
    UPDATE employment SET wage = wage * 5;
    UPDATE job_slots SET wage_min = wage_min * 5, wage_max = wage_max * 5;
    UPDATE company_ledger_entries SET amount = amount * 5;
    UPDATE audits SET total_coin = total_coin * 5;
    UPDATE world_meta SET coin_faucet_total = coin_faucet_total * 5, coin_sink_total = coin_sink_total * 5;
  `,
};
