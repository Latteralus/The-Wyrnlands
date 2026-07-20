import { describe, expect, it } from 'vitest';
import { checkpointEngine } from '../checkpoint';
import { createDatabase } from '../db/sqlite';
import { loadFreshSqlJs, loadSqlJs } from '../db/sqlite.node';
import { Engine } from '../engine';
import { findFirstActiveItem } from '../inventory/items';
import { listActiveEmploymentsForSlot } from '../jobs/jobs';
import {
  COMPANY_OWNER_HOUSEHOLD_COUNT,
  FARM_JOB_SLOT_ID,
  LOGGING_JOB_SLOT_ID,
  NPC_HOUSEHOLD_COUNT,
  PLAYER_ID,
  REST_BUNK_PRICE,
  seedDemoWorld,
} from '../seed/demoWorld';
import { MINUTES_PER_DAY } from '../time/clock';

const SEASON_SEED = 'stage4-season';

// Stage 4 exit test (MASTERPLAN.md §Stage 4): "headless 90-day run — no
// baseline starvation, consumption traceable, 16x performance; scripted job
// loss produces the logged adaptation cascade."
//
// This now runs the literal 90 days, not a reduced stand-in. The sql.js/WASM
// memory ceiling that forced Stage 2 (30→12 days) and, briefly, this same
// Stage 4 test (90→20 days) to ship reduced is fixed at the root: a WASM
// module's linear memory only grows and is never reclaimed, and
// db/sqlite.{node,browser}.ts's loadSqlJs() memoizes initSqlJs(), so every
// Database for the life of the process shared one ever-more-fragmented
// heap. checkpointEngine() (src/engine/checkpoint.ts) periodically exports
// the world, disposes the old Engine, and rehydrates a fresh one inside a
// genuinely new WASM module instance — resuming the RNG from its saved
// state (world_meta.rng_state, engine.ts's constructor) so determinism
// survives the boundary, proven separately in checkpoint.test.ts (byte-for-
// byte-equivalent logical state, checkpointed vs. uninterrupted, including
// with multiple checkpoints in one run). See DECISIONS.md for the full
// account of how this was diagnosed and fixed.
//
// "No baseline starvation" is close to true by construction here: a
// household's daily cadence always sets a fed member's hunger to 100 and an
// unfed member's to a 35 subsistence floor (§8.2 "common land gathering") —
// it never lets decay run to 0 unchecked the way the player's per-tick path
// can. The real thing this suite verifies is that the *mechanism* producing
// that floor is genuinely running for the whole population over the whole
// run, not that the number 35 is hardcoded past the assertions.
describe('Stage 4 — Living NPCs & Households scenarios', () => {
  it('generates ~40 NPCs into households, with some employed at each company', async () => {
    const SQL = await loadSqlJs();
    const db = createDatabase(SQL);
    const engine = Engine.bootstrap(db, { seed: 'stage4-population' });
    seedDemoWorld(engine);

    // §Stage 5 added one single-person household per company owner-operator
    // (farm, logging, mill, bakery) alongside the generated NPC households.
    const households = engine.listHouseholds();
    expect(households.length).toBe(NPC_HOUSEHOLD_COUNT + COMPANY_OWNER_HOUSEHOLD_COUNT);

    const allMembers = households.flatMap((h) => engine.listHouseholdMembers(h.id));
    expect(allMembers.length).toBeGreaterThanOrEqual(30 + COMPANY_OWNER_HOUSEHOLD_COUNT);
    expect(allMembers.length).toBeLessThanOrEqual(60 + COMPANY_OWNER_HOUSEHOLD_COUNT);

    // Every member is a real entity with real needs, not just an id.
    for (const entityId of allMembers.slice(0, 5)) {
      expect(engine.getEntity(entityId)?.name).toBeTruthy();
      expect(engine.getNeeds(entityId)).not.toBeNull();
    }

    expect(listActiveEmploymentsForSlot(engine.db, FARM_JOB_SLOT_ID).length).toBeGreaterThan(0);
    expect(listActiveEmploymentsForSlot(engine.db, LOGGING_JOB_SLOT_ID).length).toBeGreaterThan(0);

    engine.dispose();
  });

  it('presence rosters place employed NPCs at their workplace during the day and at home at night', async () => {
    const SQL = await loadSqlJs();
    const db = createDatabase(SQL);
    const engine = Engine.bootstrap(db, { seed: 'stage4-presence' });
    seedDemoWorld(engine);

    // Land on a daytime hour (§Stage4: employed NPCs are at work 6:00-18:00).
    const ticksToNoon = MINUTES_PER_DAY / 2 - engine.calendar.minuteOfDay;
    if (ticksToNoon > 0) engine.advanceTicks(ticksToNoon);
    expect(engine.calendar.minuteOfDay).toBe(MINUTES_PER_DAY / 2);

    const atFarm = engine.listPresentEntities('farm');
    expect(atFarm.length).toBeGreaterThan(0);

    engine.dispose();
  });

  it('a full 90-day run: no baseline starvation, consumption is traceable, and it runs fast enough for real play', async () => {
    const SQL = await loadSqlJs();
    const db = createDatabase(SQL);
    let engine = Engine.bootstrap(db, { seed: SEASON_SEED });
    seedDemoWorld(engine);

    const SIMULATED_TICKS = 90 * MINUTES_PER_DAY;
    // Well under the ~20-25 day range observed to crash without
    // checkpointing (see the file header) — real margin, not a hair's-
    // breadth fit, since Stage 5's eventual world will be heavier still.
    // Each checkpoint recompiles the wasm binary from scratch (real, non-
    // trivial wall-clock cost — see checkpoint.ts), so this is deliberately
    // as large an interval as still leaves that margin, not as small as
    // possible.
    const CHECKPOINT_INTERVAL_TICKS = 15 * MINUTES_PER_DAY;
    let lastCheckpointTick = 0;
    const start = Date.now();

    // The player just survives alongside the NPC population — Stage 2/3's
    // scripted-worker loop, unchanged in shape. NPCs need no scripting at
    // all: they're entirely driven by Engine's own daily/weekly cadence.
    let safetyIterations = 0;
    while (engine.tick < SIMULATED_TICKS) {
      safetyIterations++;
      if (safetyIterations > 200_000) {
        throw new Error('Scripted player loop exceeded its safety iteration cap — likely stuck.');
      }

      const busy = engine.getCurrentAction(PLAYER_ID);
      if (busy?.status === 'in_progress') {
        const remaining = (busy.endsAtTick ?? engine.tick + 1) - engine.tick;
        engine.advanceTicks(Math.max(1, remaining));
        continue;
      }

      if (engine.tick - lastCheckpointTick >= CHECKPOINT_INTERVAL_TICKS) {
        engine = await checkpointEngine(engine, { seed: SEASON_SEED, loadFreshSqlJs });
        seedDemoWorld(engine); // re-registers action types — see checkpoint.ts's header comment
        lastCheckpointTick = engine.tick;
        continue;
      }

      const needs = engine.getNeeds(PLAYER_ID)!;
      const balance = engine.getBalance(PLAYER_ID);
      const wornFeet = engine.getWornGear(PLAYER_ID).find((g) => g.slot === 'feet');
      const employed = engine.getEmployment(PLAYER_ID) !== null;

      let queuedType: string;
      if (needs.thirst < 60) {
        queuedType = 'draw_water';
      } else if (needs.hunger < 60 && findFirstActiveItem(engine.db, PLAYER_ID, 'bread')) {
        queuedType = 'eat';
      } else if (needs.hunger < 60 && balance >= 2) {
        queuedType = 'buy_bread';
      } else if (needs.energy < 60) {
        queuedType = balance >= REST_BUNK_PRICE ? 'rest_bunk' : 'rest_rough';
      } else if (!wornFeet && balance >= 15) {
        queuedType = 'buy_shoes';
      } else if (!employed) {
        queuedType = 'read_notices'; // flavor; the player just subsists this run, no job needed for the assertions below
      } else if (needs.thirst >= 75 && needs.hunger >= 75 && needs.energy >= 75) {
        queuedType = `work_shift_${FARM_JOB_SLOT_ID}`;
      } else {
        queuedType = 'rest_rough';
      }

      engine.queueAction(PLAYER_ID, queuedType);
      engine.advanceTicks(1);
    }

    const elapsedMs = Date.now() - start;
    // Not a literal "16x screen speed" measurement (that's a browser/UI
    // concern) — this is the headless equivalent: a full 90-day, ~40-NPC
    // run (plus several checkpoints, each a real wasm recompile) must
    // complete in a few minutes, not hang or grind indefinitely. Generous on
    // purpose — a regression guard, not a tuned performance budget.
    expect(elapsedMs).toBeLessThan(300_000);

    // No baseline starvation, across the whole population, not just the
    // player.
    const playerNeeds = engine.getNeeds(PLAYER_ID)!;
    expect(playerNeeds.hunger).toBeGreaterThan(0);
    expect(playerNeeds.thirst).toBeGreaterThan(0);

    const households = engine.listHouseholds();
    let checkedMembers = 0;
    for (const household of households) {
      for (const entityId of engine.listHouseholdMembers(household.id)) {
        const npcNeeds = engine.getNeeds(entityId)!;
        expect(npcNeeds.hunger).toBeGreaterThan(0);
        expect(npcNeeds.thirst).toBeGreaterThan(0);
        checkedMembers++;
      }
    }
    expect(checkedMembers).toBeGreaterThanOrEqual(30);

    // Consumption traceable: spot-check a household's eaten bread has a
    // full produced → consumed provenance chain, same standard as the
    // player's own consumption (§Stage 2/3).
    const consumedBreadEvents = engine
      .queryLog('business', 5000)
      .filter((e) => e.type === 'item.consumed' && (e.data?.type as string | undefined) === 'bread');
    expect(consumedBreadEvents.length).toBeGreaterThan(0);
    for (const event of consumedBreadEvents.slice(0, 10)) {
      const itemId = event.data?.itemId as string | undefined;
      expect(itemId).toBeTruthy();
      const chain = engine.getProvenanceChain(itemId!);
      expect(chain.map((e) => e.eventType)).toEqual(['produced', 'consumed']);
    }

    // Conservation held throughout, at population scale — no drift, no
    // silent bugs (§16's "drift = bug, caught same day").
    expect(engine.queryLog('world', 10_000).some((e) => e.type === 'audit.failed')).toBe(false);
    expect(engine.runConservationAudit().passed).toBe(true);

    engine.dispose();
  }, 360_000);

  it('a scripted job loss produces the logged adaptation cascade (§10)', async () => {
    const SQL = await loadSqlJs();
    const db = createDatabase(SQL);
    const engine = Engine.bootstrap(db, { seed: 'stage4-job-loss' });
    seedDemoWorld(engine);

    const employment = listActiveEmploymentsForSlot(engine.db, FARM_JOB_SLOT_ID)[0];
    expect(employment).toBeDefined();
    const npcId = employment!.entityId;
    const householdId = engine.getHouseholdIdForMember(npcId);
    expect(householdId).not.toBeNull();

    // Force the household into real strain immediately, rather than waiting
    // out however many organic days it would take reserves to drain — the
    // cascade mechanics are the same either way, this just makes the test
    // fast and deterministic. Every earning member is let go, not just the
    // one this test is nominally "about" — a household with a second income
    // untouched wouldn't show any strain at all, which would make this a
    // test of the wrong thing.
    const members = engine.listHouseholdMembers(householdId!);
    for (const memberId of members) {
      if (engine.getEmployment(memberId)) {
        engine.quitJob(memberId, {
          scope: 'settlement',
          message: `${engine.getEntity(memberId)?.name} is let go as the season turns.`,
        });
      }
    }
    expect(engine.getEmployment(npcId)).toBeNull();

    const currentBalance = engine.getBalance(householdId!);
    if (currentBalance > 2) {
      engine.sinkCoin(householdId!, currentBalance - 2, 'Test setup: draining reserves.', 'business');
    }

    const dismissalLogged = engine
      .queryLog('settlement', 500)
      .some((e) => e.type === 'job.quit' && e.actorId === npcId);
    expect(dismissalLogged).toBe(true);

    // Advance a week of daily cadence — with no income and reserves already
    // drained, the household's adaptation ladder (§10) should fire and log
    // at least one hardship rung.
    engine.advanceTicks(7 * MINUTES_PER_DAY);

    const HARDSHIP_TYPES = [
      'household.hardship.reduced_food',
      'household.hardship.sold_belongings',
      'household.hardship.charity',
    ];
    const settlementLog = engine.queryLog('settlement', 2000);
    const hardshipEvents = settlementLog.filter(
      (e) => e.actorId === householdId && HARDSHIP_TYPES.includes(e.type),
    );
    expect(hardshipEvents.length).toBeGreaterThan(0);

    engine.dispose();
  });
});
