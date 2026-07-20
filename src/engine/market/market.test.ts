import { describe, expect, it } from 'vitest';
import { summarizeLedger } from '../companies/companies';
import { createDatabase } from '../db/sqlite';
import { loadSqlJs } from '../db/sqlite.node';
import { Engine } from '../engine';
import {
  companyBuyFromMarket,
  createBuyActionDefinition,
  createSellActionDefinition,
  sellSurplusToMarket,
} from './market';

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

  it('§Stage 5 closed economy: buying from a producer-backed listing pays the producer, not a merchant faucet', async () => {
    const SQL = await loadSqlJs();
    const db = createDatabase(SQL);
    const engine = Engine.bootstrap(db, { seed: 'market-closed-loop' });
    engine.createSite({ id: 'market', name: 'Market', kind: 'market', x: 0, y: 0 });
    engine.createCompany({ id: 'bakery-co', name: 'Bakery Co', kind: 'bakery', siteId: 'market' });
    engine.produceItem({ id: 'bread-1', type: 'bread', containerId: 'bakery-co' });

    const sold = sellSurplusToMarket(
      engine.db,
      engine.bus,
      'bakery-co',
      'market',
      'bread',
      1,
      2,
      engine.tick,
    );
    expect(sold).toBe(1);
    expect(engine.getMarketListing('market', 'bread')?.producerCompanyId).toBe('bakery-co');

    engine.createEntity('buyer-1', 'Buyer');
    engine.ensureWallet('buyer-1');
    engine.faucetCoin('buyer-1', 10, 'starting coin');
    engine.registerActionType(createBuyActionDefinition('market', 'bread'));
    engine.queueAction('buyer-1', 'buy_bread');
    engine.advanceTicks(10);

    expect(engine.getBalance('buyer-1')).toBe(8); // paid 2, not sunk out of the economy
    expect(engine.getBalance('bakery-co')).toBe(2); // ...it landed on the real producer
    const ledger = summarizeLedger(engine.db, 'bakery-co', 0);
    expect(ledger.revenue).toBe(2);

    engine.dispose();
  });

  it("companyBuyFromMarket pays the producer and is capped by the buyer's own coin", async () => {
    const SQL = await loadSqlJs();
    const db = createDatabase(SQL);
    const engine = Engine.bootstrap(db, { seed: 'market-b2b' });
    engine.createSite({ id: 'market', name: 'Market', kind: 'market', x: 0, y: 0 });
    engine.createCompany({ id: 'farm-co', name: 'Farm Co', kind: 'farm', siteId: 'market' });
    for (let i = 0; i < 5; i++)
      engine.produceItem({ id: `grain-${i}`, type: 'grain', containerId: 'farm-co' });
    sellSurplusToMarket(engine.db, engine.bus, 'farm-co', 'market', 'grain', 5, 3, engine.tick);

    engine.createCompany({ id: 'mill-co', name: 'Mill Co', kind: 'mill', siteId: 'market' });
    engine.faucetCoin('mill-co', 7, 'just enough for two units'); // 2 * 3 coin = 6, one more attempt fails

    const bought = companyBuyFromMarket(engine.db, engine.bus, 'mill-co', 'market', 'grain', 5, engine.tick);
    expect(bought).toBe(2); // capped by mill-co's own coin, not the requested 5
    expect(engine.getBalance('mill-co')).toBe(1);
    expect(engine.getBalance('farm-co')).toBe(6);

    engine.dispose();
  });
});
