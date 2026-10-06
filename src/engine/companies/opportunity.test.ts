import { describe, expect, it } from 'vitest';
import { recordMarketDay, recordMarketFlow } from '../market/history';
import { createRng } from '../rng';
import { addGluttedGrainMarket, addHungryMill, buildFoundingWorld } from '../scenarios/foundingWorld';
import { MINUTES_PER_DAY } from '../time/clock';
import { getBusinessType } from './businessTypes';
import {
  computeMarketSignals,
  estimateErrorSpread,
  estimateOpportunity,
  SIGNAL_WINDOW_DAYS,
  type MarketSignals,
} from './opportunity';

const DAY = MINUTES_PER_DAY;
const TICK = SIGNAL_WINDOW_DAYS * DAY;
const farm = getBusinessType('farm')!;

describe('market signals (companies/opportunity.ts)', () => {
  it('sees latent demand: a mill standing idle for want of grain nobody grows', async () => {
    const engine = await buildFoundingWorld('signals-downstream');
    addHungryMill(engine);
    const signals = computeMarketSignals(engine.db, farm, TICK, 0)!;
    expect(signals.soldPerDay).toBe(0); // grain has never been sold here
    expect(signals.producersOpen).toBe(0);
    // Two millers at a typical 22 sacks a shift, six days in seven.
    expect(signals.downstreamNeedPerDay).toBeCloseTo((2 * 22 * 6) / 7, 5);
    expect(signals.unmetPerDay).toBeCloseTo(signals.downstreamNeedPerDay, 5);
    expect(signals.availableSites.map((s) => s.id)).toEqual(['eastfield']);
    engine.dispose();
  });

  it('reads imports as demand local producers are not meeting', async () => {
    const engine = await buildFoundingWorld('signals-imports');
    for (let day = 1; day <= SIGNAL_WINDOW_DAYS; day++) {
      recordMarketFlow(engine.db, 'market', 'bread', day * DAY, 'sold', 40);
      recordMarketFlow(engine.db, 'market', 'bread', day * DAY, 'imported', 15);
      recordMarketDay(engine.db, day * DAY);
    }
    const signals = computeMarketSignals(engine.db, getBusinessType('bakery')!, TICK, 0)!;
    expect(signals.importedPerDay).toBe(15);
    // No bakery at all: the whole 40 a day goes unmet.
    expect(signals.unmetPerDay).toBe(40);
    expect(signals.availableSites).toEqual([]); // ...but there's nowhere to bake
    engine.dispose();
  });

  it('sees a saturated market: producers out-making demand, the surplus exported, nothing unmet', async () => {
    const engine = await buildFoundingWorld('signals-glut');
    addGluttedGrainMarket(engine, 4);
    const signals = computeMarketSignals(engine.db, farm, TICK, 0)!;
    expect(signals.exportedPerDay).toBe(6);
    expect(signals.localCapacityPerDay).toBeGreaterThan(signals.demandPerDay);
    expect(signals.unmetPerDay).toBe(0);
    engine.dispose();
  });
});

describe('opportunity estimates (companies/opportunity.ts)', () => {
  async function gluttedSignals(): Promise<MarketSignals> {
    const engine = await buildFoundingWorld('estimates-glut');
    addGluttedGrainMarket(engine, 4);
    const signals = computeMarketSignals(engine.db, farm, TICK, 0)!;
    engine.dispose();
    return signals;
  }

  it('a competent manager sees no money in a saturated market; a poor one talks themselves into it', async () => {
    const signals = await gluttedSignals();
    const competent = estimateOpportunity(
      signals,
      farm,
      { managementLevel: 5, experience: 0.5 },
      15,
      createRng(7),
    );
    expect(competent.salesPerDay).toBe(0);
    expect(competent.profitPerMonth).toBeLessThan(0);

    const poor = estimateOpportunity(
      signals,
      farm,
      { managementLevel: 0, experience: 0.5 },
      15,
      createRng(7),
    );
    // Every hand they hire turns into sales, in their mind — and they hire
    // to the limit and overlook part of the bills.
    expect(poor.positions).toBe(farm.startingMaxPositions);
    expect(poor.salesPerDay).toBeGreaterThan(0);
    expect(poor.profitPerMonth).toBeGreaterThan(0);
    expect(poor.wagesPerDay).toBeLessThan(poor.positions * 20 * (6 / 7));
    // ...and plan a thin reserve while overstocking.
    expect(poor.reserveWeeks).toBeLessThan(competent.reserveWeeks);
  });

  it('a competent manager sizes the business to the unmet demand', async () => {
    const engine = await buildFoundingWorld('estimates-sizing');
    addHungryMill(engine);
    const signals = computeMarketSignals(engine.db, farm, TICK, 10)!;
    engine.dispose();
    const estimate = estimateOpportunity(
      signals,
      farm,
      { managementLevel: 5, experience: 1 },
      15,
      createRng(3),
    );
    // 37.7 grain a day wanted, a farmhand makes ~2.2: more than a new farm
    // can post — it opens at its limit, and believes it'll sell all it makes.
    expect(estimate.positions).toBe(farm.startingMaxPositions);
    expect(estimate.profitPerMonth).toBeGreaterThan(0);
  });

  it('Management and trade experience narrow the estimate error — Management is judgment, not output', () => {
    expect(estimateErrorSpread({ managementLevel: 0, experience: 0 })).toBe(0.5);
    expect(estimateErrorSpread({ managementLevel: 5, experience: 0 })).toBeCloseTo(0.2, 10);
    expect(estimateErrorSpread({ managementLevel: 0, experience: 1 })).toBeCloseTo(0.2, 10);
    expect(estimateErrorSpread({ managementLevel: 5, experience: 1 })).toBeCloseTo(0.08, 10);
  });

  it('errors are drawn from the seeded RNG: the same seed gives the same belief, and novices err more on average', async () => {
    const engine = await buildFoundingWorld('estimates-determinism');
    addHungryMill(engine);
    const signals = computeMarketSignals(engine.db, farm, TICK, 10)!;
    engine.dispose();

    const a = estimateOpportunity(signals, farm, { managementLevel: 1, experience: 0 }, 15, createRng(42));
    const b = estimateOpportunity(signals, farm, { managementLevel: 1, experience: 0 }, 15, createRng(42));
    expect(a).toEqual(b);

    const meanAbsError = (managementLevel: number, experience: number) => {
      const rng = createRng(99);
      let total = 0;
      for (let i = 0; i < 400; i++)
        total += Math.abs(estimateOpportunity(signals, farm, { managementLevel, experience }, 15, rng).error);
      return total / 400;
    };
    expect(meanAbsError(0, 0)).toBeGreaterThan(2 * meanAbsError(5, 1));
  });
});
