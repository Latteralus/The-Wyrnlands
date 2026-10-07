import { describe, expect, it } from 'vitest';
import { createDatabase, queryRow } from '../db/sqlite';
import { loadSqlJs } from '../db/sqlite.node';
import { Engine } from '../engine';
import { computeTargetPrice, driftMarketPrices } from './pricing';

describe('computeTargetPrice', () => {
  it('holds at basePrice when stock matches its reference level', () => {
    expect(computeTargetPrice(10, 100, 100)).toBe(10);
  });

  it('rises when stock is scarce relative to its reference level', () => {
    expect(computeTargetPrice(10, 10, 100)).toBeGreaterThan(10);
  });

  it('falls when stock is plentiful relative to its reference level', () => {
    expect(computeTargetPrice(10, 1000, 100)).toBeLessThan(10);
  });

  it('is clamped at both ends rather than diverging without bound', () => {
    expect(computeTargetPrice(10, 1, 100)).toBeLessThanOrEqual(25); // 2.5x cap
    expect(computeTargetPrice(10, 100_000, 100)).toBeGreaterThanOrEqual(5); // 0.5x floor
  });

  it('falls back to basePrice with no reference stock (e.g. a fresh production-backed listing)', () => {
    expect(computeTargetPrice(10, 5, null)).toBe(10);
  });
});

describe('driftMarketPrices', () => {
  it('carries fractional intraday changes across saves without multiplying daily price movement', async () => {
    const SQL = await loadSqlJs();
    const e = Engine.bootstrap(createDatabase(SQL), { seed: 'price-carry' });
    e.createSite({ id: 'market', name: 'Market', kind: 'market', x: 0, y: 0 });
    e.seedMarketListing('market', 'bread', 10, 80); // target 12, daily step 1
    driftMarketPrices(e.db, 4);
    driftMarketPrices(e.db, 4);
    expect(e.getMarketListing('market', 'bread')?.price).toBe(10);
    expect(queryRow(e.db, 'SELECT price_adjustment FROM market_listings')?.[0]).toBe(0.5);
    const loaded = Engine.bootstrap(createDatabase(SQL, e.export()), { seed: 'price-carry' });
    driftMarketPrices(loaded.db, 4);
    driftMarketPrices(loaded.db, 4);
    expect(loaded.getMarketListing('market', 'bread')?.price).toBe(11);
    loaded.dispose();
    e.dispose();
  });
  it('moves a listing price toward its target by a fraction of the gap, not all at once', async () => {
    const SQL = await loadSqlJs();
    const db = createDatabase(SQL);
    const engine = Engine.bootstrap(db, { seed: 'pricing-drift' });
    engine.createSite({ id: 'market', name: 'Market', kind: 'market', x: 0, y: 0 });
    // Seeded quantity (10) becomes referenceStock; draining stock to 1 makes
    // the good scarce, pushing its target price above the seeded price.
    engine.seedMarketListing('market', 'bread', 2, 10);
    engine.decrementMarketStock('market', 'bread', 9);

    driftMarketPrices(engine.db);
    const afterOneDay = engine.getMarketListing('market', 'bread')!.price;
    expect(afterOneDay).toBeGreaterThan(2);

    driftMarketPrices(engine.db);
    const afterTwoDays = engine.getMarketListing('market', 'bread')!.price;
    // Still climbing toward (but not overshooting) the scarcity target.
    expect(afterTwoDays).toBeGreaterThanOrEqual(afterOneDay);

    engine.dispose();
  });
});
