import { recordLedgerEntry } from '../companies/companies';
import { queryRow, queryRows } from '../db/sqlite';
import { getGoodDefinition } from '../goods/catalog';
import { findFirstActiveItem, produceItem, transferItem } from '../inventory/items';
import { faucetCoin, getBalance, sinkCoin, transferCoin } from '../inventory/wallet';
import { withOptional } from '../optional';
import type { ActionDefinition } from '../actions/types';
import type { EventBus } from '../eventBus';
import type { Database } from 'sql.js';

export interface MarketListing {
  id: number;
  siteId: string;
  goodType: string;
  price: number;
  quantity: number;
  // §Stage 5 / §8.1 rule 4 "closed economy": which company's real production
  // this stock represents, or null for an unbacked merchant-faucet import
  // (§7.2: "imported... at first, produced locally as chains come online").
  // One producer per (site, good) — a deliberate v1 simplification, not
  // per-seller competition; see sellSurplusToMarket's header comment.
  producerCompanyId: string | null;
  // The "healthy" stock level this listing's price is scarce/plentiful
  // relative to (§8.1 rule 4's scarcity factor) — set once at seed time.
  referenceStock: number | null;
}

function rowToListing(row: unknown[]): MarketListing {
  return {
    id: Number(row[0]),
    siteId: String(row[1]),
    goodType: String(row[2]),
    price: Number(row[3]),
    quantity: Number(row[4]),
    producerCompanyId: typeof row[5] === 'string' ? row[5] : null,
    referenceStock: row[6] === null ? null : Number(row[6]),
  };
}

const LISTING_COLUMNS = 'id, site_id, good_type, price, quantity, producer_company_id, reference_stock';

// Finite seeded stock (§Stage 2), unbacked by any producer (a merchant-
// faucet import, §7.2) — real production (sellSurplusToMarket) tags its own
// listings with a producerCompanyId instead. The seeded quantity doubles as
// this listing's reference_stock (§8.1 rule 4's scarcity baseline).
export function seedListing(
  db: Database,
  siteId: string,
  goodType: string,
  price: number,
  quantity: number,
): void {
  db.run(
    'INSERT INTO market_listings (site_id, good_type, price, quantity, reference_stock) VALUES (?, ?, ?, ?, ?)',
    [siteId, goodType, price, quantity, quantity],
  );
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

// §Stage 5's smoothed pricing (market/pricing.ts) drifts every listing in
// the world once a day — this is its read side.
export function listAllMarketListings(db: Database): MarketListing[] {
  return queryRows(db, `SELECT ${LISTING_COLUMNS} FROM market_listings ORDER BY site_id, good_type`).map(
    rowToListing,
  );
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

      // §Stage 5 closed economy: a listing backed by a real producer (see
      // MarketListing.producerCompanyId) pays that company instead of
      // sinking the coin out of the economy — everything still unbacked
      // (shoes, cloaks) stays exactly the §8.1 "import" it always was.
      const listing = getListing(ctx.db, siteId, goodType);
      if (listing?.producerCompanyId) {
        transferCoin(
          ctx.db,
          ctx.bus,
          ctx.actorId,
          listing.producerCompanyId,
          price,
          ctx.tick,
          `Paid ${price} coin for ${goodType}.`,
        );
        recordLedgerEntry(
          ctx.db,
          listing.producerCompanyId,
          ctx.tick,
          'revenue',
          price,
          `Sold ${goodType} at the market.`,
        );
      } else {
        sinkCoin(ctx.db, ctx.bus, ctx.actorId, price, ctx.tick, `Paid ${price} coin for ${goodType}.`);
      }
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

// Exported for reuse anywhere else that needs to sell an item into a
// market's stock outside the player's own sell_<good> timed action — e.g.
// a household's adaptation ladder (§Stage 4, §10 "sell belongings").
export function marketStockContainerId(siteId: string): string {
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

// §Stage 5 §9.6 "decide daily... input orders": a company selling its own
// real surplus into a market listing — transfers actual produced items
// (goods conservation, same as the player's own sell action above) rather
// than conjuring quantity from nothing. Always overwrites the listing's
// producerCompanyId to the seller (a deliberate v1 simplification: one
// current producer per (site, good), not per-unit provenance of the stall's
// stock — once a company sells into a listing, buyers pay *that* company
// even against any older, differently-sourced stock still sitting in the
// same listing's count). Returns how many units actually sold (capped by
// real inventory — a company can never sell more than it has).
export function sellSurplusToMarket(
  db: Database,
  bus: EventBus,
  companyId: string,
  siteId: string,
  goodType: string,
  quantity: number,
  unitPrice: number,
  tick: number,
): number {
  let sold = 0;
  for (let i = 0; i < quantity; i++) {
    const item = findFirstActiveItem(db, companyId, goodType);
    if (!item) break;
    transferItem(db, bus, item.id, marketStockContainerId(siteId), tick, {
      actorId: companyId,
      note: `Sold to the market.`,
      scope: 'business',
    });
    sold++;
  }
  if (sold === 0) return 0;

  const listing = getListing(db, siteId, goodType);
  if (listing) {
    db.run('UPDATE market_listings SET quantity = quantity + ?, producer_company_id = ? WHERE id = ?', [
      sold,
      companyId,
      listing.id,
    ]);
  } else {
    db.run(
      `INSERT INTO market_listings (site_id, good_type, price, quantity, producer_company_id, reference_stock)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [siteId, goodType, unitPrice, sold, companyId, Math.max(sold * 4, 10)],
    );
  }
  return sold;
}

// §Stage 5 §9.6 "input orders": a company buying from the market as a
// spot-purchase — the B2B side of the closed loop (a mill restocking grain,
// a bakery restocking flour). This is *not* §9.7's standing B2B contracts
// (scheduled recurring shipments with their own terms, fulfilled by real
// freight) — that needs the transport/freight module, which doesn't exist
// yet; spot purchases through the same market listings every other buyer
// uses is the honest, smaller mechanism this stage actually builds.
//
// Coin/stock/ledger are settled as ONE lump transaction for the whole
// purchase, not unit by unit — found the hard way: an earlier per-unit
// version (transferCoin + recordLedgerEntry inside the loop) emitted two
// event_log rows per unit, and a well-managed company restocking daily in
// 40-unit batches over a 90-day run pushed stage4.test.ts's checkpointed
// run from ~165s past its 300s regression guard. This matches the existing
// precedent of population/cadence.ts's own weekly lump wage payment (one
// event for a week's wages, not one per shift). Item creation is still
// genuinely per-unit below — §7.1 provenance is per-item by design, not
// something to batch away — so this halves the event/DB-write volume
// without losing any provenance fidelity.
// Returns how many units were actually bought (capped by stock and by the
// buyer's own coin).
export function companyBuyFromMarket(
  db: Database,
  bus: EventBus,
  companyId: string,
  siteId: string,
  goodType: string,
  maxQuantity: number,
  tick: number,
): number {
  const listing = getListing(db, siteId, goodType);
  if (!listing || listing.quantity <= 0 || listing.price <= 0) return 0;

  const maxAffordable = Math.floor(getBalance(db, companyId) / listing.price);
  const quantity = Math.min(maxQuantity, listing.quantity, maxAffordable);
  if (quantity <= 0) return 0;

  const totalCost = quantity * listing.price;
  decrementStock(db, siteId, goodType, quantity);
  if (listing.producerCompanyId) {
    transferCoin(
      db,
      bus,
      companyId,
      listing.producerCompanyId,
      totalCost,
      tick,
      `Bought ${quantity} ${goodType} from the market.`,
      'business',
    );
    recordLedgerEntry(
      db,
      listing.producerCompanyId,
      tick,
      'revenue',
      totalCost,
      `Sold ${quantity} ${goodType} at the market.`,
    );
  } else {
    sinkCoin(
      db,
      bus,
      companyId,
      totalCost,
      tick,
      `Bought ${quantity} ${goodType} from the market.`,
      'business',
    );
  }
  recordLedgerEntry(
    db,
    companyId,
    tick,
    'material_cost',
    totalCost,
    `Bought ${quantity} ${goodType} at the market.`,
  );

  for (let i = 0; i < quantity; i++) {
    produceItem(db, bus, {
      id: `${companyId}-${goodType}-${tick}-${i}`,
      type: goodType,
      containerId: companyId,
      tick,
      note: `Bought ${goodType} at the market.`,
      scope: 'business',
    });
  }
  return quantity;
}
