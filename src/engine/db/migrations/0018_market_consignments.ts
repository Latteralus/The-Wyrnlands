import type { Migration } from './types';

export const migration_0018_market_consignments: Migration = {
  id: '0018_market_consignments',
  up: `
    -- §8.1 rule 1 (goods conservation with provenance). Before this, nothing
    -- ever moved an item OUT of a market's stock container: every purchase
    -- (the player's buy_*, households' daily bread, companies' input/tool
    -- restocking) conjured a brand-new item for the buyer while the
    -- producer's real items sat in market stock forever — duplicated goods,
    -- unbounded active-item growth, and broken provenance (a household's
    -- loaf never traced back to the bakery). Buyers now take the real,
    -- physical units out of stock first (oldest first), and only the
    -- remainder of a listing's quantity is a merchant import.
    --
    -- A physical unit in stock is either merchant-owned (sold to the stall
    -- outright: the player's firewood, a household's spare cloak, an
    -- auctioned tool — the seller was already paid) or consigned by a local
    -- producing company that gets paid when it actually sells. This table
    -- records the latter: one row per consigned unit, deleted when the unit
    -- is bought. (Previously a listing's single producer_company_id was paid
    -- for EVERY unit sold — including the seeded merchant-import bread — so
    -- the bakery collected revenue on loaves it never baked.)
    CREATE TABLE market_consignments (
      item_id TEXT PRIMARY KEY REFERENCES items (id),
      site_id TEXT NOT NULL REFERENCES sites (id),
      consignor_id TEXT NOT NULL REFERENCES entities (id),
      consigned_at_tick INTEGER NOT NULL
    );

    -- Save compatibility: a company's units already sitting in a market's
    -- stock were consigned by that company (market.ts's sellSurplusToMarket
    -- was the only path that put a company's goods there, logged as a
    -- provenance transfer with the company as actor). Units put there by
    -- anyone else stay merchant-owned, exactly as before.
    INSERT INTO market_consignments (item_id, site_id, consignor_id, consigned_at_tick)
    SELECT items.id, sites.id, MAX(p.actor_id), MAX(p.tick)
    FROM items
    JOIN sites ON items.container_id = sites.id || '-stock'
    JOIN provenance_events p
      ON p.item_id = items.id AND p.event_type = 'transferred' AND p.to_container_id = items.container_id
    WHERE items.status = 'active' AND p.actor_id IN (SELECT id FROM companies)
    GROUP BY items.id;
  `,
};
