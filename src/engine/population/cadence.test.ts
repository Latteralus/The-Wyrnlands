import { describe, expect, it } from 'vitest';
import { createDatabase } from '../db/sqlite';
import { loadSqlJs } from '../db/sqlite.node';
import { Engine } from '../engine';
import { applyNpcJobSeekingWeeklyCadence } from './cadence';

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
