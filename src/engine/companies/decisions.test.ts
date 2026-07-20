import { describe, expect, it } from 'vitest';
import { createDatabase } from '../db/sqlite';
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

describe('applyCompanyDailyCadence', () => {
  it('sells surplus output above the reserve, leaving the reserve behind', async () => {
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

    expect(engine.getMarketListing('market', 'grain')?.quantity).toBe(10); // 20 - OUTPUT_RESERVE(10)
    expect(engine.getMarketListing('market', 'grain')?.producerCompanyId).toBe('farm-co');
    expect(countActiveItemsOfType(engine.db, 'farm-co', 'grain')).toBe(10); // reserve kept

    engine.dispose();
  });

  it('a poorly-managed company restocks inputs less often and in smaller batches than a well-managed one', async () => {
    const sloppy = await newEngine('decisions-restock-sloppy');
    sloppy.createSite({ id: 'mill', name: 'Mill', kind: 'mill', x: 1, y: 1 });
    sloppy.createCompany({ id: 'mill-co', name: 'Mill Co', kind: 'mill', siteId: 'mill' });
    sloppy.createJobSlot({
      id: 'mill-job',
      companyId: 'mill-co',
      title: 'Miller',
      skill: MILLING_SKILL,
      wageMin: 1,
      wageMax: 2,
      shiftDurationTicks: 60,
      capacity: 1,
    });
    sloppy.createEntity('sloppy-owner', 'Sloppy Owner');
    sloppy.ensureSkill('sloppy-owner', MANAGEMENT_SKILL); // level 0
    sloppy.setCompanyOwner('mill-co', 'sloppy-owner');
    sloppy.faucetCoin('mill-co', 1000, 'starting capital');
    sloppy.seedMarketListing('market', 'grain', 1, 1000);

    // Day 1: level-0 management restocks only every 5 days (day % 5 === 0) —
    // day 1 isn't one of them, so no purchase should happen yet.
    applyCompanyDailyCadence(sloppy.db, sloppy.bus, 1 * MINUTES_PER_DAY);
    expect(countActiveItemsOfType(sloppy.db, 'mill-co', 'grain')).toBe(0);

    const eager = await newEngine('decisions-restock-eager');
    eager.createSite({ id: 'mill', name: 'Mill', kind: 'mill', x: 1, y: 1 });
    eager.createCompany({ id: 'mill-co', name: 'Mill Co', kind: 'mill', siteId: 'mill' });
    eager.createJobSlot({
      id: 'mill-job',
      companyId: 'mill-co',
      title: 'Miller',
      skill: MILLING_SKILL,
      wageMin: 1,
      wageMax: 2,
      shiftDurationTicks: 60,
      capacity: 1,
    });
    eager.createEntity('eager-owner', 'Eager Owner');
    eager.ensureSkill('eager-owner', MANAGEMENT_SKILL);
    eager.addSkillXp('eager-owner', MANAGEMENT_SKILL, 1100); // level 5
    eager.setCompanyOwner('mill-co', 'eager-owner');
    eager.faucetCoin('mill-co', 1000, 'starting capital');
    eager.seedMarketListing('market', 'grain', 1, 1000);

    // Same day 1: level-5 management restocks every day, in a bigger batch.
    applyCompanyDailyCadence(eager.db, eager.bus, 1 * MINUTES_PER_DAY);
    const eagerGrain = countActiveItemsOfType(eager.db, 'mill-co', 'grain');
    expect(eagerGrain).toBeGreaterThan(0);
    expect(eagerGrain).toBe(10 + 5 * 6); // BASE_RESTOCK_QUANTITY + level*RESTOCK_QUANTITY_PER_MANAGEMENT_LEVEL

    sloppy.dispose();
    eager.dispose();
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

  it('upgrades tier and job-slot capacity when fully staffed, profitable, well-managed, and affordable (§9.5)', async () => {
    const engine = await newEngine('decisions-upgrade');
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
    engine.ensureWallet('owner-1');
    engine.ensureSkill('owner-1', MANAGEMENT_SKILL);
    engine.addSkillXp('owner-1', MANAGEMENT_SKILL, 650); // level 3
    engine.setCompanyOwner('mill-co', 'owner-1');
    engine.applyForJob('owner-1', 'mill-job', { haggle: false }); // fills the only slot

    engine.faucetCoin('mill-co', 1000, 'starting capital');
    recordLedgerEntry(engine.db, 'mill-co', 0, 'revenue', 500, 'past sales');
    recordLedgerEntry(engine.db, 'mill-co', 0, 'material_cost', 100, 'past costs');

    expect(engine.getCompany('mill-co')?.tier).toBe(1);
    applyCompanyDailyCadence(engine.db, engine.bus, MINUTES_PER_DAY);

    expect(engine.getCompany('mill-co')?.tier).toBe(2);
    const slot = engine.listJobOpenings().find((s) => s.id === 'mill-job');
    expect(slot?.capacity).toBe(1 + 2); // CAPACITY_PER_TIER
    expect(engine.getBalance('mill-co')).toBe(1000 - (200 + 1 * 150)); // BASE_UPGRADE_COST + tier*UPGRADE_COST_PER_TIER
    expect(engine.queryLog('settlement', 100).some((e) => e.type === 'business.upgraded')).toBe(true);

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
