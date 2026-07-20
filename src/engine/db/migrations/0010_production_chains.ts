import type { Migration } from './types';

export const migration_0010_production_chains: Migration = {
  id: '0010_production_chains',
  up: `
    -- §9.3 Ledger (a minimal, real version — full tabbed company screens are
    -- Stage 6, "player-owned" only, per companies.ts's header comment). Each
    -- row is one business-side coin event (revenue from a sale, a material
    -- cost, a wage run) so the daily decision cadence (companies/decisions.ts)
    -- and any future business-log screen can read recent profitability
    -- without re-deriving it from the whole event_log.
    CREATE TABLE company_ledger_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id TEXT NOT NULL REFERENCES companies (id),
      tick INTEGER NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('revenue', 'material_cost', 'wage', 'tax')),
      amount INTEGER NOT NULL,
      note TEXT
    );

    CREATE INDEX idx_company_ledger_company_tick ON company_ledger_entries (company_id, tick);

    -- §8.1 rule 4 "closed economy": a listing can now be backed by a real
    -- producing company rather than an unowned merchant-faucet import (§7.2:
    -- "imported via merchant faucet at first, produced locally as chains come
    -- online"). Nullable — goods with no local producer yet (shoes, cloaks)
    -- stay faucet/sink imports exactly as before. One producer per (site,
    -- good) is a deliberate v1 simplification (not per-seller competition) —
    -- see market.ts's sellSurplusToMarket.
    ALTER TABLE market_listings ADD COLUMN producer_company_id TEXT REFERENCES companies (id);

    -- §8.1 rule 4 "target price = base × scarcity × ...": the "healthy"
    -- stock level a listing's price is scarce/plentiful relative to. Set once
    -- at seedListing time from the initial quantity; nullable so old-shaped
    -- rows (none exist pre-migration, but keeps the column honestly optional)
    -- fall back to basePrice with no scarcity adjustment.
    ALTER TABLE market_listings ADD COLUMN reference_stock INTEGER;

    -- §9.6/§11.5 "insolvency ... failure" — a real, minimal signal (first
    -- tick a company's balance hit zero and hasn't recovered since) rather
    -- than the full closure/auction machinery, which needs equipment/upgrade
    -- modeling (§9.4/§9.5) not yet built. Cleared the moment balance recovers.
    ALTER TABLE companies ADD COLUMN insolvent_since_tick INTEGER;
  `,
};
