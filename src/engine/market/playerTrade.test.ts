import { describe, expect, it } from 'vitest';
import { summarizeLedger } from '../companies/companies';
import { applyMigrations } from '../db/migrationRunner';
import { migrations } from '../db/migrations';
import { createDatabase, queryRows } from '../db/sqlite';
import { loadSqlJs } from '../db/sqlite.node';
import { Engine } from '../engine';
import { getGoodDefinition } from '../goods/catalog';
import { applySpoilage } from '../inventory/spoilage';
import { MINUTES_PER_DAY } from '../time/clock';
import { createUiApi } from '../ui-api';
import { buyFromMarket, sellSurplusToMarket } from './market';
import { applyMerchantTrade } from './merchant';
import type { MarketTradeKind } from './playerTrade';

async function newMarket() {
  const engine = Engine.bootstrap(createDatabase(await loadSqlJs()), { seed: 'player-market' });
  engine.createSite({ id: 'market', name: 'Market', kind: 'market', x: 0, y: 0 });
  engine.createEntity('player', 'You');
  engine.faucetCoin('player', 500);
  engine.createEntity('buyer', 'Buyer');
  engine.faucetCoin('buyer', 1000);
  return engine;
}

function trade(engine: Engine, kind: MarketTradeKind, goodType: string, quantity: number, actor = 'player') {
  engine.queueMarketTrade(actor, { kind, siteId: 'market', goodType, quantity });
  engine.advanceTicks(6);
}

function give(engine: Engine, goodType: string, count: number, prefix = goodType, owner = 'player') {
  for (let i = 0; i < count; i++)
    engine.produceItem({ id: `${prefix}-${i}`, type: goodType, containerId: owner });
}

describe('player market errands', () => {
  it('keeps free well water outside market trading', async () => {
    const engine = await newMarket();
    give(engine, 'water', 1);
    expect(engine.getMarketOverview('market', 'player').pack).toMatchObject([
      { goodType: 'water', marketable: false },
    ]);
    expect(() =>
      engine.queueMarketTrade('player', { kind: 'list', siteId: 'market', goodType: 'water', quantity: 1 }),
    ).toThrow(/not sold/);
    expect(engine.getMarketListing('market', 'water')).toBeNull();
    engine.dispose();
  });
  it('buys a chosen quantity of axes with full durability through the existing market settlement', async () => {
    const engine = await newMarket();
    engine.seedMarketListing('market', 'axe', 70, 5);
    trade(engine, 'buy', 'axe', 2);
    expect(engine.getBalance('player')).toBe(360);
    expect(engine.getMarketListing('market', 'axe')?.quantity).toBe(3);
    const axes = queryRows(
      engine.db,
      "SELECT durability FROM items WHERE container_id = 'player' AND type = 'axe'",
    );
    expect(axes).toEqual([[3000], [3000]]);
    expect(engine.queryMarketActivity('market')).toMatchObject([
      { kind: 'purchase', quantity: 2, unitPrice: 70 },
    ]);
    expect(engine.runConservationAudit().passed).toBe(true);
    engine.dispose();
  });

  it.each(['stock', 'price', 'capacity'] as const)(
    'rechecks %s at completion, failing without moving goods or coin',
    async (change) => {
      const engine = await newMarket();
      engine.seedMarketListing('market', 'axe', 70, 5);
      engine.queueMarketTrade('player', { kind: 'buy', siteId: 'market', goodType: 'axe', quantity: 2 });
      engine.advanceTicks(1);
      if (change === 'stock') engine.decrementMarketStock('market', 'axe', 4);
      if (change === 'price') engine.db.run("UPDATE market_listings SET price = 300 WHERE good_type = 'axe'");
      if (change === 'capacity') give(engine, 'firewood', 7);
      engine.advanceTicks(5);
      expect(engine.getActorActions('player').at(-1)?.status).toBe('failed');
      expect(engine.getBalance('player')).toBe(500);
      expect(engine.queryMarketActivity('market')).toEqual([]);
      expect(engine.getMarketOverview('market', 'player').pack.some((line) => line.goodType === 'axe')).toBe(
        false,
      );
      engine.dispose();
    },
  );

  it.each([0, -1, 1.5, NaN, Infinity, 1001])(
    'rejects invalid quantity %s before queueing',
    async (quantity) => {
      const engine = await newMarket();
      expect(() =>
        engine.queueMarketTrade('player', { kind: 'buy', siteId: 'market', goodType: 'axe', quantity }),
      ).toThrow();
      expect(engine.getActiveActions('player')).toEqual([]);
      engine.dispose();
    },
  );

  it('lists actual units, pays only on purchase, and preserves company settlement for mixed sellers', async () => {
    const engine = await newMarket();
    engine.seedMarketListing('market', 'firewood', 17, 1); // merchant stock
    engine.createCompany({ id: 'camp', name: 'Camp', kind: 'logging', siteId: 'market' });
    give(engine, 'firewood', 1, 'camp-wood', 'camp');
    sellSurplusToMarket(engine.db, engine.bus, 'camp', 'market', 'firewood', 1, 17, 0);
    give(engine, 'firewood', 3);
    trade(engine, 'list', 'firewood', 2);
    expect(engine.getBalance('player')).toBe(500);
    expect(engine.getMarketOverview('market', 'player').myListings).toMatchObject([
      { quantity: 2, price: 17 },
    ]);
    expect(engine.getItem('firewood-0')?.containerId).toBe('market-stock');
    buyFromMarket(engine.db, engine.bus, 'buyer', 'market', 'firewood', 4, engine.tick);
    expect(engine.getBalance('buyer')).toBe(932);
    expect(engine.getBalance('camp')).toBe(17);
    expect(engine.getBalance('player')).toBe(534);
    expect(summarizeLedger(engine.db, 'camp', 0).revenue).toBe(17);
    expect(queryRows(engine.db, "SELECT * FROM company_ledger_entries WHERE company_id = 'player'")).toEqual(
      [],
    );
    expect(engine.getMarketOverview('market', 'player').myListings).toEqual([]);
    expect(engine.getProvenanceChain('firewood-0').map((entry) => entry.eventType)).toEqual([
      'produced',
      'transferred',
      'transferred',
    ]);
    expect(engine.queryLog('personal').filter((entry) => entry.type === 'market.sale')).toHaveLength(1);
    expect(engine.queryMarketActivity('market', { kind: 'purchase' })).toHaveLength(3); // one per seller batch
    buyFromMarket(engine.db, engine.bus, 'buyer', 'market', 'firewood', 1, engine.tick);
    expect(engine.getBalance('player')).toBe(534); // cannot be paid again
    expect(engine.runConservationAudit().passed).toBe(true);
    engine.dispose();
  });

  it('withdraws only the owner’s remaining units and records no payment', async () => {
    const engine = await newMarket();
    give(engine, 'firewood', 3);
    trade(engine, 'list', 'firewood', 3);
    trade(engine, 'withdraw', 'firewood', 1, 'buyer');
    expect(engine.getActorActions('buyer').at(-1)?.status).toBe('failed');
    trade(engine, 'withdraw', 'firewood', 2);
    expect(engine.getMarketOverview('market', 'player').myListings).toMatchObject([{ quantity: 1 }]);
    expect(engine.getMarketOverview('market', 'player').pack).toMatchObject([{ quantity: 2 }]);
    expect(engine.getMarketListing('market', 'firewood')?.quantity).toBe(1);
    expect(engine.getBalance('player')).toBe(500);
    expect(engine.runConservationAudit().passed).toBe(true);
    engine.dispose();
  });

  it('fails withdrawal when stock sold while queued, or when the pack filled', async () => {
    const engine = await newMarket();
    give(engine, 'firewood', 2);
    trade(engine, 'list', 'firewood', 2);
    engine.queueMarketTrade('player', {
      kind: 'withdraw',
      siteId: 'market',
      goodType: 'firewood',
      quantity: 2,
    });
    engine.advanceTicks(1);
    buyFromMarket(engine.db, engine.bus, 'buyer', 'market', 'firewood', 1, engine.tick);
    engine.advanceTicks(5);
    expect(engine.getActorActions('player').at(-1)?.status).toBe('failed');
    give(engine, 'firewood', 10, 'heavy-pack');
    trade(engine, 'withdraw', 'firewood', 1);
    expect(engine.getActorActions('player').at(-1)?.status).toBe('failed');
    expect(engine.getMarketOverview('market', 'player').myListings).toMatchObject([{ quantity: 1 }]);
    engine.dispose();
  });

  it('excludes worn equipment and fails excessive listings without partial transfers', async () => {
    const engine = await newMarket();
    give(engine, 'shoes', 1);
    engine.equipItem('player', 'shoes-0');
    expect(engine.getMarketOverview('market', 'player').pack).toMatchObject([
      { quantity: 1, listableQuantity: 0 },
    ]);
    trade(engine, 'list', 'shoes', 1);
    expect(engine.getActorActions('player').at(-1)?.status).toBe('failed');
    give(engine, 'firewood', 1);
    trade(engine, 'list', 'firewood', 2);
    expect(engine.getActorActions('player').at(-1)?.status).toBe('failed');
    expect(engine.getItem('firewood-0')?.containerId).toBe('player');
    expect(engine.getItem('shoes-0')?.containerId).toBe('player');
    engine.dispose();
  });

  it('removes spoiled personal goods from unsold listings without paying the seller', async () => {
    const engine = await newMarket();
    give(engine, 'bread', 2);
    trade(engine, 'list', 'bread', 2);
    applySpoilage(engine.db, engine.bus, 7 * MINUTES_PER_DAY);
    expect(engine.getMarketOverview('market', 'player').myListings).toEqual([]);
    expect(engine.getMarketListing('market', 'bread')?.quantity).toBe(0);
    expect(engine.getBalance('player')).toBe(500);
    expect(engine.runConservationAudit().passed).toBe(true);
    engine.dispose();
  });

  it('pays a personal consignor for merchant exports without company ledger entries', async () => {
    const engine = await newMarket();
    give(engine, 'firewood', 70);
    trade(engine, 'list', 'firewood', 70);
    applyMerchantTrade(engine.db, engine.bus, 8 * MINUTES_PER_DAY);
    expect(engine.getBalance('player')).toBe(590); // ten exported at 60% of base
    expect(engine.getMarketListing('market', 'firewood')?.quantity).toBe(60);
    expect(engine.queryLog('personal').some((entry) => entry.type === 'market.exported')).toBe(true);
    expect(engine.queryMarketActivity('market', { kind: 'exported' })).toMatchObject([
      { quantity: 10, unitPrice: 9 },
    ]);
    expect(engine.runConservationAudit().passed).toBe(true);
    engine.dispose();
  });

  it('restores an in-progress purchase and queued listing/withdrawal from a save', async () => {
    const engine = await newMarket();
    engine.seedMarketListing('market', 'axe', 70, 5);
    for (const kind of ['buy', 'list', 'withdraw'] as const)
      engine.queueMarketTrade('player', { kind, siteId: 'market', goodType: 'axe', quantity: 1 });
    engine.advanceTicks(3);
    const restored = Engine.bootstrap(createDatabase(await loadSqlJs(), engine.export()), {
      seed: 'ignored-on-reload',
    });
    engine.advanceTicks(13);
    restored.advanceTicks(13);
    expect(restored.getActorActions('player').map((entry) => entry.status)).toEqual([
      'complete',
      'complete',
      'complete',
    ]);
    expect(restored.getMarketOverview('market', 'player')).toEqual(
      engine.getMarketOverview('market', 'player'),
    );
    expect(restored.queryMarketActivity('market')).toEqual(engine.queryMarketActivity('market'));
    expect(restored.getBalance('player')).toBe(430);
    expect(restored.runConservationAudit().passed).toBe(true);
    restored.dispose();
    engine.dispose();
  });

  it('adds the activity journal to an existing save without resetting its goods, coin or history', async () => {
    const db = createDatabase(await loadSqlJs());
    db.run('CREATE TABLE schema_migrations (id TEXT PRIMARY KEY)');
    for (const migration of migrations.filter((entry) => entry.id !== '0022_market_activity')) {
      db.run(migration.up);
      db.run('INSERT INTO schema_migrations (id) VALUES (?)', [migration.id]);
    }
    db.run("INSERT INTO market_history (site_id, good_type, day, price) VALUES ('market', 'axe', 1, 70)");
    expect(applyMigrations(db)).toEqual(['0022_market_activity']);
    expect(queryRows(db, 'SELECT price FROM market_history')).toEqual([[70]]);
    expect(queryRows(db, 'SELECT * FROM market_activity')).toEqual([]);
    db.close();
  });

  it('uses the same player trade surface exposed to React', async () => {
    const engine = await newMarket();
    const api = createUiApi(engine);
    engine.seedMarketListing('market', 'axe', getGoodDefinition('axe').basePrice, 1);
    api.queueMarketTrade('player', { kind: 'buy', siteId: 'market', goodType: 'axe', quantity: 1 });
    api.advanceTicks(6);
    expect(api.getMarketOverview('market', 'player').pack).toMatchObject([
      { goodType: 'axe', avgCondition: 1 },
    ]);
    engine.dispose();
  });
});
