import { getGoodDefinition } from '../goods/catalog';
import { findFirstActiveItem, countActiveItemsOfType, transferItem } from '../inventory/items';
import { getBalance, transferCoin } from '../inventory/wallet';
import { listJobOpenings } from '../jobs/jobs';
import { recordMarketActivity } from '../market/activity';
import { recordMarketFlow } from '../market/history';
import { getListing } from '../market/market';
import { getRecipeForSkill } from '../production/recipes';
import { getCompany, recordLedgerEntry, type Company } from './companies';
import type { Database } from '../db/sqlite';
import type { EventBus } from '../eventBus';

// Direct trade between local businesses (§9.7's "the bakery contracts
// standing flour deliveries from the mill", minus freight — everything is
// in one settlement until Stage 7's transport). A business that needs an
// input buys it straight from the producers that make it before going to
// the market stall, out of their fresh, not-yet-consigned stock.
//
// Why both sides prefer it: the buyer pays the "trade price", a little
// under the stall's price (TRADE_DISCOUNT); the seller is paid on the spot
// instead of consigning goods to the stall, where they're paid only if and
// when someone buys — and may sit, spoil or be exported cheaply first.
// Companies/decisions.ts runs every business's buying before anyone's
// selling to market each day, so fresh output is still on hand to be sold
// this way.
//
// Goods and coin move as they would at market: real items (provenance kept)
// and a real transfer, recorded in both ledgers with units, and in the
// market history as local sales — demand signals (companies/opportunity.ts)
// count business-to-business trade like any other.

const MARKET_SITE_ID = 'market';
export const TRADE_DISCOUNT = 0.05;

// What a good changes hands for between businesses today.
export function tradePrice(db: Database, goodType: string): number {
  const market = getListing(db, MARKET_SITE_ID, goodType)?.price ?? getGoodDefinition(goodType).basePrice;
  return Math.max(1, Math.round(market * (1 - TRADE_DISCOUNT)));
}

// Open businesses whose trade produces this good, in a stable order.
function suppliersOf(db: Database, goodType: string, exceptId: string): string[] {
  const ids = new Set<string>();
  for (const slot of listJobOpenings(db)) {
    if (slot.companyId === exceptId) continue;
    if (getRecipeForSkill(slot.skill)?.outputGood === goodType) ids.add(slot.companyId);
  }
  return [...ids].sort();
}

// Buys up to maxQuantity of a good straight from local producers' stock, at
// the trade price, as far as the buyer's cash allows. Returns units bought.
export function buyFromLocalSuppliers(
  db: Database,
  bus: EventBus,
  buyer: Company,
  goodType: string,
  maxQuantity: number,
  tick: number,
): number {
  const price = tradePrice(db, goodType);
  let remaining = Math.min(maxQuantity, Math.floor(getBalance(db, buyer.id) / price));
  let bought = 0;
  for (const supplierId of suppliersOf(db, goodType, buyer.id)) {
    if (remaining <= 0) break;
    const units = Math.min(remaining, countActiveItemsOfType(db, supplierId, goodType));
    if (units <= 0) continue;

    const supplierName = getCompany(db, supplierId)?.name ?? supplierId;
    const note = `${supplierName} sells ${units} ${goodType} to ${buyer.name} at ${price} each.`;
    transferCoin(db, bus, buyer.id, supplierId, units * price, tick, note, 'business');
    for (let i = 0; i < units; i++) {
      const item = findFirstActiveItem(db, supplierId, goodType);
      if (!item) throw new Error(`${supplierId} ran out of ${goodType} mid-sale`);
      transferItem(db, bus, item.id, buyer.id, tick, { actorId: supplierId, note, scope: 'business' });
    }
    recordLedgerEntry(
      db,
      supplierId,
      tick,
      'revenue',
      units * price,
      `Sold ${units} ${goodType} to ${buyer.name}.`,
      units,
    );
    recordLedgerEntry(
      db,
      buyer.id,
      tick,
      'material_cost',
      units * price,
      `Bought ${units} ${goodType} from ${supplierName}.`,
      units,
    );
    recordMarketFlow(db, MARKET_SITE_ID, goodType, tick, 'sold', units);
    recordMarketActivity(db, {
      siteId: MARKET_SITE_ID,
      tick,
      kind: 'direct',
      goodType,
      quantity: units,
      unitPrice: price,
      sellerId: supplierId,
      buyerId: buyer.id,
    });
    bus.emit({
      tick,
      scope: 'business',
      actorId: supplierId,
      type: 'business.direct_sale',
      message: `Sells ${units} ${goodType} straight to ${buyer.name}: ${price} coin each, ${units * price} coin in all.`,
      data: { buyerId: buyer.id, goodType, units, price },
    });
    bus.emit({
      tick,
      scope: 'business',
      actorId: buyer.id,
      type: 'business.bought',
      message: `Buys ${units} ${goodType} straight from ${supplierName}: ${price} coin each, ${units * price} coin in all.`,
      data: { supplierId, goodType, units, price },
    });
    remaining -= units;
    bought += units;
  }
  return bought;
}
