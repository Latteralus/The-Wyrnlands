import { describe, expect, it } from 'vitest';
import { createDatabase } from '../db/sqlite';
import { loadSqlJs } from '../db/sqlite.node';
import { Engine } from '../engine';
import { countActiveItemsOfType } from '../inventory/items';
import {
  BREAD_PER_PERSON_PER_DAY,
  provisionHousehold,
  supplyDays,
  WATER_PAILS_PER_PERSON_PER_DAY,
} from './provisions';

async function household(seed: string, coin: number, breadOnSale = 500) {
  const engine = Engine.bootstrap(createDatabase(await loadSqlJs()), { seed });
  engine.createSite({ id: 'market', name: 'Market', kind: 'market', x: 0, y: 0 });
  engine.seedMarketListing('market', 'bread', 12, breadOnSale);
  engine.createHousehold({ id: 'house', name: 'The House', homeSiteId: 'market' });
  for (const id of ['a', 'b', 'c']) {
    engine.createEntity(id, id);
    engine.addHouseholdMember('house', id);
  }
  if (coin > 0) engine.faucetCoin('house', coin, 'savings');
  return engine;
}

describe('household provisions (population/provisions.ts)', () => {
  it('keeps a week of water and as much bread as keeps (half its shelf life), the rest a week, two with coin to spare', () => {
    expect(supplyDays('water', false)).toBe(7); // free: never "two weeks if there's money"
    expect(supplyDays('water', true)).toBe(7);
    expect(supplyDays('bread', false)).toBe(3); // spoils in 6 days
    expect(supplyDays('bread', true)).toBe(3);
    expect(supplyDays('grain', false)).toBe(7); // a non-perishable-enough good: the plain rule
    expect(supplyDays('grain', true)).toBe(14);
  });

  it('a household fetches its water, stocks bread ahead, then drinks and eats from the store', async () => {
    const engine = await household('provisions-stock', 2000);
    const result = provisionHousehold(engine.db, engine.bus, { id: 'house', name: 'The House' }, 3, 1440);
    expect(result).toEqual({ fed: 3, watered: true });
    const pailsPerDay = Math.ceil(3 * WATER_PAILS_PER_PERSON_PER_DAY);
    // A week's store left after today's drinking; three days of bread after today's meals.
    expect(countActiveItemsOfType(engine.db, 'house', 'water')).toBe(pailsPerDay * 7);
    expect(countActiveItemsOfType(engine.db, 'house', 'bread')).toBe(3 * BREAD_PER_PERSON_PER_DAY * 3);
    expect(engine.getBalance('house')).toBe(2000 - 12 * 3 * 4);

    // The next day it only tops up what was used.
    provisionHousehold(engine.db, engine.bus, { id: 'house', name: 'The House' }, 3, 2880);
    expect(engine.getBalance('house')).toBe(2000 - 12 * 3 * 5);
    expect(engine.runConservationAudit().passed).toBe(true);
    engine.dispose();
  });

  it('a poor household buys what it can and goes short — water, free at the well, it always has', async () => {
    const engine = await household('provisions-poor', 24); // two loaves' worth
    const result = provisionHousehold(engine.db, engine.bus, { id: 'house', name: 'The House' }, 3, 1440);
    expect(result).toEqual({ fed: 2, watered: true });
    expect(engine.getBalance('house')).toBe(0);
    engine.dispose();
  });
});
