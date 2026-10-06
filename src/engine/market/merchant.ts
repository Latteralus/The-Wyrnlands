import { recordLedgerEntry } from '../companies/companies';
import { queryRows } from '../db/sqlite';
import { getGoodDefinition } from '../goods/catalog';
import { destroyItem } from '../inventory/items';
import { faucetCoin } from '../inventory/wallet';
import { MINUTES_PER_DAY } from '../time/clock';
import { recordMarketFlow } from './history';
import { listAllMarketListings, marketStockContainerId, type MarketListing } from './market';
import type { EventBus } from '../eventBus';
import type { Database } from 'sql.js';

// The travelling merchant: the settlement's link to the outside economy
// (§8.1 rule 2's import sink / export faucet; §8.2 "merchant imports
// responding to prices"). Runs once a day after companies have sold.
//
// Imports: when a good the merchant carries (catalog merchantImports) is
// running short AND the shortage has bid its price up, the merchant brings
// in a batch. The batch is unbacked listing quantity — buyers' coin for it
// sinks out of the economy (market.ts's buyFromMarket) — so a town that
// can't feed itself pays outsiders, and a local producer can always
// undercut an import. Before 2026-10-06 the only import was a finite
// seeded stock; once it ran out (around day 45 in every run) an empty bread
// listing just sat at its price cap while the town starved.
//
// Exports: when a good the merchant buys (catalog merchantExports) is piling
// up far beyond what the town absorbs, the merchant buys part of the glut —
// consigned units only, oldest first — at a discount. The producer is paid
// from outside the economy (a faucet) and the units leave for good
// (status 'exported', in their provenance). This is the price floor that
// keeps an over-supplied producer (the logging camp, a farm after a good
// harvest) from simply bleeding out.
export const MERCHANT_ID = 'merchant';
// Half the reference stock: at a quarter, a day that opened with just over
// the trigger (say 20 loaves) against ~45 loaves of demand left a third of
// the town short that day.
const IMPORT_TRIGGER_FRACTION = 0.5; // of reference stock
const IMPORT_PRICE_MULTIPLIER = 1.5; // the merchant's asking price, as a multiple of base
const EXPORT_TRIGGER_MULTIPLIER = 2; // of reference stock
const EXPORT_PRICE_FACTOR = 0.6; // of base price
const EXPORT_DAILY_FRACTION = 1; // at most one reference-stock's worth a day
// Only stock that has sat unsold this long is a glut — not fresh output a
// periodic buyer will be back for (an earlier iteration exported a mill's
// flour between a sloppy bakery's five-day restocks, at a loss, until the
// mill closed).
const EXPORT_MIN_DAYS_UNSOLD = 7;

export function referenceStockFor(listing: MarketListing): number | null {
  return getGoodDefinition(listing.goodType).marketReferenceStock ?? listing.referenceStock;
}

export function applyMerchantTrade(db: Database, bus: EventBus, tick: number): void {
  for (const listing of listAllMarketListings(db)) {
    const def = getGoodDefinition(listing.goodType);
    const reference = referenceStockFor(listing);
    if (!reference || reference <= 0) continue;

    if (def.merchantImports && listing.quantity < reference * IMPORT_TRIGGER_FRACTION) {
      // Restocks to the healthy reference level, so a shortage of any size
      // is met within a day — but never below the merchant's asking price
      // (base × IMPORT_PRICE_MULTIPLIER): imports carry the cost of the
      // road, so a local producer can always undercut them. (An earlier
      // version waited for the price itself to climb first, which lagged an
      // empty shelf by a day — every other day was a famine day.)
      const batch = Math.ceil(reference - listing.quantity);
      const askingPrice = Math.max(listing.price, Math.ceil(def.basePrice * IMPORT_PRICE_MULTIPLIER));
      db.run('UPDATE market_listings SET quantity = quantity + ?, price = ? WHERE id = ?', [
        batch,
        askingPrice,
        listing.id,
      ]);
      recordMarketFlow(db, listing.siteId, listing.goodType, tick, 'imported', batch);
      bus.emit({
        tick,
        scope: 'business',
        actorId: MERCHANT_ID,
        type: 'market.imported',
        message: `A merchant brings ${batch} ${listing.goodType} to market at ${askingPrice} coin.`,
        data: { goodType: listing.goodType, quantity: batch, price: askingPrice },
      });
      continue;
    }

    if (def.merchantExports && listing.quantity > reference * EXPORT_TRIGGER_MULTIPLIER) {
      exportGlut(db, bus, listing, reference, tick);
    }
  }
}

function exportGlut(
  db: Database,
  bus: EventBus,
  listing: MarketListing,
  reference: number,
  tick: number,
): void {
  const def = getGoodDefinition(listing.goodType);
  const limit = Math.min(
    listing.quantity - reference * EXPORT_TRIGGER_MULTIPLIER,
    Math.ceil(reference * EXPORT_DAILY_FRACTION),
  );
  const units = queryRows(
    db,
    `SELECT items.id, market_consignments.consignor_id FROM items
     JOIN market_consignments ON market_consignments.item_id = items.id
     WHERE items.container_id = ? AND items.type = ? AND items.status = 'active'
       AND market_consignments.consigned_at_tick <= ?
     ORDER BY items.rowid LIMIT ?`,
    [
      marketStockContainerId(listing.siteId),
      listing.goodType,
      tick - EXPORT_MIN_DAYS_UNSOLD * MINUTES_PER_DAY,
      limit,
    ],
  ).map((row) => ({ itemId: String(row[0]), consignorId: String(row[1]) }));
  if (units.length === 0) return;

  const unitPrice = Math.max(1, Math.floor(def.basePrice * EXPORT_PRICE_FACTOR));
  const perConsignor = new Map<string, number>();
  for (const unit of units) {
    destroyItem(db, bus, unit.itemId, 'exported', tick, {
      actorId: MERCHANT_ID,
      note: `Bought by a merchant for export.`,
      scope: 'business',
    });
    db.run('DELETE FROM market_consignments WHERE item_id = ?', [unit.itemId]);
    perConsignor.set(unit.consignorId, (perConsignor.get(unit.consignorId) ?? 0) + 1);
  }
  db.run('UPDATE market_listings SET quantity = quantity - ? WHERE id = ?', [units.length, listing.id]);
  recordMarketFlow(db, listing.siteId, listing.goodType, tick, 'exported', units.length);
  for (const [consignorId, count] of perConsignor) {
    const amount = count * unitPrice;
    faucetCoin(
      db,
      bus,
      consignorId,
      amount,
      tick,
      `A merchant buys ${count} surplus ${listing.goodType} for export at ${unitPrice} coin each.`,
      'business',
      'export',
    );
    recordLedgerEntry(db, consignorId, tick, 'revenue', amount, `Exported ${count} ${listing.goodType}.`);
  }
}
