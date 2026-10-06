import { describe, expect, it } from 'vitest';
import { checkpointEngine } from '../checkpoint';
import { createDatabase } from '../db/sqlite';
import { loadFreshSqlJs, loadSqlJs } from '../db/sqlite.node';
import { Engine } from '../engine';
import { findFirstActiveItem } from '../inventory/items';
import { FARM_JOB_SLOT_ID, PLAYER_ID, REST_BUNK_PRICE, seedDemoWorld } from '../seed/demoWorld';
import { MINUTES_PER_DAY } from '../time/clock';

// NOT part of the routine test suite (describe.skip) — remove `.skip` to
// run it manually. The fuller tool is `npm run sim:perf` (perf/longRun.ts),
// which runs the same world and scripted player with per-interval timing,
// row counts, profiling, an economy report and a determinism fingerprint.
//
// History: this originally targeted 730 days and timed out at day 301 after
// 30 minutes (2026-07-18), then was cut to 300 days. Root-caused 2026-10-06
// (PERFORMANCE_AUDIT.md) — a full-history scan per tick plus sql.js's
// db.exec() stack leak. The full 730 days now completes in ~2.5 minutes in
// a single WASM module; this checkpointed version remains as a manual
// check that the checkpoint facility also survives a 2-year run.
describe.skip('SPIKE — pushing well past the 90-day exit test, checkpointed', () => {
  it(
    'a 730-day run with periodic checkpointing completes without crashing',
    async () => {
      const SQL = await loadSqlJs();
      const db = createDatabase(SQL);
      let engine = Engine.bootstrap(db, { seed: 'stage5-scale-stress' });
      seedDemoWorld(engine);

      const SIMULATED_TICKS = 730 * MINUTES_PER_DAY;
      const CHECKPOINT_INTERVAL_TICKS = 15 * MINUTES_PER_DAY;
      let lastCheckpointTick = 0;
      let checkpointCount = 0;
      const start = Date.now();

      let safetyIterations = 0;
      while (engine.tick < SIMULATED_TICKS) {
        safetyIterations++;
        if (safetyIterations > 1_500_000) {
          throw new Error('Scripted player loop exceeded its safety iteration cap — likely stuck.');
        }

        const busy = engine.getCurrentAction(PLAYER_ID);
        if (busy?.status === 'in_progress') {
          const remaining = (busy.endsAtTick ?? engine.tick + 1) - engine.tick;
          engine.advanceTicks(Math.max(1, remaining));
          continue;
        }

        if (engine.tick - lastCheckpointTick >= CHECKPOINT_INTERVAL_TICKS) {
          engine = await checkpointEngine(engine, { seed: 'stage5-scale-stress', loadFreshSqlJs });
          seedDemoWorld(engine);
          lastCheckpointTick = engine.tick;
          checkpointCount++;
          if (checkpointCount % 10 === 0) {
            console.log(
              `  ...checkpoint ${checkpointCount}, day ${Math.floor(engine.tick / MINUTES_PER_DAY)} OK`,
            );
          }
          continue;
        }

        const needs = engine.getNeeds(PLAYER_ID)!;
        const balance = engine.getBalance(PLAYER_ID);
        const wornFeet = engine.getWornGear(PLAYER_ID).find((g) => g.slot === 'feet');
        const employed = engine.getEmployment(PLAYER_ID) !== null;
        // §5.4's rolled price level means bread/shoes no longer always cost
        // their catalog base price — read the real listing price rather
        // than hardcoding one.
        const breadPrice = engine.getMarketListing('market', 'bread')?.price ?? 2;
        const shoesPrice = engine.getMarketListing('market', 'shoes')?.price ?? 15;

        let queuedType: string;
        if (needs.thirst < 60) {
          queuedType = 'draw_water';
        } else if (needs.hunger < 60 && findFirstActiveItem(engine.db, PLAYER_ID, 'bread')) {
          queuedType = 'eat';
        } else if (needs.hunger < 60 && balance >= breadPrice) {
          queuedType = 'buy_bread';
        } else if (needs.energy < 60 || needs.warmth < 60) {
          // §5.4's rolled starting season can now genuinely be winter — a
          // bunk rest restores warmth as well as energy (demoWorld.ts's
          // rest_bunk), so this is also this script's cold-weather response.
          queuedType = balance >= REST_BUNK_PRICE ? 'rest_bunk' : 'rest_rough';
        } else if (!wornFeet && balance >= shoesPrice) {
          queuedType = 'buy_shoes';
        } else if (!employed) {
          queuedType = 'read_notices';
        } else if (needs.thirst >= 75 && needs.hunger >= 75 && needs.energy >= 75) {
          queuedType = `work_shift_${FARM_JOB_SLOT_ID}`;
        } else {
          queuedType = 'rest_rough';
        }

        engine.queueAction(PLAYER_ID, queuedType);
        engine.advanceTicks(1);
      }

      const elapsedMs = Date.now() - start;
      console.log(`730-day checkpointed run: ${checkpointCount} checkpoints, ${elapsedMs}ms wall-clock.`);

      expect(engine.tick).toBeGreaterThanOrEqual(SIMULATED_TICKS);
      expect(engine.queryLog('world', 10_000).some((e) => e.type === 'audit.failed')).toBe(false);
      expect(engine.runConservationAudit().passed).toBe(true);

      engine.dispose();
    },
    25 * 60 * 1000,
  );
});
