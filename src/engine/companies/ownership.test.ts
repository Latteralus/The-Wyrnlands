import { describe, expect, it } from 'vitest';
import { createDatabase } from '../db/sqlite';
import { loadSqlJs } from '../db/sqlite.node';
import { Engine } from '../engine';
import { setTrait } from '../population/traits';
import {
  addJobSeekers,
  buildFoundingWorld,
  FOUNDER_HOUSEHOLD_ID,
  FOUNDER_ID,
  PARCEL_ID,
} from '../scenarios/foundingWorld';
import { MANAGEMENT_SKILL, MILLING_SKILL } from '../skills/skills';
import { MINUTES_PER_DAY } from '../time/clock';
import { recordLedgerEntry, setCompanyManager } from './companies';
import { applyCompanyDailyCadence } from './decisions';
import { foundCompany } from './founding';

// The owner's side of running a business (companies/decisions.ts): rent on
// leased land, propping a business up from the family purse, winding a
// hopeless one down, lifecycle milestones, and owner vs manager.

// A mill on leased land with two 20-coin hands (its owner one of them), the
// owner in a household with savings.
async function ownedCompany(seed: string, managementXp: number, ownerSavings = 2000) {
  const engine = Engine.bootstrap(createDatabase(await loadSqlJs()), { seed });
  engine.createSite({ id: 'market', name: 'Market', kind: 'market', x: 0, y: 0 });
  engine.createSite({ id: 'plot', name: 'The Plot', kind: 'mill', x: 1, y: 1, landValue: 800 });
  engine.createCompany({ id: 'co', name: 'Owned Co', kind: 'mill', siteId: 'plot' });
  engine.grantSiteTenure('plot', 'co', 'lease');
  engine.createJobSlot({
    id: 'co-job',
    companyId: 'co',
    title: 'Miller',
    skill: MILLING_SKILL,
    wageMin: 20,
    wageMax: 30,
    shiftDurationTicks: 360,
    capacity: 2,
  });
  engine.createHousehold({ id: 'owner-house', name: 'Owner House', homeSiteId: 'market' });
  engine.createEntity('owner-1', 'Owner One');
  engine.addHouseholdMember('owner-house', 'owner-1');
  if (ownerSavings > 0) engine.faucetCoin('owner-house', ownerSavings, 'savings');
  engine.ensureSkill('owner-1', MANAGEMENT_SKILL);
  if (managementXp > 0) engine.addSkillXp('owner-1', MANAGEMENT_SKILL, managementXp);
  setTrait(engine.db, 'owner-1', 'risk_tolerance', 1);
  engine.setCompanyOwner('co', 'owner-1');
  engine.applyForJob('owner-1', 'co-job', { haggle: false });
  engine.createEntity('hand-1', 'Hand One');
  engine.applyForJob('hand-1', 'co-job', { haggle: false });
  return engine;
}

describe('owner-side company behavior', () => {
  it('pays weekly rent on leased land, as an operating cost', async () => {
    const engine = await ownedCompany('ownership-rent', 650);
    engine.faucetCoin('co', 1000, 'capital');
    applyCompanyDailyCadence(engine.db, engine.bus, 7 * MINUTES_PER_DAY);
    const ledger = engine.getCompanyLedgerSummary('co', 0);
    expect(ledger.rent).toBe(20); // 800 × 2.5%
    expect(ledger.net).toBe(-20);
    engine.dispose();
  });

  it("props up a viable business that's short of cash, out of household savings beyond a cushion", async () => {
    const engine = await ownedCompany('ownership-inject', 650); // Management 3
    engine.faucetCoin('co', 50, 'all that is left'); // under a week's wages (2 × 20 × 6)
    recordLedgerEntry(engine.db, 'co', 30 * MINUTES_PER_DAY, 'revenue', 500, 'sales still coming in');
    applyCompanyDailyCadence(engine.db, engine.bus, 40 * MINUTES_PER_DAY);

    // Topped up to two weeks' wages: 480 − 50.
    expect(engine.getBalance('co')).toBe(480);
    expect(engine.getBalance('owner-house')).toBe(2000 - 430);
    expect(engine.getCompanyLedgerSummary('co', 0).ownerContributions).toBe(430);
    expect(engine.queryLog('settlement').some((e) => e.type === 'business.owner_injection')).toBe(true);

    // Not again within four weeks.
    engine.sinkCoin('co', engine.getBalance('co') - 10, 'spent');
    applyCompanyDailyCadence(engine.db, engine.bus, 41 * MINUTES_PER_DAY);
    expect(engine.getBalance('co')).toBe(10);
    expect(engine.runConservationAudit().passed).toBe(true);
    engine.dispose();
  });

  it('never dips into the household cushion — nothing is created to save a business', async () => {
    // 300 coin is under four weeks' bread for one (4 × 7 × 12 = 336).
    const engine = await ownedCompany('ownership-inject-cushion', 650, 300);
    engine.faucetCoin('co', 50, 'all that is left');
    recordLedgerEntry(engine.db, 'co', 30 * MINUTES_PER_DAY, 'revenue', 500, 'sales');
    applyCompanyDailyCadence(engine.db, engine.bus, 40 * MINUTES_PER_DAY);
    expect(engine.getBalance('owner-house')).toBe(300);
    expect(engine.getBalance('co')).toBe(50);
    engine.dispose();
  });

  it('a competent owner refuses to rescue a business earning nothing; a poor one throws good money after bad', async () => {
    const competent = await ownedCompany('ownership-hopeless', 650);
    competent.faucetCoin('co', 50, 'all that is left');
    applyCompanyDailyCadence(competent.db, competent.bus, 40 * MINUTES_PER_DAY); // no revenue in four weeks
    expect(competent.getBalance('owner-house')).toBe(2000);
    competent.dispose();

    const poor = await ownedCompany('ownership-poor', 0);
    poor.faucetCoin('co', 50, 'all that is left');
    applyCompanyDailyCadence(poor.db, poor.bus, 40 * MINUTES_PER_DAY);
    expect(poor.getBalance('owner-house')).toBeLessThan(2000);
    poor.dispose();
  });

  it('a capable owner winds down a business that keeps losing money and keeps what is left; a poor one rides it on', async () => {
    const lossyCompany = async (seed: string, xp: number) => {
      const engine = await ownedCompany(seed, xp);
      engine.faucetCoin('co', 1000, 'what is left of the capital');
      recordLedgerEntry(engine.db, 'co', 100 * MINUTES_PER_DAY, 'wage', 3000, 'wages, no sales');
      recordLedgerEntry(engine.db, 'co', 120 * MINUTES_PER_DAY, 'wage', 500, 'wages, no sales');
      applyCompanyDailyCadence(engine.db, engine.bus, 126 * MINUTES_PER_DAY); // a weekly decision day
      return engine;
    };

    const capable = await lossyCompany('ownership-wind-down', 650);
    expect(capable.getCompany('co')?.closedAtTick).toBe(126 * MINUTES_PER_DAY);
    // What's left goes home with the owner; the land is freed; the hands let go.
    expect(capable.getBalance('co')).toBe(0);
    expect(capable.getBalance('owner-house')).toBe(2000 + 1000);
    expect(capable.getOpenSiteTenure('plot')).toBeNull();
    expect(capable.getEmployment('hand-1')).toBeNull();
    const closed = capable.queryLog('settlement').find((e) => e.type === 'business.closed');
    expect(closed?.data).toMatchObject({ reason: 'wound_down', returnedToOwner: 1000 });
    expect(capable.runConservationAudit().passed).toBe(true);
    capable.dispose();

    const poor = await lossyCompany('ownership-no-wind-down', 200); // Management 1
    expect(poor.getCompany('co')?.closedAtTick).toBeNull();
    poor.dispose();
  });

  it('decisions follow the manager, not the owner, when one is appointed — and the manager is who learns', async () => {
    const engine = await ownedCompany('ownership-manager', 0);
    engine.createEntity('steward', 'A Steward');
    engine.addSkillXp('steward', MANAGEMENT_SKILL, 1100);
    setCompanyManager(engine.db, 'co', 'steward');
    engine.faucetCoin('co', 1000, 'capital');
    applyCompanyDailyCadence(engine.db, engine.bus, 7 * MINUTES_PER_DAY);
    expect(engine.getSkillXp('steward', MANAGEMENT_SKILL)).toBe(1100 + 4);
    expect(engine.getSkillXp('owner-1', MANAGEMENT_SKILL)).toBe(0);
    engine.dispose();
  });

  it("logs a founded business's first hired hand and first profitable month", async () => {
    const engine = await buildFoundingWorld('ownership-milestones');
    addJobSeekers(engine, 1);
    const founded = 14 * MINUTES_PER_DAY;
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
      },
      founded,
    );
    if (!result.ok) throw new Error(result.reason);
    engine.applyForJob('seeker-0', `${result.companyId}-farm`, { haggle: false });
    applyCompanyDailyCadence(engine.db, engine.bus, 21 * MINUTES_PER_DAY);
    const log = () => engine.queryActorLog(result.companyId).map((e) => e.type);
    expect(log()).toContain('business.first_hire');
    expect(log()).not.toContain('business.first_profit');

    recordLedgerEntry(engine.db, result.companyId, 40 * MINUTES_PER_DAY, 'revenue', 900, 'a good harvest');
    applyCompanyDailyCadence(engine.db, engine.bus, 42 * MINUTES_PER_DAY);
    expect(log()).toContain('business.first_profit');
    expect(log().filter((t) => t === 'business.first_hire')).toHaveLength(1);
    engine.dispose();
  });
});
