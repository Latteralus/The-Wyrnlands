import { findFirstActiveItem } from '../inventory/items';
import { FARM_JOB_SLOT_ID, PLAYER_ID, REST_BUNK_PRICE } from '../seed/demoWorld';
import { MINUTES_PER_DAY } from '../time/clock';
import type { Engine } from '../engine';

// The scripted "player just survives alongside the NPC population" policy
// shared by the long-run scenarios (stage4.test.ts's 90-day exit test, the
// scale stress test, and perf/longRun.ts's performance harness). One copy,
// so a harness measurement and an exit test are measuring the same workload.
//
// Returns the action type to queue next for an idle player.
export function decideScriptedPlayerAction(engine: Engine): string {
  const needs = engine.getNeeds(PLAYER_ID);
  if (!needs) throw new Error('Scripted player has no needs row — was the world seeded?');
  const balance = engine.getBalance(PLAYER_ID);
  const wornFeet = engine.getWornGear(PLAYER_ID).find((g) => g.slot === 'feet');
  const employed = engine.getEmployment(PLAYER_ID) !== null;
  // §5.4's rolled price level means bread/shoes don't always cost their
  // catalog base price — read the real listing price.
  const breadPrice = engine.getMarketListing('market', 'bread')?.price ?? 2;
  const shoesPrice = engine.getMarketListing('market', 'shoes')?.price ?? 15;

  if (needs.thirst < 60) return 'draw_water';
  if (needs.hunger < 60 && findFirstActiveItem(engine.db, PLAYER_ID, 'bread')) return 'eat';
  if (needs.hunger < 60 && balance >= breadPrice) return 'buy_bread';
  // A bunk rest restores warmth as well as energy (demoWorld.ts's
  // rest_bunk), so this is also the script's cold-weather response.
  if (needs.energy < 60 || needs.warmth < 60) return balance >= REST_BUNK_PRICE ? 'rest_bunk' : 'rest_rough';
  if (!wornFeet && balance >= shoesPrice) return 'buy_shoes';
  if (!employed) return 'read_notices';
  if (needs.thirst >= 75 && needs.hunger >= 75 && needs.energy >= 75) return `work_shift_${FARM_JOB_SLOT_ID}`;
  return 'rest_rough';
}

// Drives the scripted player (or, with player: false, just the world) until
// `untilTick`. Skips straight to the end of an in-progress action rather
// than stepping tick by tick, exactly like the original scenario loops —
// stopping exactly at `untilTick` even mid-action (advanceTicks is just a
// loop of single ticks, so where a caller splits it changes nothing about
// the simulation itself).
//
// `commitDaily`: group everything into one transaction per in-game day, as
// the game's batches do, instead of each engine call committing on its own
// (a file-backed database pays per commit). Only the commits move: where
// the loop stops and decides is unchanged, so the world is identical.
export function runScriptedPlayerUntil(
  engine: Engine,
  untilTick: number,
  options: { player: boolean; commitDaily?: boolean },
): void {
  if (!options.player) {
    if (untilTick <= engine.tick) return;
    if (!options.commitDaily) {
      engine.advanceTicks(untilTick - engine.tick);
      return;
    }
    while (engine.tick < untilTick)
      engine.advanceTicks(
        Math.min(untilTick, (Math.floor(engine.tick / MINUTES_PER_DAY) + 1) * MINUTES_PER_DAY) - engine.tick,
      );
    return;
  }
  let day = Math.floor(engine.tick / MINUTES_PER_DAY);
  if (options.commitDaily) engine.db.run('SAVEPOINT scripted_day');
  try {
    runPlayerLoop(engine, untilTick, () => {
      if (!options.commitDaily || Math.floor(engine.tick / MINUTES_PER_DAY) === day) return;
      day = Math.floor(engine.tick / MINUTES_PER_DAY);
      engine.db.run('RELEASE scripted_day');
      engine.db.run('SAVEPOINT scripted_day');
    });
    if (options.commitDaily) engine.db.run('RELEASE scripted_day');
  } catch (error) {
    if (options.commitDaily) {
      engine.db.run('ROLLBACK TO scripted_day');
      engine.db.run('RELEASE scripted_day');
    }
    throw error;
  }
}

function runPlayerLoop(engine: Engine, untilTick: number, beforeStep: () => void): void {
  let safetyIterations = 0;
  while (engine.tick < untilTick) {
    beforeStep();
    if (++safetyIterations > 5_000_000) {
      throw new Error('Scripted player loop exceeded its safety iteration cap — likely stuck.');
    }
    const busy = engine.getCurrentAction(PLAYER_ID);
    if (busy?.status === 'in_progress') {
      const remaining = (busy.endsAtTick ?? engine.tick + 1) - engine.tick;
      engine.advanceTicks(Math.max(1, Math.min(remaining, untilTick - engine.tick)));
      continue;
    }
    engine.queueAction(PLAYER_ID, decideScriptedPlayerAction(engine));
    engine.advanceTicks(1);
  }
}
