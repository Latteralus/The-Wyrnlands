import { describe, expect, it } from 'vitest';
import { createDatabase, queryRow } from '../db/sqlite';
import { loadSqlJs } from '../db/sqlite.node';
import { Engine } from '../engine';
import { getGoodDefinition } from '../goods/catalog';
import { countActiveItemsOfType } from '../inventory/items';
import { SHIFT_XP, TOOL_WEAR_PER_SHIFT } from '../jobs/shifts';
import { getRecipeForSkill } from '../production/recipes';
import { MINUTES_PER_DAY } from '../time/clock';
import {
  applyHouseholdDailyCadence,
  applyHouseholdMigrationWeeklyCadence,
  applyNpcJobSeekingWeeklyCadence,
  applyNpcLaborDailyCadence,
  applyParishTitheWeeklyCadence,
  PARISH_ID,
} from './cadence';
import { listAllHouseholdMemberIds, setHouseholdDestitution } from './households';

async function newEngineWithOpenJob(seed: string) {
  const SQL = await loadSqlJs();
  const db = createDatabase(SQL);
  const engine = Engine.bootstrap(db, { seed });
  engine.createSite({ id: 'farm', name: 'Farm', kind: 'farm', x: 0, y: 0 });
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
  return engine;
}

describe('applyNpcJobSeekingWeeklyCadence', () => {
  it('an unemployed household member takes an open job slot', async () => {
    const engine = await newEngineWithOpenJob('jobseek-basic');
    engine.createHousehold({ id: 'household-1', name: 'The Test Household', homeSiteId: 'farm' });
    engine.createEntity('npc-1', 'Test NPC');
    engine.ensureNeeds('npc-1');
    engine.addHouseholdMember('household-1', 'npc-1');

    expect(engine.getEmployment('npc-1')).toBeNull();
    applyNpcJobSeekingWeeklyCadence(engine.db, engine.bus, 100, () => 0.9); // no haggle

    expect(engine.getEmployment('npc-1')?.jobSlotId).toBe('farm-job');
    engine.dispose();
  });

  it('does nothing when there are no open slots', async () => {
    const SQL = await loadSqlJs();
    const db = createDatabase(SQL);
    const engine = Engine.bootstrap(db, { seed: 'jobseek-none' });
    engine.createHousehold({ id: 'household-1', name: 'The Test Household', homeSiteId: 'well' });
    engine.createEntity('npc-1', 'Test NPC');
    engine.ensureNeeds('npc-1');
    engine.addHouseholdMember('household-1', 'npc-1');

    // Should not throw with zero companies/job slots in the world at all.
    expect(() => applyNpcJobSeekingWeeklyCadence(engine.db, engine.bus, 100, () => 0.9)).not.toThrow();
    expect(engine.getEmployment('npc-1')).toBeNull();

    engine.dispose();
  });

  it('a financially strained household gets priority over a comfortable one for a single scarce opening', async () => {
    const engine = await newEngineWithOpenJob('jobseek-priority');

    engine.createHousehold({ id: 'comfortable', name: 'The Comfortable Household', homeSiteId: 'farm' });
    engine.faucetCoin('comfortable', 500, 'well off');
    engine.createEntity('comfortable-npc', 'Comfortable NPC');
    engine.ensureNeeds('comfortable-npc');
    engine.addHouseholdMember('comfortable', 'comfortable-npc');

    engine.createHousehold({ id: 'strained', name: 'The Strained Household', homeSiteId: 'farm' });
    // Balance starts at 0 — below RESERVE_HEALTHY_THRESHOLD, i.e. strained.
    engine.createEntity('strained-npc', 'Strained NPC');
    engine.ensureNeeds('strained-npc');
    engine.addHouseholdMember('strained', 'strained-npc');

    applyNpcJobSeekingWeeklyCadence(engine.db, engine.bus, 100, () => 0.9);

    // Only one job slot (capacity 1) — the strained household's member gets it.
    expect(engine.getEmployment('strained-npc')?.jobSlotId).toBe('farm-job');
    expect(engine.getEmployment('comfortable-npc')).toBeNull();

    const hardshipEvent = engine
      .queryLog('settlement', 100)
      .find((e) => e.type === 'household.hardship.member_works' && e.actorId === 'strained');
    expect(hardshipEvent).toBeDefined();

    engine.dispose();
  });
});

describe('applyHouseholdMigrationWeeklyCadence', () => {
  it('emigrates a household that has stayed destitute past the grace period (§11.4/§10 "migrate")', async () => {
    const SQL = await loadSqlJs();
    const db = createDatabase(SQL);
    const engine = Engine.bootstrap(db, { seed: 'migration-emigrate' });
    engine.createHousehold({ id: 'poor', name: 'The Poor Household', homeSiteId: 'tavern' });
    engine.createEntity('poor-npc', 'Poor NPC');
    engine.ensureNeeds('poor-npc');
    engine.addHouseholdMember('poor', 'poor-npc');
    engine.faucetCoin('poor', 3, 'a few coppers left'); // so there's something to sink
    engine.produceItem({ id: 'poor-cloak', type: 'cloak', containerId: 'poor' });

    setHouseholdDestitution(engine.db, 'poor', 0);
    applyHouseholdMigrationWeeklyCadence(engine.db, engine.bus, 61 * MINUTES_PER_DAY, () => 0.99); // 61 days > 60-day grace period, no immigration roll

    const household = engine.getHousehold('poor');
    expect(household?.departedAtTick).toBe(61 * MINUTES_PER_DAY);
    expect(engine.getBalance('poor')).toBe(0); // sunk
    expect(engine.getItem('poor-cloak')?.status).toBe('spoiled'); // left behind, not sold

    const log = engine.queryLog('settlement', 100);
    expect(log.some((e) => e.type === 'household.migration.emigrated' && e.actorId === 'poor')).toBe(true);

    // §14.2 presence rosters shouldn't show a ghost from a household that's
    // gone — presence.ts's listPresentEntities relies on this exclusion.
    expect(listAllHouseholdMemberIds(engine.db)).not.toContain('poor-npc');

    engine.dispose();
  });

  it('does not emigrate a household still within its grace period', async () => {
    const SQL = await loadSqlJs();
    const db = createDatabase(SQL);
    const engine = Engine.bootstrap(db, { seed: 'migration-grace' });
    engine.createHousehold({ id: 'poor', name: 'The Poor Household', homeSiteId: 'tavern' });
    engine.createEntity('poor-npc', 'Poor NPC');
    engine.ensureNeeds('poor-npc');
    engine.addHouseholdMember('poor', 'poor-npc');

    setHouseholdDestitution(engine.db, 'poor', 0);
    applyHouseholdMigrationWeeklyCadence(engine.db, engine.bus, 7 * MINUTES_PER_DAY, () => 0.99); // only 7 days

    expect(engine.getHousehold('poor')?.departedAtTick).toBeNull();

    engine.dispose();
  });

  // §11.4 push "hunger": a household that has mostly gone without (the
  // hunger tally, +1 per hungry day / -1 per fed day) leaves even with coin
  // in its purse — unless it owns a business that's still open.
  it('emigrates a long-hungry household even with coin, but not one that owns an open business', async () => {
    const SQL = await loadSqlJs();
    const engine = Engine.bootstrap(createDatabase(SQL), { seed: 'migration-hunger' });
    engine.createSite({ id: 'mill', name: 'Mill', kind: 'mill', x: 0, y: 0 });
    for (const id of ['hungry', 'owner']) {
      engine.createHousehold({ id, name: `The ${id} Household`, homeSiteId: 'mill' });
      engine.createEntity(`${id}-npc`, id);
      engine.ensureNeeds(`${id}-npc`);
      engine.addHouseholdMember(id, `${id}-npc`);
      engine.faucetCoin(id, 200, 'savings');
      engine.db.run('UPDATE households SET hunger_days = 45 WHERE id = ?', [id]);
    }
    engine.createCompany({ id: 'mill-co', name: 'Mill Co', kind: 'mill', siteId: 'mill' });
    engine.setCompanyOwner('mill-co', 'owner-npc');

    applyHouseholdMigrationWeeklyCadence(engine.db, engine.bus, 7 * MINUTES_PER_DAY, () => 0.99);

    expect(engine.getHousehold('hungry')?.departedAtTick).toBe(7 * MINUTES_PER_DAY);
    expect(engine.getHousehold('owner')?.departedAtTick).toBeNull();
    const event = engine.queryLog('settlement', 50).find((e) => e.type === 'household.migration.emigrated');
    expect(event?.data?.reason).toBe('hunger');
    engine.dispose();
  });

  it('does not touch a household that was never destitute', async () => {
    const SQL = await loadSqlJs();
    const db = createDatabase(SQL);
    const engine = Engine.bootstrap(db, { seed: 'migration-comfortable' });
    engine.createHousehold({ id: 'comfortable', name: 'The Comfortable Household', homeSiteId: 'tavern' });
    engine.createEntity('comfortable-npc', 'Comfortable NPC');
    engine.ensureNeeds('comfortable-npc');
    engine.addHouseholdMember('comfortable', 'comfortable-npc');
    engine.faucetCoin('comfortable', 500, 'well off');

    applyHouseholdMigrationWeeklyCadence(engine.db, engine.bus, 100 * MINUTES_PER_DAY, () => 0.99);

    expect(engine.getHousehold('comfortable')?.departedAtTick).toBeNull();

    engine.dispose();
  });

  it('immigrates a new household when a job opening sits unfilled and the roll favors it (§11.4 "pull")', async () => {
    const SQL = await loadSqlJs();
    const db = createDatabase(SQL);
    const engine = Engine.bootstrap(db, { seed: 'migration-immigrate' });
    engine.createSite({ id: 'farm', name: 'Farm', kind: 'farm', x: 0, y: 0 });
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

    // §11.4 pull needs food as well as work: bread on sale at a sane price.
    engine.createSite({ id: 'market', name: 'Market', kind: 'market', x: 0, y: 0 });
    engine.seedMarketListing('market', 'bread', getGoodDefinition('bread').basePrice, 50);

    expect(engine.listHouseholds().length).toBe(0);
    applyHouseholdMigrationWeeklyCadence(engine.db, engine.bus, 100 * MINUTES_PER_DAY, () => 0); // rng()=0 always beats the chance threshold

    const households = engine.listHouseholds();
    expect(households.length).toBe(1);
    const arrived = households[0];
    expect(arrived).toBeDefined();
    expect(engine.listHouseholdMembers(arrived!.id).length).toBeGreaterThan(0);
    expect(engine.getBalance(arrived!.id)).toBeGreaterThan(0); // arrived with travel savings

    const log = engine.queryLog('settlement', 100);
    expect(log.some((e) => e.type === 'household.migration.arrived')).toBe(true);

    // The new household arrives unemployed — this cadence doesn't hire it
    // directly, the next weekly job-seeking pass does.
    expect(engine.listHouseholdMembers(arrived!.id).every((id) => engine.getEmployment(id) === null)).toBe(
      true,
    );

    engine.dispose();
  });

  it('does not immigrate into a famine, however many jobs are open', async () => {
    const SQL = await loadSqlJs();
    const engine = Engine.bootstrap(createDatabase(SQL), { seed: 'migration-famine' });
    engine.createSite({ id: 'farm', name: 'Farm', kind: 'farm', x: 0, y: 0 });
    engine.createCompany({ id: 'farm-co', name: 'Farm Co', kind: 'farm', siteId: 'farm' });
    engine.createJobSlot({
      id: 'farm-job',
      companyId: 'farm-co',
      title: 'Farmhand',
      skill: 'farming',
      wageMin: 1,
      wageMax: 2,
      shiftDurationTicks: 60,
      capacity: 3,
    });
    engine.createSite({ id: 'market', name: 'Market', kind: 'market', x: 0, y: 0 });
    engine.seedMarketListing('market', 'bread', getGoodDefinition('bread').basePrice, 0); // empty shelves

    applyHouseholdMigrationWeeklyCadence(engine.db, engine.bus, 100 * MINUTES_PER_DAY, () => 0);
    expect(engine.listHouseholds().length).toBe(0);
    engine.dispose();
  });

  it('does not immigrate when there are no unfilled job openings', async () => {
    const SQL = await loadSqlJs();
    const db = createDatabase(SQL);
    const engine = Engine.bootstrap(db, { seed: 'migration-no-vacancy' });

    const before = engine.listHouseholds().length;
    applyHouseholdMigrationWeeklyCadence(engine.db, engine.bus, 100 * MINUTES_PER_DAY, () => 0);

    expect(engine.listHouseholds().length).toBe(before);

    engine.dispose();
  });
});

describe('NPC shifts and the parish (§9.8, §8.2)', () => {
  async function farmWithWorker(seed: string, withTool: boolean) {
    const engine = Engine.bootstrap(createDatabase(await loadSqlJs()), { seed });
    engine.createSite({ id: 'farm', name: 'Farm', kind: 'farm', x: 0, y: 0 });
    engine.createCompany({ id: 'farm-co', name: 'Farm Co', kind: 'farm', siteId: 'farm' });
    engine.createJobSlot({
      id: 'farm-job',
      companyId: 'farm-co',
      title: 'Farmhand',
      skill: 'farming',
      wageMin: 20,
      wageMax: 20,
      shiftDurationTicks: 360,
      toolGoodType: 'hoe',
      capacity: 1,
    });
    if (withTool) engine.produceItem({ id: 'hoe-1', type: 'hoe', containerId: 'farm-co', durability: 3000 });
    engine.faucetCoin('farm-co', 1000, 'capital');
    engine.createHousehold({ id: 'house', name: 'The House', homeSiteId: 'farm' });
    engine.createEntity('worker', 'Worker');
    engine.addHouseholdMember('house', 'worker');
    engine.applyForJob('worker', 'farm-job', { haggle: false, scope: 'settlement' });
    return engine;
  }

  it("an NPC shift pays the household, wears the company's tool, and produces by skill roll — same rules as the player", async () => {
    const engine = await farmWithWorker('npc-shift', true);
    applyNpcLaborDailyCadence(engine.db, engine.bus, MINUTES_PER_DAY, () => 0); // day 1: a workday; roll 0 succeeds

    expect(engine.getBalance('house')).toBe(20); // to the household purse, not the worker's own wallet
    expect(engine.getBalance('worker')).toBe(0);
    expect(engine.getCompanyLedgerSummary('farm-co', 0).wages).toBe(20);
    expect(Number(queryRow(engine.db, "SELECT durability FROM items WHERE id = 'hoe-1'")?.[0])).toBe(
      3000 - TOOL_WEAR_PER_SHIFT,
    );
    expect(engine.getSkillXp('worker', 'farming')).toBe(SHIFT_XP);
    expect(countActiveItemsOfType(engine.db, 'farm-co', 'grain')).toBe(
      getRecipeForSkill('farming')!.outputPerShiftSuccess,
    );
    engine.dispose();
  });

  it('no tool, no shift: no wage, no output, no XP', async () => {
    const engine = await farmWithWorker('npc-shift-no-tool', false);
    applyNpcLaborDailyCadence(engine.db, engine.bus, MINUTES_PER_DAY, () => 0);
    expect(engine.getBalance('house')).toBe(0);
    expect(countActiveItemsOfType(engine.db, 'farm-co', 'grain')).toBe(0);
    expect(engine.getSkillXp('worker', 'farming')).toBe(0);
    engine.dispose();
  });

  it('rests on the seventh day', async () => {
    const engine = await farmWithWorker('npc-shift-rest', true);
    applyNpcLaborDailyCadence(engine.db, engine.bus, 7 * MINUTES_PER_DAY, () => 0);
    expect(engine.getBalance('house')).toBe(0);
    engine.dispose();
  });

  it('does not pay the player through the NPC cadence (the player works real shifts)', async () => {
    const engine = await farmWithWorker('npc-shift-player', true);
    engine.createEntity('player', 'You');
    engine.db.run("UPDATE job_slots SET capacity = 2 WHERE id = 'farm-job'");
    engine.applyForJob('player', 'farm-job', { haggle: false });
    applyNpcLaborDailyCadence(engine.db, engine.bus, MINUTES_PER_DAY, () => 0);
    expect(engine.getBalance('player')).toBe(0);
    expect(engine.getBalance('house')).toBe(20);
    engine.dispose();
  });

  it('the parish collects tithes from comfortable households and pays alms only from what it holds', async () => {
    const engine = Engine.bootstrap(createDatabase(await loadSqlJs()), { seed: 'parish' });
    engine.createSite({ id: 'market', name: 'Market', kind: 'market', x: 0, y: 0 });
    engine.seedMarketListing('market', 'bread', 10, 100);
    engine.createHousehold({ id: 'rich', name: 'The Rich Household', homeSiteId: 'market' });
    engine.faucetCoin('rich', 1300, 'wealth');
    engine.createHousehold({ id: 'poor', name: 'The Poor Household', homeSiteId: 'market' });
    for (const id of ['poor-a', 'poor-b']) {
      engine.createEntity(id, id);
      engine.ensureNeeds(id);
      engine.addHouseholdMember('poor', id);
    }

    // No parish fund yet: no alms appear from nowhere.
    applyHouseholdDailyCadence(engine.db, engine.bus, MINUTES_PER_DAY, false);
    expect(engine.getBalance('poor')).toBe(0);
    expect(engine.getBalance(PARISH_ID)).toBe(0);

    applyParishTitheWeeklyCadence(engine.db, engine.bus, 7 * MINUTES_PER_DAY);
    expect(engine.getBalance(PARISH_ID)).toBe(100); // 10% of (1300 - 300)
    expect(engine.getBalance('rich')).toBe(1200);

    // Now there's a fund: alms of a loaf a head at today's price (2 × 10),
    // never less than the basic stipend (25).
    applyHouseholdDailyCadence(engine.db, engine.bus, 8 * MINUTES_PER_DAY, false);
    expect(engine.getBalance(PARISH_ID)).toBe(100 - 25);
    expect(engine.runConservationAudit().passed).toBe(true);
    engine.dispose();
  });
});
