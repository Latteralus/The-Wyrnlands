import { describe, expect, it } from 'vitest';
import { foundCompany } from '../companies/founding';
import { queryRow } from '../db/sqlite';
import { getTrait } from '../population/traits';
import {
  addJobSeekers,
  buildFoundingWorld,
  FOUNDER_HOUSEHOLD_ID,
  FOUNDER_ID,
  PARCEL_ID,
} from '../scenarios/foundingWorld';
import { MINUTES_PER_DAY } from '../time/clock';
import { getBusinessProfile, getHouseholdProfile, getPersonProfile, wealthBand } from './profiles';
import type { Engine } from '../engine';

const FOUNDED = 14 * MINUTES_PER_DAY;

// The founder opens Hale Farm and hires one seeker.
async function worldWithFarm(seed: string): Promise<{ engine: Engine; companyId: string }> {
  const engine = await buildFoundingWorld(seed);
  addJobSeekers(engine, 1);
  const result = foundCompany(
    engine.db,
    engine.bus,
    {
      founderId: FOUNDER_ID,
      payerId: FOUNDER_HOUSEHOLD_ID,
      businessTypeId: 'farm',
      siteId: PARCEL_ID,
      tenureKind: 'lease',
      companyName: 'Hale Farm',
      positions: 2,
      postedWage: 20,
      investment: 1000,
      initialInputUnits: 0,
      founderWorks: true,
      details: { reasons: ['nobody in town makes grain'], believed: { profitPerMonth: 900 } },
    },
    FOUNDED,
  );
  if (!result.ok) throw new Error(result.reason);
  engine.applyForJob('seeker-0', `${result.companyId}-farm`, { haggle: false, scope: 'settlement' });
  return { engine, companyId: result.companyId };
}

function snapshot(engine: Engine): string {
  return JSON.stringify(
    ['traits', 'wallets', 'items', 'employment', 'event_log', 'skills'].map((table) =>
      queryRow(engine.db, `SELECT COUNT(*) FROM ${table}`),
    ),
  );
}

describe('profiles (reports/profiles.ts)', () => {
  it('reading any profile never changes the world — traits included', async () => {
    const { engine, companyId } = await worldWithFarm('profiles-readonly');
    engine.createEntity('stranger', 'A Stranger'); // no traits stored yet
    const before = snapshot(engine);
    getPersonProfile(engine.db, 'stranger');
    getPersonProfile(engine.db, FOUNDER_ID);
    getHouseholdProfile(engine.db, FOUNDER_HOUSEHOLD_ID);
    getBusinessProfile(engine.db, companyId, FOUNDED);
    expect(snapshot(engine)).toBe(before);
    // ...and a peeked trait is the value the simulation will use.
    const peeked = getPersonProfile(engine.db, 'stranger').inspect.traits.ambition;
    expect(getTrait(engine.db, 'stranger', 'ambition')).toBe(peeked);
    engine.dispose();
  });

  it('a person: job, skills, ties, and — for Inspect — purse, traits, belongings', async () => {
    const { engine, companyId } = await worldWithFarm('profiles-person');
    const founder = getPersonProfile(engine.db, FOUNDER_ID);
    expect(founder.jobs[0]).toMatchObject({ companyId, title: 'Farmhand', endedTick: null });
    expect(founder.skills.find((s) => s.skill === 'management')).toMatchObject({ level: 3 });
    expect(founder.businesses).toEqual([{ companyId, companyName: 'Hale Farm', role: 'owner', open: true }]);
    expect(founder.relations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ relation: 'Household', target: 'household', id: FOUNDER_HOUSEHOLD_ID }),
        expect.objectContaining({ relation: 'Works for', target: 'business', id: companyId }),
        expect.objectContaining({ relation: 'Owns', target: 'business', id: companyId }),
      ]),
    );
    expect(founder.householdWealth).toBe(wealthBand(4000));
    expect(founder.inspect.householdCoin).toBe(4000);

    const hand = getPersonProfile(engine.db, 'seeker-0');
    expect(hand.relations).toEqual(
      expect.arrayContaining([expect.objectContaining({ relation: 'Answers to', id: FOUNDER_ID })]),
    );
    engine.dispose();
  });

  it('a household: members and their work, a wealth band, and its circumstances', async () => {
    const { engine, companyId } = await worldWithFarm('profiles-household');
    const house = getHouseholdProfile(engine.db, FOUNDER_HOUSEHOLD_ID)!;
    expect(house.members).toEqual([
      { id: FOUNDER_ID, name: 'Tomas Hale', jobTitle: 'Farmhand', companyId, companyName: 'Hale Farm' },
    ]);
    expect(house.wealth).toBe('well-off');
    expect(house.businesses.map((b) => b.companyName)).toEqual(['Hale Farm']);
    expect(house.inspect.coin).toBe(4000);
    expect(house.inspect.weeksOfFood).toBeCloseTo(4000 / (7 * 12), 0);

    const seeker = getHouseholdProfile(engine.db, 'house-seeker-0')!;
    expect(seeker.wealth).toBe('destitute');
    engine.dispose();
  });

  it("a business: who runs it, its land and staff in public; its books and the founder's reckoning under Inspect", async () => {
    const { engine, companyId } = await worldWithFarm('profiles-business');
    const farm = getBusinessProfile(engine.db, companyId, FOUNDED)!;
    expect(farm).toMatchObject({
      name: 'Hale Farm',
      status: 'open',
      ownerName: 'Tomas Hale',
      managerId: null,
      siteName: 'Eastfield',
      tenure: { kind: 'lease', weeklyRent: 15 },
      foundedTick: FOUNDED,
      founderName: 'Tomas Hale',
      foundingReasons: ['nobody in town makes grain'],
    });
    expect(farm.staff.map((s) => s.name).sort()).toEqual(['Seeker 0', 'Tomas Hale']);
    expect(farm.stock).toEqual([{ goodType: 'hoe', count: 1, conditionPercent: 100 }]);
    expect(farm.inspect.cash).toBe(1000 - 60 - 60);
    expect(farm.inspect.lifetime).toMatchObject({ ownerContributions: 1000, capital: 120 });
    expect(farm.inspect.investment).toBe(1000);
    // The reasons are public; the rest of the reckoning is private.
    expect(farm.inspect.founderEstimate).toEqual({ believed: { profitPerMonth: 900 } });
    engine.dispose();
  });
});
