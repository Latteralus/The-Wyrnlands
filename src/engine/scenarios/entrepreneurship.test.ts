import { describe, expect, it } from 'vitest';
import { listFoundingRecords } from '../companies/founding';
import { createDatabase, queryRow, queryRows } from '../db/sqlite';
import { loadSqlJs } from '../db/sqlite.node';
import { Engine } from '../engine';
import { applyNpcJobSeekingWeeklyCadence, applyNpcLaborDailyCadence } from '../population/cadence';
import { applyEntrepreneurshipCadence } from '../population/entrepreneurship';
import { createRng } from '../rng';
import { seedDemoWorld } from '../seed/demoWorld';
import { BAKING_SKILL } from '../skills/skills';
import { MINUTES_PER_DAY } from '../time/clock';
import { getOpenTenure } from '../world/tenure';
import { addHungryMill, buildFoundingWorld, FOUNDER_HOUSEHOLD_ID, FOUNDER_ID } from './foundingWorld';

// Headless scenarios for NPC-founded businesses (population/
// entrepreneurship.ts → companies/founding.ts → the ordinary company
// cadence): what happens to a business after it opens, run through the
// real daily/weekly machinery rather than asserted into existence.

const DAY = MINUTES_PER_DAY;

describe('NPC-founded businesses, run for real', () => {
  it('labor shortage: a new business with nobody to hire runs short-handed, its founder working it alone', async () => {
    // A mill crying out for grain, a capitalized founder — and nobody else
    // in town looking for work.
    const engine = await buildFoundingWorld('scenario-labor-shortage');
    addHungryMill(engine);
    const stats = applyEntrepreneurshipCadence(engine.db, engine.bus, 28 * DAY, () => 0.5);
    expect(stats.founded).toHaveLength(1);
    const companyId = stats.founded[0]!;
    const slot = engine.listJobSlotsForCompany(companyId)[0]!;
    expect(slot.capacity).toBeGreaterThan(1);

    const rng = createRng(1);
    for (let day = 29; day <= 56; day++) {
      if (day % 7 === 0) applyNpcJobSeekingWeeklyCadence(engine.db, engine.bus, day * DAY, rng);
      applyNpcLaborDailyCadence(engine.db, engine.bus, day * DAY, rng);
    }
    // Four weeks on: still only the founder — positions posted, never filled.
    expect(engine.countActiveEmploymentsForSlot(slot.id)).toBe(1);
    expect(engine.getEmployment(FOUNDER_ID)?.companyId).toBe(companyId);
    // ...but the founder's own shifts are real production.
    const grown = Number(
      queryRow(engine.db, "SELECT COUNT(*) FROM items WHERE type = 'grain' AND id LIKE ?", [
        `${companyId}-%`,
      ])?.[0],
    );
    expect(grown).toBeGreaterThan(0);
    engine.dispose();
  });

  it('failure: a badly managed bakery opened into a glutted market fails through the ordinary insolvency path', async () => {
    // A poor manager who knows baking, from a well-off family, with nerve,
    // in a town that already has all the bread it wants (and dear flour).
    // (Their own plan — a week of flour at full tilt — needs ~9,000 coin.)
    const engine = await buildFoundingWorld('scenario-failure', {
      founderCoin: 15_000,
      founderManagementXp: 0,
      riskTolerance: 1,
      farmParcel: false,
    });
    engine.createSite({
      id: 'bakehouse',
      name: 'The Old Bakehouse',
      kind: 'bakery',
      x: 2,
      y: 2,
      landValue: 600,
    });
    engine.seedMarketListing('market', 'flour', 20, 200);
    engine.addSkillXp(FOUNDER_ID, BAKING_SKILL, 1000);

    // Let the market record a few weeks of a quiet bread trade, then the
    // fortnightly entrepreneurship pass runs as part of the real tick loop.
    engine.advanceTicks(28 * DAY);
    const founding = listFoundingRecords(engine.db)[0];
    expect(founding?.businessType).toBe('bakery');
    const companyId = founding!.companyId;
    const savingsAfterFounding = engine.getBalance(FOUNDER_HOUSEHOLD_ID);

    engine.advanceTicks(120 * DAY);
    const company = engine.getCompany(companyId)!;
    expect(company.closedAtTick).not.toBeNull();
    const log = engine.queryActorLog(companyId, 500).map((e) => e.type);
    expect(log).toContain('business.distressed');
    const closed = engine.queryActorLog(companyId, 500).find((e) => e.type === 'business.closed');
    expect(closed?.data?.reason).toBe('insolvency');
    // Its land is free again, and the family that bankrolled it lost what it
    // put in: nothing came back when it closed.
    expect(getOpenTenure(engine.db, 'bakehouse')).toBeNull();
    expect(closed?.data?.returnedToOwner).toBe(0);
    expect(engine.getBalance(FOUNDER_HOUSEHOLD_ID)).toBeLessThanOrEqual(savingsAfterFounding);
    expect(engine.getEmployment(FOUNDER_ID)).toBeNull();
    // Every night's books balanced throughout.
    expect(Number(queryRow(engine.db, 'SELECT COUNT(*) FROM audits WHERE passed = 0')?.[0])).toBe(0);
    engine.dispose();
  }, 60_000);

  it('the seeded world: businesses get founded for stated reasons, land and money stay consistent', async () => {
    // stage5-scale-stress (also a sim:perf seed) sees its first foundings
    // within the first month: an owner opening a second farm to answer
    // grain imports, and a second logging operation.
    const engine = Engine.bootstrap(createDatabase(await loadSqlJs()), { seed: 'stage5-scale-stress' });
    seedDemoWorld(engine);
    const startingCompanies = engine.listCompanies().length;
    engine.advanceTicks(60 * DAY);

    const foundings = listFoundingRecords(engine.db);
    expect(foundings.length).toBeGreaterThan(0);
    expect(engine.listCompanies().length).toBe(startingCompanies + foundings.length);
    for (const founding of foundings) {
      const company = engine.getCompany(founding.companyId)!;
      expect(company.ownerId).toBe(founding.founderId);
      expect(founding.investment).toBeLessThanOrEqual(founding.payerBalanceBefore);
      expect((founding.details?.reasons as unknown[]).length).toBeGreaterThan(0);
      expect(
        engine.queryActorLog(founding.founderId, 500).some((e) => e.type === 'entrepreneur.opportunity'),
      ).toBe(true);
    }
    // Every open business holds exactly its own parcel; no parcel is held twice.
    for (const company of engine.listCompanies()) {
      const tenure = getOpenTenure(engine.db, company.siteId);
      if (company.closedAtTick === null) expect(tenure?.holderId).toBe(company.id);
      else expect(tenure?.holderId).not.toBe(company.id);
    }
    const openTenures = queryRows(
      engine.db,
      'SELECT site_id FROM site_tenures WHERE released_at_tick IS NULL',
    );
    expect(new Set(openTenures.map((r) => String(r[0]))).size).toBe(openTenures.length);
    expect(Number(queryRow(engine.db, 'SELECT COUNT(*) FROM audits WHERE passed = 0')?.[0])).toBe(0);
    engine.dispose();
  }, 120_000);
});
