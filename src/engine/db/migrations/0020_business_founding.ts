import type { Migration } from './types';

// NPC-founded businesses (DECISIONS.md, 2026-10-06 "Business founding").
// Everything here is generic infrastructure a player-founded company (Stage
// 6) will share: land access, equity flows in the ledger, owner vs manager,
// a market memory to judge opportunities by, and personality traits.
export const migration_0020_business_founding: Migration = {
  id: '0020_business_founding',
  up: `
    -- §5.1/§12: a parcel's value. NULL = not available for tenure at all
    -- (the well, the market, the tavern, the notice board — commons and
    -- public places). Backfilled for the parcel kinds companies work from.
    ALTER TABLE sites ADD COLUMN land_value INTEGER;
    UPDATE sites SET land_value = CASE kind
      WHEN 'farm' THEN 800
      WHEN 'forest' THEN 500
      WHEN 'mill' THEN 1000
      WHEN 'bakery' THEN 700
      ELSE NULL END;

    -- Who holds a parcel, and on what terms. One open tenure per site
    -- (released_at_tick IS NULL); a released tenure is kept as history.
    -- holder_id is any entity — a company today, the player or a household
    -- later. 'freehold' was bought outright (no rent); 'lease' pays a
    -- weekly rent after an entry fine.
    CREATE TABLE site_tenures (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      site_id TEXT NOT NULL REFERENCES sites (id),
      holder_id TEXT NOT NULL REFERENCES entities (id),
      kind TEXT NOT NULL CHECK (kind IN ('freehold', 'lease')),
      weekly_rent INTEGER NOT NULL DEFAULT 0,
      price_paid INTEGER NOT NULL DEFAULT 0,
      acquired_at_tick INTEGER NOT NULL,
      released_at_tick INTEGER
    );
    CREATE UNIQUE INDEX idx_site_tenures_open_site ON site_tenures (site_id) WHERE released_at_tick IS NULL;
    CREATE INDEX idx_site_tenures_holder ON site_tenures (holder_id, released_at_tick);
    -- Every operating company already works its site: it holds it freehold,
    -- as it always implicitly did.
    INSERT INTO site_tenures (site_id, holder_id, kind, acquired_at_tick)
      SELECT site_id, id, 'freehold', 0 FROM companies WHERE closed_at_tick IS NULL
        AND site_id IN (SELECT id FROM sites WHERE land_value IS NOT NULL);

    -- §9.2 owner vs manager: who makes the daily decisions. NULL = the
    -- owner manages (every company so far). founded_at_tick is the
    -- company's age for its own track-record checks (seeded companies
    -- predate the game: 0). first_hire_tick / first_profit_tick are
    -- lifecycle milestones for the business log.
    ALTER TABLE companies ADD COLUMN manager_id TEXT REFERENCES entities (id);
    ALTER TABLE companies ADD COLUMN founded_at_tick INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE companies ADD COLUMN first_hire_tick INTEGER;
    ALTER TABLE companies ADD COLUMN first_profit_tick INTEGER;

    -- §9.3 ledger: equity and capital flows, kept out of operating net
    -- (owner_contribution, capital) like owner_draw already is; rent is an
    -- operating cost. Same rebuild approach as 0019 (no ALTER for CHECK).
    CREATE TABLE company_ledger_entries_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id TEXT NOT NULL REFERENCES companies (id),
      tick INTEGER NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('revenue', 'material_cost', 'wage', 'tax', 'owner_draw', 'owner_contribution', 'capital', 'rent')),
      amount INTEGER NOT NULL,
      note TEXT,
      quantity INTEGER
    );
    INSERT INTO company_ledger_entries_new (id, company_id, tick, kind, amount, note, quantity)
      SELECT id, company_id, tick, kind, amount, note, quantity FROM company_ledger_entries;
    DROP TABLE company_ledger_entries;
    ALTER TABLE company_ledger_entries_new RENAME TO company_ledger_entries;
    CREATE INDEX idx_company_ledger_company_tick ON company_ledger_entries (company_id, tick);

    -- Why a company exists: the founder's own reading of the opportunity at
    -- the moment they committed (estimates are what they BELIEVED, not the
    -- truth), what they put in, and from where.
    CREATE TABLE company_foundings (
      company_id TEXT PRIMARY KEY REFERENCES companies (id),
      founder_id TEXT NOT NULL REFERENCES entities (id),
      payer_id TEXT NOT NULL REFERENCES entities (id),
      tick INTEGER NOT NULL,
      business_type TEXT NOT NULL,
      site_id TEXT NOT NULL REFERENCES sites (id),
      tenure_kind TEXT NOT NULL,
      investment INTEGER NOT NULL,
      payer_balance_before INTEGER NOT NULL,
      planned_positions INTEGER NOT NULL,
      details TEXT
    );
    CREATE INDEX idx_company_foundings_founder ON company_foundings (founder_id);

    -- §11.1 hidden traits (ambition, risk tolerance, ...), 0..1.
    CREATE TABLE traits (
      entity_id TEXT NOT NULL REFERENCES entities (id),
      trait TEXT NOT NULL,
      value REAL NOT NULL,
      PRIMARY KEY (entity_id, trait)
    );

    -- §8.1 rule 6 / §14.2 price history: one row per listing per day —
    -- closing price and stock, and units sold, imported and exported that
    -- day. What anyone judging the market (an entrepreneur today, market
    -- charts later) actually has to go on.
    CREATE TABLE market_history (
      site_id TEXT NOT NULL,
      good_type TEXT NOT NULL,
      day INTEGER NOT NULL,
      price INTEGER,
      quantity INTEGER,
      sold INTEGER NOT NULL DEFAULT 0,
      imported INTEGER NOT NULL DEFAULT 0,
      exported INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (site_id, good_type, day)
    );
  `,
};
