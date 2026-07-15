import { describe, expect, it } from 'vitest';
import { createDatabase } from '../db/sqlite';
import { loadSqlJs } from '../db/sqlite.node';
import { Engine } from '../engine';
import { createBuyActionDefinition, createSellActionDefinition } from './market';

describe('market', () => {
  it('buying spends coin, produces the item, and decrements finite stock', async () => {
    const SQL = await loadSqlJs();
    const db = createDatabase(SQL);
    const engine = Engine.bootstrap(db, { seed: 'market-buy' });
    engine.createEntity('villager-1', 'Test Villager');
    engine.ensureWallet('villager-1');
    engine.faucetCoin('villager-1', 10, 'starting coin');
    engine.createSite({ id: 'market', name: 'Market', kind: 'market', x: 0, y: 0 });
    engine.seedMarketListing('market', 'bread', 2, 2);
    engine.registerActionType(createBuyActionDefinition('market', 'bread'));

    engine.queueAction('villager-1', 'buy_bread');
    engine.advanceTicks(10);

    expect(engine.getBalance('villager-1')).toBe(8);
    expect(engine.getMarketListing('market', 'bread')?.quantity).toBe(1);
    const items = engine.getActorActions('villager-1');
    expect(items[0]?.outcome?.success).toBe(true);

    engine.dispose();
  });

  it('buying fails gracefully when stock or coin runs out', async () => {
    const SQL = await loadSqlJs();
    const db = createDatabase(SQL);
    const engine = Engine.bootstrap(db, { seed: 'market-buy-fail' });
    engine.createEntity('villager-2', 'Test Villager 2');
    engine.ensureWallet('villager-2');
    engine.createSite({ id: 'market', name: 'Market', kind: 'market', x: 0, y: 0 });
    engine.seedMarketListing('market', 'bread', 2, 1);
    engine.registerActionType(createBuyActionDefinition('market', 'bread'));

    // No coin at all.
    engine.queueAction('villager-2', 'buy_bread');
    engine.advanceTicks(10);
    expect(engine.getActorActions('villager-2')[0]?.status).toBe('failed');
    expect(engine.getMarketListing('market', 'bread')?.quantity).toBe(1); // untouched

    engine.dispose();
  });

  it('selling transfers the item into the stall stock and pays the seller', async () => {
    const SQL = await loadSqlJs();
    const db = createDatabase(SQL);
    const engine = Engine.bootstrap(db, { seed: 'market-sell' });
    engine.createEntity('villager-3', 'Test Villager 3');
    engine.ensureWallet('villager-3');
    engine.createSite({ id: 'market', name: 'Market', kind: 'market', x: 0, y: 0 });
    engine.produceItem({ id: 'firewood-1', type: 'firewood', containerId: 'villager-3' });
    engine.registerActionType(createSellActionDefinition('market', 'firewood'));

    engine.queueAction('villager-3', 'sell_firewood');
    engine.advanceTicks(10);

    expect(engine.getBalance('villager-3')).toBe(3); // firewood's catalog base price
    expect(engine.getItem('firewood-1')?.status).toBe('active'); // transferred, not destroyed
    expect(engine.getItem('firewood-1')?.containerId).toBe('market-stock');
    expect(engine.getMarketListing('market', 'firewood')?.quantity).toBe(1);

    engine.dispose();
  });

  it('selling fails when the actor has none of the good', async () => {
    const SQL = await loadSqlJs();
    const db = createDatabase(SQL);
    const engine = Engine.bootstrap(db, { seed: 'market-sell-fail' });
    engine.createEntity('villager-4', 'Test Villager 4');
    engine.createSite({ id: 'market', name: 'Market', kind: 'market', x: 0, y: 0 });
    engine.registerActionType(createSellActionDefinition('market', 'firewood'));

    engine.queueAction('villager-4', 'sell_firewood');
    engine.advanceTicks(10);
    expect(engine.getActorActions('villager-4')[0]?.status).toBe('failed');

    engine.dispose();
  });
});
