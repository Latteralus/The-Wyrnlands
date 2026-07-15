import { queryRow, queryRows } from '../db/sqlite';
import { getGoodDefinition } from '../goods/catalog';
import { findFirstActiveItem, produceItem, transferItem } from '../inventory/items';
import { faucetCoin, getBalance, sinkCoin } from '../inventory/wallet';
import { withOptional } from '../optional';
import type { ActionDefinition } from '../actions/types';
import type { Database } from 'sql.js';

export interface MarketListing {
  id: number;
  siteId: string;
  goodType: string;
  price: number;
  quantity: number;
}

function rowToListing(row: unknown[]): MarketListing {
  return {
    id: Number(row[0]),
    siteId: String(row[1]),
    goodType: String(row[2]),
    price: Number(row[3]),
    quantity: Number(row[4]),
  };
}

const LISTING_COLUMNS = 'id, site_id, good_type, price, quantity';

// Finite seeded stock (§Stage 2) — a one-time stall inventory, no
// restocking or price drift until Stage 5's smoothed pricing (§8.1 rule 4).
export function seedListing(
  db: Database,
  siteId: string,
  goodType: string,
  price: number,
  quantity: number,
): void {
  db.run('INSERT INTO market_listings (site_id, good_type, price, quantity) VALUES (?, ?, ?, ?)', [
    siteId,
    goodType,
    price,
    quantity,
  ]);
}

export function getListing(db: Database, siteId: string, goodType: string): MarketListing | null {
  const row = queryRow(
    db,
    `SELECT ${LISTING_COLUMNS} FROM market_listings WHERE site_id = ? AND good_type = ?`,
    [siteId, goodType],
  );
  return row ? rowToListing(row) : null;
}

export function listListingsForSite(db: Database, siteId: string): MarketListing[] {
  return queryRows(
    db,
    `SELECT ${LISTING_COLUMNS} FROM market_listings WHERE site_id = ? ORDER BY good_type`,
    [siteId],
  ).map(rowToListing);
}

// Decrements stock; throws if there isn't enough (callers must check
// availability — e.g. via getListing — before spending the buyer's coin).
export function decrementStock(db: Database, siteId: string, goodType: string, quantity: number): void {
  const listing = getListing(db, siteId, goodType);
  if (!listing || listing.quantity < quantity) {
    throw new Error(`Insufficient stock of "${goodType}" at "${siteId}"`);
  }
  db.run('UPDATE market_listings SET quantity = quantity - ? WHERE id = ?', [quantity, listing.id]);
}

const BUY_DURATION_TICKS = 5; // a quick errand (§4.3), not a shift

// A timed "buy" action bound to one (site, good) listing — §8.1's imports
// modeled literally: coin sinks out of the closed economy, the good is
// produced into existence (a goods faucet) into the buyer's own container.
// No merchant entity exists yet to hold the coin instead (Stage 3+ jobs).
export function createBuyActionDefinition(siteId: string, goodType: string): ActionDefinition {
  return {
    type: `buy_${goodType}`,
    durationTicks: BUY_DURATION_TICKS,
    resolve: (_rng, ctx) => {
      const listing = getListing(ctx.db, siteId, goodType);
      if (!listing || listing.quantity <= 0) {
        return { success: false, message: `There's no ${goodType} left at the stall.` };
      }
      if (getBalance(ctx.db, ctx.actorId) < listing.price) {
        return { success: false, message: `You can't afford ${goodType} (${listing.price} coin).` };
      }
      return {
        success: true,
        message: `You buy ${goodType} for ${listing.price} coin.`,
        data: { price: listing.price },
      };
    },
    applyOutcome: (ctx, outcome) => {
      if (!outcome.success) return;
      const price = Number(outcome.data?.price);
      decrementStock(ctx.db, siteId, goodType, 1);
      sinkCoin(ctx.db, ctx.bus, ctx.actorId, price, ctx.tick, `Paid ${price} coin for ${goodType}.`);
      produceItem(
        ctx.db,
        ctx.bus,
        withOptional(
          {
            id: `${ctx.actorId}-${goodType}-${ctx.tick}`,
            type: goodType,
            containerId: ctx.actorId,
            tick: ctx.tick,
            actorId: ctx.actorId,
            note: `Bought ${goodType} at the market.`,
          },
          { durability: getGoodDefinition(goodType).maxDurability },
        ),
      );
    },
  };
}

function marketStockContainerId(siteId: string): string {
  return `${siteId}-stock`;
}

// The reverse of buying: the item goes into the stall's own storage (goods
// conservation — §8.1 rule 1, "every transfer transactional and logged,"
// not a destruction) and the listing's quantity grows to match, so a sold
// firewood is genuinely available for the next buyer. Coin faucets in,
// mirroring §8.1's "export purchases."
export function createSellActionDefinition(siteId: string, goodType: string): ActionDefinition {
  return {
    type: `sell_${goodType}`,
    durationTicks: BUY_DURATION_TICKS,
    resolve: (_rng, ctx) => {
      const item = findFirstActiveItem(ctx.db, ctx.actorId, goodType);
      if (!item) return { success: false, message: `You have no ${goodType} to sell.` };
      const price = getGoodDefinition(goodType).basePrice;
      return {
        success: true,
        message: `You sell a ${goodType} for ${price} coin.`,
        data: { itemId: item.id, price },
      };
    },
    applyOutcome: (ctx, outcome) => {
      if (!outcome.success) return;
      const itemId = String(outcome.data?.itemId);
      const price = Number(outcome.data?.price);
      transferItem(ctx.db, ctx.bus, itemId, marketStockContainerId(siteId), ctx.tick, {
        actorId: ctx.actorId,
        note: `Sold to the market stall.`,
      });
      const listing = getListing(ctx.db, siteId, goodType);
      if (listing) {
        ctx.db.run('UPDATE market_listings SET quantity = quantity + 1 WHERE id = ?', [listing.id]);
      } else {
        seedListing(ctx.db, siteId, goodType, getGoodDefinition(goodType).basePrice, 1);
      }
      faucetCoin(ctx.db, ctx.bus, ctx.actorId, price, ctx.tick, `Paid ${price} coin for your ${goodType}.`);
    },
  };
}
