import { queryRows } from '../db/sqlite';
import { getGoodDefinition } from '../goods/catalog';
import { canCarry } from '../inventory/capacity';
import { transferItem } from '../inventory/items';
import { getBalance } from '../inventory/wallet';
import { recordMarketActivity } from './activity';
import { buyFromMarket, describeSources, getListing, marketStockContainerId, seedListing } from './market';
import { marketTradeType, parseMarketTrade, type MarketTradeRequest } from './tradeTypes';
import type { ActionRegistry } from '../actions/registry';
import type { ActionDefinition } from '../actions/types';
import type { Database } from '../db/sqlite';

export { actionLabel, marketTradeType, parseMarketTrade } from './tradeTypes';
export type { MarketTradeKind, MarketTradeRequest } from './tradeTypes';

function availableItems(db: Database, actorId: string, request: MarketTradeRequest): string[] {
  const withdrawing = request.kind === 'withdraw';
  return queryRows(
    db,
    withdrawing
      ? `SELECT i.id FROM items i JOIN market_consignments c ON c.item_id = i.id
         WHERE i.container_id = ? AND i.type = ? AND i.status = 'active'
           AND c.consignor_id = ? AND c.site_id = ? ORDER BY i.rowid LIMIT ?`
      : `SELECT i.id FROM items i LEFT JOIN gear g ON g.item_id = i.id
         WHERE i.container_id = ? AND i.type = ? AND i.status = 'active'
           AND g.item_id IS NULL ORDER BY i.rowid LIMIT ?`,
    withdrawing
      ? [marketStockContainerId(request.siteId), request.goodType, actorId, request.siteId, request.quantity]
      : [actorId, request.goodType, request.quantity],
  ).map((row) => String(row[0]));
}

export function createPlayerTradeAction(request: MarketTradeRequest): ActionDefinition {
  return {
    type: marketTradeType(request),
    durationTicks: 5,
    startMessage: () =>
      `You head to the market to ${request.kind === 'list' ? 'list' : request.kind} ${request.quantity} ${request.goodType}.`,
    resolve: (_rng, ctx) => {
      const site = queryRows(ctx.db, "SELECT id FROM sites WHERE id = ? AND kind = 'market'", [
        request.siteId,
      ]);
      if (site.length === 0) return { success: false, message: 'This market is no longer available.' };
      const listing = getListing(ctx.db, request.siteId, request.goodType);
      const weight = getGoodDefinition(request.goodType).weightKg * request.quantity;
      if (request.kind === 'buy') {
        if (!listing || listing.quantity < request.quantity)
          return {
            success: false,
            message: `There aren't ${request.quantity} ${request.goodType} left at the stall.`,
          };
        if (getBalance(ctx.db, ctx.actorId) < listing.price * request.quantity)
          return {
            success: false,
            message: `You can't afford ${request.quantity} ${request.goodType} at the current price (${listing.price * request.quantity} coin).`,
          };
      } else {
        const ids = availableItems(ctx.db, ctx.actorId, request);
        if (ids.length < request.quantity)
          return {
            success: false,
            message:
              request.kind === 'list'
                ? `You don't have ${request.quantity} unworn ${request.goodType} in your pack.`
                : `You no longer have ${request.quantity} unsold ${request.goodType} at this market.`,
          };
        if (request.kind === 'withdraw' && (!listing || listing.quantity < request.quantity)) {
          return { success: false, message: 'The market stock has changed. Please check your listings.' };
        }
      }
      if (request.kind !== 'list' && !canCarry(ctx.db, ctx.actorId, weight))
        return {
          success: false,
          message: `Your pack has no room for ${request.quantity} ${request.goodType} (${weight} kg).`,
        };
      return { success: true, message: 'Your market errand is complete.', quiet: true };
    },
    applyOutcome: (ctx, outcome) => {
      if (!outcome.success) return;
      const { siteId, goodType, quantity, kind } = request;
      if (kind === 'buy') {
        const purchase = buyFromMarket(ctx.db, ctx.bus, ctx.actorId, siteId, goodType, quantity, ctx.tick, {
          actorId: ctx.actorId,
        });
        ctx.bus.emit({
          tick: ctx.tick,
          scope: 'personal',
          actorId: ctx.actorId,
          type: 'market.purchase',
          message: `You buy ${quantity} ${goodType} for ${purchase.totalCost} coin (${purchase.unitPrice} each) — ${describeSources(ctx.db, purchase.sources)}.`,
          data: {
            siteId,
            goodType,
            units: quantity,
            unitPrice: purchase.unitPrice,
            cost: purchase.totalCost,
            sources: purchase.sources,
          },
        });
        return;
      }
      const ids = availableItems(ctx.db, ctx.actorId, request);
      const listing = getListing(ctx.db, siteId, goodType);
      const price = listing?.price ?? getGoodDefinition(goodType).basePrice;
      for (const id of ids) {
        transferItem(
          ctx.db,
          ctx.bus,
          id,
          kind === 'list' ? marketStockContainerId(siteId) : ctx.actorId,
          ctx.tick,
          {
            actorId: ctx.actorId,
            note: kind === 'list' ? 'Listed for sale at the market.' : 'Withdrawn unsold from the market.',
          },
        );
        if (kind === 'list')
          ctx.db.run(
            'INSERT INTO market_consignments (item_id, site_id, consignor_id, consigned_at_tick) VALUES (?, ?, ?, ?)',
            [id, siteId, ctx.actorId, ctx.tick],
          );
        else ctx.db.run('DELETE FROM market_consignments WHERE item_id = ?', [id]);
      }
      if (listing)
        ctx.db.run('UPDATE market_listings SET quantity = quantity + ? WHERE id = ?', [
          kind === 'list' ? quantity : -quantity,
          listing.id,
        ]);
      else seedListing(ctx.db, siteId, goodType, price, quantity);
      recordMarketActivity(ctx.db, {
        siteId,
        tick: ctx.tick,
        kind: kind === 'list' ? 'listed' : 'withdrawn',
        goodType,
        quantity,
        unitPrice: price,
        sellerId: ctx.actorId,
        buyerId: null,
      });
      ctx.bus.emit({
        tick: ctx.tick,
        scope: 'personal',
        actorId: ctx.actorId,
        type: `market.${kind === 'list' ? 'listed' : 'withdrawn'}`,
        message:
          kind === 'list'
            ? `You list ${quantity} ${goodType} at the market's current price of ${price} coin each. You are paid when it sells.`
            : `You take ${quantity} unsold ${goodType} back into your pack.`,
        data: { siteId, goodType, units: quantity, price },
      });
    },
  };
}

export function registerPlayerMarketAction(registry: ActionRegistry, type: string): void {
  const request = parseMarketTrade(type);
  if (request && !registry.has(type)) registry.register(createPlayerTradeAction(request));
}
