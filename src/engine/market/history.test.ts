import { describe, expect, it } from 'vitest';
import { createDatabase } from '../db/sqlite';
import { loadSqlJs } from '../db/sqlite.node';
import { Engine } from '../engine';
import { MINUTES_PER_DAY } from '../time/clock';
import { marketWindowStats, recordMarketDay, recordMarketFlow } from './history';
import { buyFromMarket } from './market';
import { applyMerchantTrade } from './merchant';

async function newEngine(seed: string) {
  const engine = Engine.bootstrap(createDatabase(await loadSqlJs()), { seed });
  engine.createSite({ id: 'market', name: 'Market', kind: 'market', x: 0, y: 0 });
  return engine;
}

describe('market history (market/history.ts)', () => {
  it('records sales, merchant imports and the daily close, and summarizes a window', async () => {
    const engine = await newEngine('history-flows');
    engine.seedMarketListing('market', 'bread', 12, 80);
    engine.createEntity('buyer', 'Buyer');
    engine.faucetCoin('buyer', 10_000, 'purse');

    for (let day = 1; day <= 10; day++) {
      const tick = day * MINUTES_PER_DAY;
      buyFromMarket(engine.db, engine.bus, 'buyer', 'market', 'bread', 50, tick);
      applyMerchantTrade(engine.db, engine.bus, tick); // restocks the shortfall each day
      recordMarketDay(engine.db, tick);
    }

    const stats = marketWindowStats(engine.db, 'market', 'bread', 10 * MINUTES_PER_DAY, 10);
    expect(stats.days).toBe(10);
    expect(stats.soldPerDay).toBe(50);
    expect(stats.importedPerDay).toBeGreaterThan(0);
    expect(stats.avgPrice).toBeGreaterThanOrEqual(12);
    expect(stats.lastPrice).toBe(engine.getMarketListing('market', 'bread')?.price);
    engine.dispose();
  });

  it('divides by the window, so a good that only just appeared reads as thin trade', async () => {
    const engine = await newEngine('history-thin');
    recordMarketFlow(engine.db, 'market', 'grain', 28 * MINUTES_PER_DAY, 'sold', 28);
    const stats = marketWindowStats(engine.db, 'market', 'grain', 28 * MINUTES_PER_DAY, 28);
    expect(stats.soldPerDay).toBe(1);
    expect(stats.avgPrice).toBeNull(); // never closed a day with a listing
    engine.dispose();
  });
});
