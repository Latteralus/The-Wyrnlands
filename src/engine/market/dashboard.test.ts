import { describe, expect, it } from 'vitest';
import { buyFromLocalSuppliers } from '../companies/trade';
import { createDatabase, queryRow, queryRows } from '../db/sqlite';
import { loadSqlJs } from '../db/sqlite.node';
import { Engine } from '../engine';
import { PLAYER_ID, seedDemoWorld } from '../seed/demoWorld';
import { MINUTES_PER_DAY } from '../time/clock';
import { createUiApi } from '../ui-api';
import { recordMarketActivity } from './activity';
import { buyFromMarket, sellSurplusToMarket } from './market';

describe('market views', () => {
  it('shows actual consignors and the merchant remainder without attributing all stock to the last producer', async () => {
    const engine = Engine.bootstrap(createDatabase(await loadSqlJs()), { seed: 'seller-view' });
    engine.createSite({ id: 'market', name: 'Market', kind: 'market', x: 0, y: 0 });
    engine.seedMarketListing('market', 'bread', 12, 10);
    engine.createEntity('player', 'You');
    for (const id of ['a', 'b']) {
      engine.createCompany({ id, name: id, kind: 'bakery', siteId: 'market' });
      engine.produceItem({ id: `${id}-bread`, type: 'bread', containerId: id });
      sellSurplusToMarket(engine.db, engine.bus, id, 'market', 'bread', 1, 12, 0);
    }
    const good = engine.getMarketOverview('market', 'player').goods[0];
    expect(good?.quantity).toBe(12);
    expect(good?.sellers).toEqual([
      { sellerId: 'a', sellerName: 'a', isCompany: true, quantity: 1 },
      { sellerId: 'b', sellerName: 'b', isCompany: true, quantity: 1 },
      { sellerId: null, sellerName: 'Travelling merchant', isCompany: false, quantity: 10 },
    ]);
    engine.dispose();
  });

  it('returns sparse recorded history without inventing prices, days or future records', async () => {
    const engine = Engine.bootstrap(createDatabase(await loadSqlJs()), { seed: 'chart-history' });
    engine.db.run(
      "INSERT INTO market_history (site_id, good_type, day, price, sold) VALUES ('market', 'bread', 2, 12, 4), ('market', 'bread', 15, NULL, 2), ('market', 'bread', 27, 18, 10), ('market', 'bread', 99, 24, 3)",
    );
    engine.db.run('UPDATE world_meta SET tick = ? WHERE id = 1', [28 * MINUTES_PER_DAY]);
    expect(engine.getMarketHistory('market', 'bread', 7)).toEqual([
      { day: 27, price: 18, quantity: null, sold: 10, imported: 0, exported: 0 },
    ]);
    expect(engine.getMarketHistory('market', 'bread', 28).map((point) => point.price)).toEqual([
      12,
      null,
      18,
    ]);
    expect(engine.getMarketHistory('market', 'axe', 90)).toEqual([]);
    engine.dispose();
  });

  it('filters and pages the activity journal without duplicate seller/buyer log entries', async () => {
    const engine = Engine.bootstrap(createDatabase(await loadSqlJs()), { seed: 'activity-paging' });
    for (let i = 0; i < 85; i++)
      recordMarketActivity(engine.db, {
        siteId: 'market',
        tick: i,
        kind: i % 2 ? 'direct' : 'purchase',
        goodType: 'bread',
        quantity: 1,
        unitPrice: 12,
        sellerId: null,
        buyerId: null,
      });
    recordMarketActivity(engine.db, {
      siteId: 'elsewhere',
      tick: 99,
      kind: 'purchase',
      goodType: 'bread',
      quantity: 1,
      unitPrice: 12,
      sellerId: null,
      buyerId: null,
    });
    const first = engine.queryMarketActivity('market');
    const lastId = first.at(-1)?.id;
    if (lastId === undefined) throw new Error('Missing activity page');
    const second = engine.queryMarketActivity('market', { beforeId: lastId, limit: 40 });
    expect(first).toHaveLength(40);
    expect(second).toHaveLength(40);
    expect(new Set([...first, ...second].map((entry) => entry.id)).size).toBe(80);
    expect(engine.queryMarketActivity('market', { goodType: 'axe' })).toEqual([]);
    expect(engine.queryMarketActivity('market', { kind: 'direct', limit: 100 })).toHaveLength(42);
    engine.dispose();
  });

  it('records a direct trade once while retaining its existing economic demand signal', async () => {
    const engine = Engine.bootstrap(createDatabase(await loadSqlJs()), { seed: 'direct-journal' });
    engine.createSite({ id: 'market', name: 'Market', kind: 'market', x: 0, y: 0 });
    engine.seedMarketListing('market', 'grain', 12, 20);
    engine.createCompany({ id: 'farm', name: 'Farm', kind: 'farm', siteId: 'market' });
    engine.createCompany({ id: 'mill', name: 'Mill', kind: 'mill', siteId: 'market' });
    engine.createJobSlot({
      id: 'farmer',
      companyId: 'farm',
      title: 'Farmer',
      skill: 'farming',
      wageMin: 10,
      wageMax: 20,
      shiftDurationTicks: 480,
    });
    engine.produceItem({ id: 'grain', type: 'grain', containerId: 'farm' });
    engine.faucetCoin('mill', 100);
    const buyer = engine.getCompany('mill');
    if (!buyer) throw new Error('Missing fixture company');
    buyFromLocalSuppliers(engine.db, engine.bus, buyer, 'grain', 1, 1);
    const entries = engine.queryMarketActivity('market');
    expect(entries).toMatchObject([{ kind: 'direct', sellerId: 'farm', buyerId: 'mill', quantity: 1 }]);
    expect(entries).toHaveLength(1);
    expect(queryRows(engine.db, 'SELECT sold FROM market_history')).toEqual([[1]]);
    engine.dispose();
  });

  it('rejects unaffordable mixed-seller purchases before paying any seller', async () => {
    const engine = Engine.bootstrap(createDatabase(await loadSqlJs()), { seed: 'all-or-nothing-payment' });
    engine.createSite({ id: 'market', name: 'Market', kind: 'market', x: 0, y: 0 });
    engine.createEntity('buyer', 'Buyer');
    engine.faucetCoin('buyer', 15);
    for (const id of ['a', 'b']) {
      engine.createCompany({ id, name: id, kind: 'bakery', siteId: 'market' });
      engine.produceItem({ id, type: 'bread', containerId: id });
      sellSurplusToMarket(engine.db, engine.bus, id, 'market', 'bread', 1, 12, 0);
    }
    expect(() => buyFromMarket(engine.db, engine.bus, 'buyer', 'market', 'bread', 2, 1)).toThrow(/balance/);
    expect(engine.getBalance('buyer')).toBe(15);
    expect(engine.getBalance('a')).toBe(0);
    expect(engine.getMarketListing('market', 'bread')?.quantity).toBe(2);
    expect(engine.queryMarketActivity('market', { kind: 'purchase' })).toEqual([]);
    engine.dispose();
  });

  it('market queries leave both the database and a seeded NPC/business simulation unchanged', async () => {
    const SQL = await loadSqlJs();
    const control = Engine.bootstrap(createDatabase(SQL), { seed: 'market-view-determinism' });
    const viewed = Engine.bootstrap(createDatabase(SQL), { seed: 'market-view-determinism' });
    seedDemoWorld(control);
    seedDemoWorld(viewed);
    const api = createUiApi(viewed);
    for (let day = 0; day < 14; day++) {
      const before = queryRow(viewed.db, 'SELECT total_changes()')?.[0];
      for (let refresh = 0; refresh < 3; refresh++) {
        const overview = api.getMarketOverview('market', PLAYER_ID);
        for (const good of overview.goods) {
          api.getMarketHistory('market', good.goodType, 7);
          api.getMarketHistory('market', good.goodType, 28);
          api.getMarketHistory('market', good.goodType, 90);
          api.queryMarketActivity('market', { goodType: good.goodType });
        }
        api.queryMarketActivity('market');
      }
      expect(queryRow(viewed.db, 'SELECT total_changes()')?.[0]).toBe(before);
      control.advanceTicks(MINUTES_PER_DAY);
      viewed.advanceTicks(MINUTES_PER_DAY);
    }
    expect(viewed.export()).toEqual(control.export()); // includes RNG, all ledgers and all NPC state
    expect(viewed.runConservationAudit().passed).toBe(true);
    control.dispose();
    viewed.dispose();
  }, 20000);
});
