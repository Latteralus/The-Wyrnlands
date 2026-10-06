import { describe, expect, it } from 'vitest';
import { createDatabase, queryRow } from '../db/sqlite';
import { loadSqlJs } from '../db/sqlite.node';
import { Engine } from '../engine';
import { countActiveItemsOfType } from '../inventory/items';
import { MANAGEMENT_SKILL, MILLING_SKILL } from '../skills/skills';
import { MINUTES_PER_DAY } from '../time/clock';
import { recordLedgerEntry, setCompanyInsolvency } from './companies';
import { applyCompanyDailyCadence } from './decisions';

async function newEngine(seed: string) {
  const SQL = await loadSqlJs();
  const db = createDatabase(SQL);
  const engine = Engine.bootstrap(db, { seed });
  engine.createSite({ id: 'market', name: 'Market', kind: 'market', x: 0, y: 0 });
  return engine;
}

// A one-slot mill whose owner (with the given Management XP) is its one
// worker, 1000 coin of capital, and a deep grain listing to buy from.
async function millWithOwner(seed: string, managementXp: number) {
  const engine = await newEngine(seed);
  engine.createSite({ id: 'mill', name: 'Mill', kind: 'mill', x: 1, y: 1 });
  engine.createCompany({ id: 'mill-co', name: 'Mill Co', kind: 'mill', siteId: 'mill' });
  engine.createJobSlot({
    id: 'mill-job',
    companyId: 'mill-co',
    title: 'Miller',
    skill: MILLING_SKILL,
    wageMin: 1,
    wageMax: 2,
    shiftDurationTicks: 60,
    capacity: 1,
  });
  engine.createEntity('owner-1', 'Owner');
  engine.ensureSkill('owner-1', MANAGEMENT_SKILL);
  if (managementXp > 0) engine.addSkillXp('owner-1', MANAGEMENT_SKILL, managementXp);
  engine.setCompanyOwner('mill-co', 'owner-1');
  engine.applyForJob('owner-1', 'mill-job', { haggle: false });
  engine.faucetCoin('mill-co', 1000, 'starting capital');
  engine.seedMarketListing('market', 'grain', 1, 1000);
  return engine;
}

function countConsigned(engine: Engine, consignorId: string): number {
  return Number(
    queryRow(engine.db, 'SELECT COUNT(*) FROM market_consignments WHERE consignor_id = ?', [
      consignorId,
    ])?.[0] ?? 0,
  );
}

describe('applyCompanyDailyCadence', () => {
  it('consigns all of its output to the market the same day', async () => {
    const engine = await newEngine('decisions-sell');
    engine.createSite({ id: 'farm', name: 'Farm', kind: 'farm', x: 1, y: 1 });
    engine.createCompany({ id: 'farm-co', name: 'Farm Co', kind: 'farm', siteId: 'farm' });
    engine.createJobSlot({
      id: 'farm-job',
      companyId: 'farm-co',
      title: 'Farmhand',
      skill: 'farming',
      wageMin: 1,
      wageMax: 2,
      shiftDurationTicks: 60,
      capacity: 1,
    });
    for (let i = 0; i < 20; i++) {
      engine.produceItem({ id: `grain-${i}`, type: 'grain', containerId: 'farm-co' });
    }

    applyCompanyDailyCadence(engine.db, engine.bus, MINUTES_PER_DAY);

    // The market (and its stock-based price) is where demand is found — the
    // farm holds nothing back, and every unit is consigned in its name.
    expect(engine.getMarketListing('market', 'grain')?.quantity).toBe(20);
    expect(engine.getMarketListing('market', 'grain')?.producerCompanyId).toBe('farm-co');
    expect(countActiveItemsOfType(engine.db, 'farm-co', 'grain')).toBe(0);
    expect(countConsigned(engine, 'farm-co')).toBe(20);

    engine.dispose();
  });

  it('a poorly-managed company keeps only a day of input in hand; a well-managed one plans ahead', async () => {
    const sloppy = await millWithOwner('decisions-restock-sloppy', 0);
    // Day 1 isn't a level-0 owner's restocking day (every 5 days) — but
    // nobody leaves hands idle: it buys one day's work for its one miller.
    applyCompanyDailyCadence(sloppy.db, sloppy.bus, 1 * MINUTES_PER_DAY);
    expect(countActiveItemsOfType(sloppy.db, 'mill-co', 'grain')).toBe(25);
    // With that in hand, the next day it buys nothing more.
    applyCompanyDailyCadence(sloppy.db, sloppy.bus, 2 * MINUTES_PER_DAY);
    expect(countActiveItemsOfType(sloppy.db, 'mill-co', 'grain')).toBe(25);

    const eager = await millWithOwner('decisions-restock-eager', 1100); // level 5
    applyCompanyDailyCadence(eager.db, eager.bus, 1 * MINUTES_PER_DAY);
    // Level 5 restocks daily: one miller's daily input at full labor
    // (25 sacks a shift, 6 workdays in 7) for its 1-day interval plus a
    // 2-day buffer — planned from capacity, since there's no sales history
    // to plan from yet.
    expect(countActiveItemsOfType(eager.db, 'mill-co', 'grain')).toBe(Math.ceil(((25 * 6) / 7) * 3));

    sloppy.dispose();
    eager.dispose();
  });

  it('a demand-aware owner stops buying input while its own output sits unsold; a sloppy one keeps buying', async () => {
    for (const [xp, expectPurchase] of [
      [1100, false],
      [0, true],
    ] as const) {
      const engine = await millWithOwner(`decisions-glut-${xp}`, xp);
      // 40 unsold sacks consigned at market — more than flour's 30-sack
      // healthy reference stock, i.e. a glut.
      for (let i = 0; i < 40; i++)
        engine.produceItem({ id: `flour-${i}`, type: 'flour', containerId: 'mill-co' });
      applyCompanyDailyCadence(engine.db, engine.bus, 5 * MINUTES_PER_DAY); // a restock day at every level
      expect(countActiveItemsOfType(engine.db, 'mill-co', 'grain') > 0).toBe(expectPurchase);
      engine.dispose();
    }
  });

  it('buys a replacement tool when a job slot has none, from the merchant-faucet market (§9.4)', async () => {
    const engine = await newEngine('decisions-equipment');
    engine.createSite({ id: 'farm', name: 'Farm', kind: 'farm', x: 1, y: 1 });
    engine.createCompany({ id: 'farm-co', name: 'Farm Co', kind: 'farm', siteId: 'farm' });
    engine.createJobSlot({
      id: 'farm-job',
      companyId: 'farm-co',
      title: 'Farmhand',
      skill: 'farming',
      wageMin: 1,
      wageMax: 2,
      shiftDurationTicks: 60,
      toolGoodType: 'hoe',
      capacity: 1,
    });
    engine.faucetCoin('farm-co', 100, 'starting capital');
    engine.seedMarketListing('market', 'hoe', 12, 5);

    expect(countActiveItemsOfType(engine.db, 'farm-co', 'hoe')).toBe(0);
    applyCompanyDailyCadence(engine.db, engine.bus, MINUTES_PER_DAY);
    expect(countActiveItemsOfType(engine.db, 'farm-co', 'hoe')).toBe(1);
    expect(engine.getBalance('farm-co')).toBe(100 - 12);

    engine.dispose();
  });

  it('does not buy a second tool once one is already on hand', async () => {
    const engine = await newEngine('decisions-equipment-has-one');
    engine.createSite({ id: 'farm', name: 'Farm', kind: 'farm', x: 1, y: 1 });
    engine.createCompany({ id: 'farm-co', name: 'Farm Co', kind: 'farm', siteId: 'farm' });
    engine.createJobSlot({
      id: 'farm-job',
      companyId: 'farm-co',
      title: 'Farmhand',
      skill: 'farming',
      wageMin: 1,
      wageMax: 2,
      shiftDurationTicks: 60,
      toolGoodType: 'hoe',
      capacity: 1,
    });
    engine.produceItem({ id: 'farm-hoe-1', type: 'hoe', containerId: 'farm-co', durability: 3000 });
    engine.faucetCoin('farm-co', 100, 'starting capital');
    engine.seedMarketListing('market', 'hoe', 12, 5);

    applyCompanyDailyCadence(engine.db, engine.bus, MINUTES_PER_DAY);
    expect(countActiveItemsOfType(engine.db, 'farm-co', 'hoe')).toBe(1); // still just the one
    expect(engine.getBalance('farm-co')).toBe(100); // no purchase made

    engine.dispose();
  });

  it('upgrades tier and job-slot capacity when fully staffed, profitable, selling through, well-managed, and affordable (§9.5)', async () => {
    const engine = await millWithOwner('decisions-upgrade', 650); // level 3
    const day = 91; // past the first upgrade cooldown (90 days)
    engine.faucetCoin('mill-co', 4000, 'more capital');
    recordLedgerEntry(engine.db, 'mill-co', (day - 1) * MINUTES_PER_DAY, 'revenue', 1000, 'recent sales');
    recordLedgerEntry(
      engine.db,
      'mill-co',
      (day - 1) * MINUTES_PER_DAY,
      'material_cost',
      100,
      'recent costs',
    );
    const before = engine.getBalance('mill-co');

    expect(engine.getCompany('mill-co')?.tier).toBe(1);
    applyCompanyDailyCadence(engine.db, engine.bus, day * MINUTES_PER_DAY);

    expect(engine.getCompany('mill-co')?.tier).toBe(2);
    expect(engine.getCompany('mill-co')?.lastUpgradedTick).toBe(day * MINUTES_PER_DAY);
    const slot = engine.listJobOpenings().find((s) => s.id === 'mill-job');
    expect(slot?.capacity).toBe(1 + 2); // CAPACITY_PER_TIER, posted straight away
    expect(slot?.maxCapacity).toBe(1 + 2);
    // BASE_UPGRADE_COST + tier × UPGRADE_COST_PER_TIER (plus that day's grain restock).
    expect(engine.queryLog('settlement', 100).some((e) => e.type === 'business.upgraded')).toBe(true);
    expect(engine.getBalance('mill-co')).toBeLessThanOrEqual(before - (1000 + 750));

    engine.dispose();
  });

  it('does not upgrade inside the cooldown, however profitable', async () => {
    const engine = await millWithOwner('decisions-upgrade-cooldown', 650);
    engine.faucetCoin('mill-co', 4000, 'more capital');
    recordLedgerEntry(engine.db, 'mill-co', 29 * MINUTES_PER_DAY, 'revenue', 1000, 'recent sales');
    applyCompanyDailyCadence(engine.db, engine.bus, 30 * MINUTES_PER_DAY);
    expect(engine.getCompany('mill-co')?.tier).toBe(1);
    engine.dispose();
  });

  it('lets its latest hire go when losing money, but never the owner (§9.6 "dismissal")', async () => {
    const engine = await millWithOwner('decisions-dismissal', 650);
    engine.db.run('UPDATE job_slots SET capacity = 2, max_capacity = 2 WHERE id = ?', ['mill-job']);
    engine.createEntity('worker-1', 'Worker');
    engine.applyForJob('worker-1', 'mill-job', { haggle: false });
    const day = 35; // a weekly decision day past the 28-day track record
    recordLedgerEntry(engine.db, 'mill-co', (day - 1) * MINUTES_PER_DAY, 'wage', 500, 'wages with no sales');

    applyCompanyDailyCadence(engine.db, engine.bus, day * MINUTES_PER_DAY);
    expect(engine.getEmployment('worker-1')).toBeNull();
    expect(engine.getEmployment('owner-1')).not.toBeNull();
    expect(engine.listJobOpenings().find((s) => s.id === 'mill-job')?.capacity).toBe(1);

    // A second losing week can't dismiss the owner from their own business.
    applyCompanyDailyCadence(engine.db, engine.bus, (day + 7) * MINUTES_PER_DAY);
    expect(engine.getEmployment('owner-1')).not.toBeNull();
    engine.dispose();
  });

  it("pays the owner's household a share of recent profit, keeping a cash reserve (§9.3)", async () => {
    const engine = await millWithOwner('decisions-draw', 650);
    // A day's grain already in hand, so no input purchase muddies the books.
    for (let i = 0; i < 25; i++)
      engine.produceItem({ id: `grain-${i}`, type: 'grain', containerId: 'mill-co' });
    engine.createHousehold({ id: 'owner-house', name: 'Owner House', homeSiteId: 'market' });
    engine.addHouseholdMember('owner-house', 'owner-1');
    const day = 35;
    recordLedgerEntry(engine.db, 'mill-co', (day - 1) * MINUTES_PER_DAY, 'revenue', 600, 'recent sales');

    applyCompanyDailyCadence(engine.db, engine.bus, day * MINUTES_PER_DAY);
    // Half of 600 profit; the 1000 starting cash more than covers the
    // reserve (500 + two weeks' wages).
    expect(engine.getBalance('owner-house')).toBe(300);
    expect(engine.getCompanyLedgerSummary('mill-co', 0).ownerDraws).toBe(300);
    expect(engine.getCompanyLedgerSummary('mill-co', 0).net).toBe(600); // draws aren't costs

    // A week later nothing new has been earned — no second draw.
    applyCompanyDailyCadence(engine.db, engine.bus, (day + 7) * MINUTES_PER_DAY);
    expect(engine.getBalance('owner-house')).toBe(300);
    engine.dispose();
  });

  it('does not upgrade when there is still room to hire without spending on expansion', async () => {
    const engine = await newEngine('decisions-no-upgrade-room');
    engine.createSite({ id: 'mill', name: 'Mill', kind: 'mill', x: 1, y: 1 });
    engine.createCompany({ id: 'mill-co', name: 'Mill Co', kind: 'mill', siteId: 'mill' });
    engine.createJobSlot({
      id: 'mill-job',
      companyId: 'mill-co',
      title: 'Miller',
      skill: MILLING_SKILL,
      wageMin: 1,
      wageMax: 2,
      shiftDurationTicks: 60,
      capacity: 2, // one filled, one still open
    });
    engine.createEntity('owner-1', 'Owner');
    engine.ensureWallet('owner-1');
    engine.ensureSkill('owner-1', MANAGEMENT_SKILL);
    engine.addSkillXp('owner-1', MANAGEMENT_SKILL, 650);
    engine.setCompanyOwner('mill-co', 'owner-1');
    engine.applyForJob('owner-1', 'mill-job', { haggle: false });

    engine.faucetCoin('mill-co', 1000, 'starting capital');
    recordLedgerEntry(engine.db, 'mill-co', 0, 'revenue', 500, 'past sales');

    applyCompanyDailyCadence(engine.db, engine.bus, MINUTES_PER_DAY);
    expect(engine.getCompany('mill-co')?.tier).toBe(1);

    engine.dispose();
  });

  it('flags a company as insolvent when its balance hits zero, and clears the flag on recovery', async () => {
    const engine = await newEngine('decisions-insolvency');
    engine.createCompany({ id: 'broke-co', name: 'Broke Co', kind: 'test', siteId: 'market' });

    applyCompanyDailyCadence(engine.db, engine.bus, MINUTES_PER_DAY);
    expect(engine.getCompany('broke-co')?.insolventSinceTick).toBe(MINUTES_PER_DAY);

    engine.faucetCoin('broke-co', 50, 'a rescue');
    applyCompanyDailyCadence(engine.db, engine.bus, 2 * MINUTES_PER_DAY);
    expect(engine.getCompany('broke-co')?.insolventSinceTick).toBeNull();

    engine.dispose();
  });

  it('does not close a company still within its insolvency grace period', async () => {
    const engine = await newEngine('decisions-no-early-closure');
    engine.createCompany({ id: 'farm-co', name: 'Farm Co', kind: 'farm', siteId: 'market' });
    engine.createJobSlot({
      id: 'farm-job',
      companyId: 'farm-co',
      title: 'Farmhand',
      skill: 'farming',
      wageMin: 1,
      wageMax: 2,
      shiftDurationTicks: 60,
      capacity: 1,
    });
    engine.createEntity('worker-1', 'Worker');
    engine.ensureWallet('worker-1');
    engine.applyForJob('worker-1', 'farm-job', { haggle: false });

    // No owner -> NEUTRAL_MANAGEMENT_LEVEL(2) -> grace period 10+2*4=18 days.
    setCompanyInsolvency(engine.db, 'farm-co', 0);
    applyCompanyDailyCadence(engine.db, engine.bus, 5 * MINUTES_PER_DAY); // only 5 days elapsed

    expect(engine.getCompany('farm-co')?.closedAtTick).toBeNull();
    expect(engine.getEmployment('worker-1')).not.toBeNull();

    engine.dispose();
  });

  it('closes a company that stays insolvent past its grace period: terminates workers, auctions tools, spoils leftover stock (§9.6)', async () => {
    const engine = await newEngine('decisions-closure');
    engine.createSite({ id: 'farm', name: 'Farm', kind: 'farm', x: 1, y: 1 });
    engine.createCompany({ id: 'farm-co', name: 'Farm Co', kind: 'farm', siteId: 'farm' });
    engine.createJobSlot({
      id: 'farm-job',
      companyId: 'farm-co',
      title: 'Farmhand',
      skill: 'farming',
      wageMin: 1,
      wageMax: 2,
      shiftDurationTicks: 60,
      toolGoodType: 'hoe',
      capacity: 1,
    });
    engine.produceItem({ id: 'farm-hoe-1', type: 'hoe', containerId: 'farm-co', durability: 3000 });
    engine.produceItem({ id: 'farm-grain-1', type: 'grain', containerId: 'farm-co' });
    engine.createEntity('worker-1', 'Worker');
    engine.ensureWallet('worker-1');
    engine.applyForJob('worker-1', 'farm-job', { haggle: false });

    // No owner -> NEUTRAL_MANAGEMENT_LEVEL(2) -> grace period 10+2*4=18 days.
    setCompanyInsolvency(engine.db, 'farm-co', 0);
    applyCompanyDailyCadence(engine.db, engine.bus, 20 * MINUTES_PER_DAY); // 20 days elapsed > 18

    const company = engine.getCompany('farm-co');
    expect(company?.closedAtTick).toBe(20 * MINUTES_PER_DAY);
    expect(engine.getEmployment('worker-1')).toBeNull(); // terminated

    // The hoe was auctioned — a real, buyable market listing now exists.
    expect(engine.getItem('farm-hoe-1')?.containerId).toBe('market-stock');
    expect(engine.getItem('farm-hoe-1')?.status).toBe('active'); // transferred, not destroyed
    expect(engine.getMarketListing('market', 'hoe')?.quantity).toBe(1);

    // Leftover raw material has no buyer once its producer is gone — spoils.
    expect(engine.getItem('farm-grain-1')?.status).toBe('spoiled');

    expect(engine.queryLog('settlement', 100).some((e) => e.type === 'business.closed')).toBe(true);
    // Closed companies drop out of job listings (jobs.ts's listJobOpenings filter).
    expect(engine.listJobOpenings().some((s) => s.id === 'farm-job')).toBe(false);

    engine.dispose();
  });

  it('does nothing more for an already-closed company on later cadence calls', async () => {
    const engine = await newEngine('decisions-closed-idempotent');
    engine.createCompany({ id: 'farm-co', name: 'Farm Co', kind: 'farm', siteId: 'market' });
    setCompanyInsolvency(engine.db, 'farm-co', 0);
    applyCompanyDailyCadence(engine.db, engine.bus, 20 * MINUTES_PER_DAY);
    expect(engine.getCompany('farm-co')?.closedAtTick).toBe(20 * MINUTES_PER_DAY);

    engine.faucetCoin('farm-co', 500, 'irrelevant now');
    applyCompanyDailyCadence(engine.db, engine.bus, 30 * MINUTES_PER_DAY);

    // Still closed at the original tick — a solvent balance afterward
    // doesn't reopen it, and no second closure event fires.
    expect(engine.getCompany('farm-co')?.closedAtTick).toBe(20 * MINUTES_PER_DAY);
    const closedEvents = engine.queryLog('settlement', 100).filter((e) => e.type === 'business.closed');
    expect(closedEvents.length).toBe(1);

    engine.dispose();
  });
});
