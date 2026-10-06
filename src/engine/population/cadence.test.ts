import { describe, expect, it } from 'vitest';
import { createDatabase } from '../db/sqlite';
import { loadSqlJs } from '../db/sqlite.node';
import { Engine } from '../engine';
import { MINUTES_PER_DAY } from '../time/clock';
import { applyHouseholdMigrationWeeklyCadence, applyNpcJobSeekingWeeklyCadence } from './cadence';
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
    engine.faucetCoin('poor', 3, 'a few coppers left'); // below CHARITY_THRESHOLD(5), so it's actually sunk
    engine.produceItem({ id: 'poor-cloak', type: 'cloak', containerId: 'poor' });

    setHouseholdDestitution(engine.db, 'poor', 0);
    applyHouseholdMigrationWeeklyCadence(engine.db, engine.bus, 22 * MINUTES_PER_DAY, () => 0.99); // 22 days > 21-day grace period, no immigration roll

    const household = engine.getHousehold('poor');
    expect(household?.departedAtTick).toBe(22 * MINUTES_PER_DAY);
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
