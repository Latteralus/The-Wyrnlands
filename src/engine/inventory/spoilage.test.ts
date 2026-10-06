import { describe, expect, it } from 'vitest';
import { createDatabase, queryRow } from '../db/sqlite';
import { loadSqlJs } from '../db/sqlite.node';
import { Engine } from '../engine';
import { getGoodDefinition } from '../goods/catalog';
import { sellSurplusToMarket } from '../market/market';
import { MINUTES_PER_DAY } from '../time/clock';
import { applySpoilage } from './spoilage';

describe('spoilage (§7.1 perishability)', () => {
  it('spoils perishables past their shelf life wherever they are, keeping market listings honest', async () => {
    const engine = Engine.bootstrap(createDatabase(await loadSqlJs()), { seed: 'spoilage' });
    engine.createSite({ id: 'market', name: 'Market', kind: 'market', x: 0, y: 0 });
    engine.createCompany({ id: 'bakery', name: 'Bakery', kind: 'bakery', siteId: 'market' });
    engine.createEntity('villager', 'Villager');
    engine.produceItem({ id: 'loaf-home', type: 'bread', containerId: 'villager', tick: 0 });
    engine.produceItem({ id: 'loaf-stall', type: 'bread', containerId: 'bakery', tick: 0 });
    engine.produceItem({
      id: 'loaf-fresh',
      type: 'bread',
      containerId: 'villager',
      tick: 3 * MINUTES_PER_DAY,
    });
    engine.produceItem({ id: 'axe-1', type: 'axe', containerId: 'villager', tick: 0, durability: 3000 });
    sellSurplusToMarket(engine.db, engine.bus, 'bakery', 'market', 'bread', 1, 10, 0);

    const shelfLife = getGoodDefinition('bread').shelfLifeDays ?? 0;
    applySpoilage(engine.db, engine.bus, shelfLife * MINUTES_PER_DAY);

    expect(engine.getItem('loaf-home')?.status).toBe('spoiled');
    expect(engine.getItem('loaf-stall')?.status).toBe('spoiled');
    expect(engine.getItem('loaf-fresh')?.status).toBe('active'); // not old enough yet
    expect(engine.getItem('axe-1')?.status).toBe('active'); // tools don't rot
    expect(engine.getMarketListing('market', 'bread')?.quantity).toBe(0);
    expect(Number(queryRow(engine.db, 'SELECT COUNT(*) FROM market_consignments')?.[0])).toBe(0);
    expect(engine.runConservationAudit().passed).toBe(true);
    engine.dispose();
  });
});
