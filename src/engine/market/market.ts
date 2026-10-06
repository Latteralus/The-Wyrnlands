import { recordLedgerEntry } from '../companies/companies';
import { queryRow, queryRows } from '../db/sqlite';
import { getGoodDefinition } from '../goods/catalog';
import { getConservationCounters } from '../inventory/counters';
import { findFirstActiveItem, produceItem, transferItem } from '../inventory/items';
import { faucetCoin, getBalance, sinkCoin, transferCoin } from '../inventory/wallet';
import { withOptional } from '../optional';
import { recordMarketFlow } from './history';
import type { ActionDefinition } from '../actions/types';
import type { EventBus, EventScope } from '../eventBus';
import type { Database } from 'sql.js';

export interface MarketListing {
  id: number;
  siteId: string;
  goodType: string;
  price: number;
  quantity: number;
  // The local company that most recently consigned real production into
  // this listing, or null if none ever has (a pure merchant-faucet import,
  // §7.2). Informational only — who actually gets paid for a given unit is
  // decided per unit by market_consignments (see buyFromMarket), not by
  // this field; paying it for every unit sold used to hand a producer the
  // revenue for merchant-import stock it never made.
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

// A timed "buy" action bound to one (site, good) listing — see
// buyFromMarket below for where the unit comes from and who is paid.
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
      buyFromMarket(ctx.db, ctx.bus, ctx.actorId, siteId, goodType, 1, ctx.tick, {
        actorId: ctx.actorId,
        note: `Bought ${goodType} at the market.`,
      });
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

// §Stage 5 §9.6 "decide daily... input orders": a company consigning its
// own real surplus to a market — transfers actual produced items (goods
// conservation, same as the player's own sell action above) rather than
// conjuring quantity from nothing, and records each unit as consigned by
// this company (market_consignments) so it's paid when — and only when —
// that unit is actually bought. Returns how many units were consigned
// (capped by real inventory — a company can never sell more than it has).
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
    db.run(
      'INSERT INTO market_consignments (item_id, site_id, consignor_id, consigned_at_tick) VALUES (?, ?, ?, ?)',
      [item.id, siteId, companyId, tick],
    );
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
// Settles through buyFromMarket below: coin is paid in one lump per seller
// (not per unit — an earlier per-unit version emitted two event_log rows
// per unit and measurably slowed long runs), while goods stay per-unit
// items with full provenance. Returns how many units were actually bought
// (capped by stock and by the buyer's own coin).
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

  const purchase = buyFromMarket(db, bus, companyId, siteId, goodType, quantity, tick, {
    note: `Bought ${quantity} ${goodType} at the market.`,
    scope: 'business',
  });
  recordLedgerEntry(
    db,
    companyId,
    tick,
    'material_cost',
    purchase.totalCost,
    `Bought ${quantity} ${goodType} at the market.`,
    purchase.itemIds.length,
  );
  return purchase.itemIds.length;
}

export interface MarketPurchase {
  // Every unit the buyer now holds, in the order taken (physical stock
  // first, oldest first; then any merchant imports).
  itemIds: string[];
  totalCost: number;
}

// The one way anything leaves a market (§8.1 rule 1). A listing's quantity
// is the real, physical units sitting in the site's stock container plus,
// for goods the merchant faucet still imports (§7.2: bread's seeded
// bridging buffer, shoes, cloaks, tools), a remainder with no physical
// existence yet. A purchase takes physical units first, oldest first —
// each keeps its own id and full provenance chain (so a household's loaf
// traces back through the market to the bakery that baked it) — and only
// the shortfall is produced fresh as a merchant import.
//
// Payment follows the units: a unit consigned by a local company
// (market_consignments) pays that company, one lump per company; a
// merchant-owned unit (the stall bought it outright from the player or a
// household, or it's an auctioned tool) or an import sinks the coin out
// of the economy — the merchant faucet's other side (§8.1 rule 2).
//
// Callers must have checked the buyer can afford quantity × listing price
// (transferCoin/sinkCoin throw otherwise). quantity is capped by the
// listing's own quantity.
export function buyFromMarket(
  db: Database,
  bus: EventBus,
  buyerId: string,
  siteId: string,
  goodType: string,
  quantity: number,
  tick: number,
  options: { actorId?: string; note?: string; scope?: EventScope } = {},
): MarketPurchase {
  const listing = getListing(db, siteId, goodType);
  const units = Math.min(quantity, listing?.quantity ?? 0);
  if (!listing || units <= 0) return { itemIds: [], totalCost: 0 };
  const price = listing.price;
  const scope = options.scope ?? 'personal';
  const note = options.note ?? `Bought ${goodType} at the market.`;

  const physical = queryRows(
    db,
    `SELECT items.id, market_consignments.consignor_id FROM items
     LEFT JOIN market_consignments ON market_consignments.item_id = items.id
     WHERE items.container_id = ? AND items.type = ? AND items.status = 'active'
     ORDER BY items.rowid LIMIT ?`,
    [marketStockContainerId(siteId), goodType, units],
  ).map((row) => ({ itemId: String(row[0]), consignorId: typeof row[1] === 'string' ? row[1] : null }));

  // Coin first (all-or-nothing: these throw on an unaffordable purchase
  // before any goods have moved). Map insertion order = stock order, so
  // the payment sequence is deterministic.
  const owedUnits = new Map<string, number>();
  let merchantUnits = units;
  for (const unit of physical) {
    if (!unit.consignorId) continue;
    owedUnits.set(unit.consignorId, (owedUnits.get(unit.consignorId) ?? 0) + 1);
    merchantUnits--;
  }
  for (const [consignorId, count] of owedUnits) {
    transferCoin(db, bus, buyerId, consignorId, count * price, tick, note, scope);
    recordLedgerEntry(
      db,
      consignorId,
      tick,
      'revenue',
      count * price,
      `Sold ${count} ${goodType} at the market.`,
      count,
    );
  }
  if (merchantUnits > 0) sinkCoin(db, bus, buyerId, merchantUnits * price, tick, note, scope, 'import');
  decrementStock(db, siteId, goodType, units);
  recordMarketFlow(db, siteId, goodType, tick, 'sold', units);

  const itemIds: string[] = [];
  for (const unit of physical) {
    transferItem(
      db,
      bus,
      unit.itemId,
      buyerId,
      tick,
      withOptional({ note, scope }, { actorId: options.actorId }),
    );
    if (unit.consignorId) db.run('DELETE FROM market_consignments WHERE item_id = ?', [unit.itemId]);
    itemIds.push(unit.itemId);
  }
  const maxDurability = getGoodDefinition(goodType).maxDurability;
  for (let i = physical.length; i < units; i++) {
    // goods_created is a world-unique, deterministic running count — a
    // collision-proof id however many purchases land in the same tick.
    const itemId = `import-${goodType}-${getConservationCounters(db).goodsCreated}`;
    produceItem(
      db,
      bus,
      withOptional(
        { id: itemId, type: goodType, containerId: buyerId, tick, note: `${note} (merchant import)`, scope },
        { actorId: options.actorId, durability: maxDurability },
      ),
    );
    itemIds.push(itemId);
  }
  return { itemIds, totalCost: units * price };
}
