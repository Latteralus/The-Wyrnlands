import { describe, expect, it } from 'vitest';
import { closeCompany } from '../companies/companies';
import { createDatabase } from '../db/sqlite';
import { loadSqlJs } from '../db/sqlite.node';
import { Engine } from '../engine';
import {
  acquireSiteTenure,
  getOpenTenure,
  isSiteAvailable,
  listAvailableSites,
  payWeeklyRent,
  tenureTerms,
} from './tenure';

async function newEngine(seed: string) {
  const engine = Engine.bootstrap(createDatabase(await loadSqlJs()), { seed });
  engine.createSite({ id: 'well', name: 'Well', kind: 'well', x: 0, y: 0 });
  engine.createSite({ id: 'plot', name: 'The Plot', kind: 'farm', x: 1, y: 1, landValue: 800 });
  engine.createSite({ id: 'plot-2', name: 'Second Plot', kind: 'farm', x: 2, y: 1, landValue: 600 });
  engine.createEntity('holder', 'Holder');
  engine.faucetCoin('holder', 1000, 'savings');
  return engine;
}

describe('site tenure (world/tenure.ts)', () => {
  it('prices a lease at an entry fine plus weekly rent, and freehold at the land value', async () => {
    const engine = await newEngine('tenure-terms');
    const plot = engine.getSite('plot')!;
    expect(tenureTerms(plot, 'lease')).toEqual({ upfront: 80, weeklyRent: 20 });
    expect(tenureTerms(plot, 'freehold')).toEqual({ upfront: 800, weeklyRent: 0 });
    // Commons and public places are never held.
    expect(tenureTerms(engine.getSite('well')!, 'lease')).toBeNull();
    expect(isSiteAvailable(engine.db, 'well')).toBe(false);
    engine.dispose();
  });

  it('leasing pays the entry fine out of the economy and makes the parcel unavailable to anyone else', async () => {
    const engine = await newEngine('tenure-lease');
    acquireSiteTenure(engine.db, engine.bus, {
      siteId: 'plot',
      holderId: 'holder',
      payerId: 'holder',
      kind: 'lease',
      tick: 0,
    });
    expect(engine.getBalance('holder')).toBe(1000 - 80);
    expect(getOpenTenure(engine.db, 'plot')).toMatchObject({
      holderId: 'holder',
      kind: 'lease',
      weeklyRent: 20,
    });
    expect(listAvailableSites(engine.db, 'farm').map((s) => s.id)).toEqual(['plot-2']);

    engine.createEntity('rival', 'Rival');
    engine.faucetCoin('rival', 5000, 'deep pockets');
    expect(() =>
      acquireSiteTenure(engine.db, engine.bus, {
        siteId: 'plot',
        holderId: 'rival',
        payerId: 'rival',
        kind: 'freehold',
        tick: 0,
      }),
    ).toThrow(/already held/);
    expect(engine.getBalance('rival')).toBe(5000);
    expect(engine.runConservationAudit().passed).toBe(true);
    engine.dispose();
  });

  it("refuses a holder who can't pay, changing nothing", async () => {
    const engine = await newEngine('tenure-broke');
    engine.sinkCoin('holder', 500, 'spent'); // 500 left, the plot costs 800
    expect(() =>
      acquireSiteTenure(engine.db, engine.bus, {
        siteId: 'plot',
        holderId: 'holder',
        payerId: 'holder',
        kind: 'freehold',
        tick: 0,
      }),
    ).toThrow(/can't afford/);
    expect(engine.getBalance('holder')).toBe(500);
    expect(getOpenTenure(engine.db, 'plot')).toBeNull();
    engine.dispose();
  });

  it('weekly rent is paid as far as the holder can, and nothing more', async () => {
    const engine = await newEngine('tenure-rent');
    acquireSiteTenure(engine.db, engine.bus, {
      siteId: 'plot',
      holderId: 'holder',
      payerId: 'holder',
      kind: 'lease',
      tick: 0,
    });
    expect(payWeeklyRent(engine.db, engine.bus, 'holder', 7)).toBe(20);
    expect(engine.getBalance('holder')).toBe(1000 - 80 - 20);
    engine.sinkCoin('holder', engine.getBalance('holder') - 5, 'spent');
    expect(payWeeklyRent(engine.db, engine.bus, 'holder', 14)).toBe(5);
    expect(engine.getBalance('holder')).toBe(0);
    engine.dispose();
  });

  it("a company's closure releases its land for the next taker", async () => {
    const engine = await newEngine('tenure-closure');
    engine.createCompany({ id: 'co', name: 'Co', kind: 'farm', siteId: 'plot' });
    engine.grantSiteTenure('plot', 'co');
    expect(isSiteAvailable(engine.db, 'plot')).toBe(false);
    closeCompany(engine.db, 'co', 100);
    expect(isSiteAvailable(engine.db, 'plot')).toBe(true);
    expect(getOpenTenure(engine.db, 'plot')).toBeNull();
    engine.dispose();
  });
});
