import { queryRow } from '../db/sqlite';
import { MINUTES_PER_DAY } from '../time/clock';
import { listAllMarketListings } from './market';
import type { Database } from '../db/sqlite';

// The market's memory (§8.1 rule 6 "agents act on last-known data"; §14.2
// price history): per listing per day, the recorded price and stock plus how
// many units were sold, imported by the merchant and exported. Anyone
// judging a market — an NPC weighing a new business today, a market chart
// later — reads this instead of the live listing alone, so "prices have been
// high for weeks" and "the town keeps importing bread" are real, observable
// facts rather than guesses from one day's number.
//
// Cost: a handful of rows a day (one per listing) plus one upsert per
// purchase — negligible next to the per-unit provenance rows a sale already
// writes.

export type MarketFlow = 'sold' | 'imported' | 'exported';

export function dayOf(tick: number): number {
  return Math.floor(tick / MINUTES_PER_DAY);
}

export function recordMarketFlow(
  db: Database,
  siteId: string,
  goodType: string,
  tick: number,
  flow: MarketFlow,
  units: number,
): void {
  if (units <= 0) return;
  db.run(
    `INSERT INTO market_history (site_id, good_type, day, ${flow}) VALUES (?, ?, ?, ?)
     ON CONFLICT (site_id, good_type, day) DO UPDATE SET ${flow} = ${flow} + excluded.${flow}`,
    [siteId, goodType, dayOf(tick), units],
  );
}

// Snapshots every listing after company/merchant trade and price drift,
// before household shopping and spoilage. Preserve this cadence: NPC
// opportunity decisions already use these observations.
export function recordMarketDay(db: Database, tick: number): void {
  const day = dayOf(tick);
  for (const listing of listAllMarketListings(db)) {
    db.run(
      `INSERT INTO market_history (site_id, good_type, day, price, quantity) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (site_id, good_type, day) DO UPDATE SET price = excluded.price, quantity = excluded.quantity`,
      [listing.siteId, listing.goodType, day, listing.price, listing.quantity],
    );
  }
}

export interface MarketWindowStats {
  days: number; // days of history actually on record in the window
  avgPrice: number | null;
  lastPrice: number | null;
  soldPerDay: number;
  importedPerDay: number;
  exportedPerDay: number;
  avgQuantity: number | null;
}

// What the last `windowDays` days of one good's market looked like. Per-day
// rates divide by the window length, not by days on record, so a good that
// only just appeared reads as thin trade rather than as a boom.
export function marketWindowStats(
  db: Database,
  siteId: string,
  goodType: string,
  tick: number,
  windowDays: number,
): MarketWindowStats {
  const fromDay = dayOf(tick) - windowDays;
  const row = queryRow(
    db,
    `SELECT COUNT(price), AVG(price), COALESCE(SUM(sold), 0), COALESCE(SUM(imported), 0),
            COALESCE(SUM(exported), 0), AVG(quantity)
     FROM market_history WHERE site_id = ? AND good_type = ? AND day > ?`,
    [siteId, goodType, fromDay],
  );
  const last = queryRow(
    db,
    `SELECT price FROM market_history WHERE site_id = ? AND good_type = ? AND price IS NOT NULL
     ORDER BY day DESC LIMIT 1`,
    [siteId, goodType],
  );
  const days = Number(row?.[0] ?? 0);
  return {
    days,
    avgPrice: days > 0 ? Number(row?.[1]) : null,
    lastPrice: last ? Number(last[0]) : null,
    soldPerDay: Number(row?.[2] ?? 0) / windowDays,
    importedPerDay: Number(row?.[3] ?? 0) / windowDays,
    exportedPerDay: Number(row?.[4] ?? 0) / windowDays,
    avgQuantity: days > 0 ? Number(row?.[5]) : null,
  };
}
