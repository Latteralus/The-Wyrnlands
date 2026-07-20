import { describe, expect, it } from 'vitest';
import { createDatabase } from '../db/sqlite';
import { loadSqlJs } from '../db/sqlite.node';
import { Engine } from '../engine';
import { countActiveEmploymentsForSlot } from '../jobs/jobs';
import {
  BAKERY_JOB_SLOT_ID,
  FARM_JOB_SLOT_ID,
  LOGGING_JOB_SLOT_ID,
  MILL_JOB_SLOT_ID,
  seedDemoWorld,
} from './demoWorld';

interface ScenarioRoll {
  startSeason: string;
  priceLevel: number;
  harvestQuality: number;
  failedCompany: string | null;
}

async function newSeededWorld(seed: string) {
  const SQL = await loadSqlJs();
  const db = createDatabase(SQL);
  const engine = Engine.bootstrap(db, { seed });
  seedDemoWorld(engine);
  return engine;
}

// §5.4 "Starting Conditions Are Rolled": verifies the roll actually happens,
// is deterministic per seed, and is applied for real (calendar, prices,
// company status) — not just recorded and ignored.
describe('rolled starting conditions (§5.4)', () => {
  it('records a scenario roll with a plausible value in every field', async () => {
    const engine = await newSeededWorld('rolled-conditions-schema');
    const roll = JSON.parse(engine.getScenarioRoll() ?? '{}') as ScenarioRoll;

    expect(['spring', 'summer', 'autumn', 'winter']).toContain(roll.startSeason);
    expect(roll.priceLevel).toBeGreaterThanOrEqual(0.85);
    expect(roll.priceLevel).toBeLessThan(1.25);
    expect(roll.harvestQuality).toBeGreaterThanOrEqual(0);
    expect(roll.harvestQuality).toBeLessThan(1);

    engine.dispose();
  });

  it('is deterministic: the same seed rolls the same scenario every time', async () => {
    const a = await newSeededWorld('rolled-conditions-determinism');
    const b = await newSeededWorld('rolled-conditions-determinism');

    expect(a.getScenarioRoll()).toBe(b.getScenarioRoll());
    expect(a.calendar).toEqual(b.calendar);

    a.dispose();
    b.dispose();
  });

  it('applies the rolled season to the actual calendar, not just the record', async () => {
    const engine = await newSeededWorld('rolled-conditions-calendar');
    const roll = JSON.parse(engine.getScenarioRoll() ?? '{}') as ScenarioRoll;

    expect(engine.calendar.season).toBe(roll.startSeason);
    expect(engine.calendar.day).toBe(1); // still day 1 of that season

    engine.dispose();
  });

  it('applies the rolled price level to starting market listings, not just bread', async () => {
    const engine = await newSeededWorld('rolled-conditions-prices');
    const roll = JSON.parse(engine.getScenarioRoll() ?? '{}') as ScenarioRoll;

    const bread = engine.getMarketListing('market', 'bread')!;
    const shoes = engine.getMarketListing('market', 'shoes')!;
    expect(bread.price).toBe(Math.max(1, Math.round(2 * roll.priceLevel)));
    expect(shoes.price).toBe(Math.max(1, Math.round(15 * roll.priceLevel)));

    engine.dispose();
  });

  // A real, verified value for this specific seed (not guessed) — confirmed
  // via a diagnostic run while investigating the winter-start regression
  // this same roll surfaced in the scripted scenario tests (see DECISIONS.md).
  it('a real known seed rolls winter and a failed Riverside Mill, and the closure is real', async () => {
    const engine = await newSeededWorld('stage2-survival');
    const roll = JSON.parse(engine.getScenarioRoll() ?? '{}') as ScenarioRoll;

    expect(roll.startSeason).toBe('winter');
    expect(roll.failedCompany).toBe('Riverside Mill');
    expect(engine.calendar.season).toBe('winter');

    // The closure is real, not just a label: no active employment, and the
    // mill's job slot no longer appears in the world's own job openings.
    expect(countActiveEmploymentsForSlot(engine.db, MILL_JOB_SLOT_ID)).toBe(0);
    expect(engine.listJobOpenings().some((slot) => slot.id === MILL_JOB_SLOT_ID)).toBe(false);
    // The other three companies are unaffected.
    expect(countActiveEmploymentsForSlot(engine.db, FARM_JOB_SLOT_ID)).toBeGreaterThan(0);
    expect(countActiveEmploymentsForSlot(engine.db, LOGGING_JOB_SLOT_ID)).toBeGreaterThan(0);
    expect(countActiveEmploymentsForSlot(engine.db, BAKERY_JOB_SLOT_ID)).toBeGreaterThan(0);

    engine.dispose();
  });
});
