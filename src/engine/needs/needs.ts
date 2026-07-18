import { cancelQueuedActions, enqueueAction, interruptCurrentAction } from '../actions/actionQueue';
import { queryRow } from '../db/sqlite';
import type { ActionRegistry } from '../actions/registry';
import type { EventBus } from '../eventBus';
import type { Database } from 'sql.js';

export type NeedKey = 'hunger' | 'thirst' | 'energy' | 'warmth';
export const NEED_KEYS: readonly NeedKey[] = ['hunger', 'thirst', 'energy', 'warmth'];

export interface Needs {
  entityId: string;
  hunger: number;
  thirst: number;
  energy: number;
  warmth: number;
  updatedAtTick: number;
}

// Placeholder pacing (§6, §Stage 2), flagged like every other unbalanced
// constant so far — revisit with the balance harness (§17). Chosen so an
// idle actor with no water hits collapse well within a single in-game day.
const DECAY_PER_TICK: Record<NeedKey, number> = {
  hunger: 100 / 1200, // ~20h to empty
  thirst: 100 / 600, // ~10h to empty — fastest, as §6 specifies
  energy: 100 / 1080, // ~18h awake to empty
  warmth: 100 / 480, // ~8h exposed to empty
};

const COLLAPSE_RECOVERY_ACTION = 'collapse_recovery';
const COLLAPSE_RECOVERY_DURATION_TICKS = 240; // 4 in-game hours
const COLLAPSE_RECOVERY_RESTORE = 50;

function rowToNeeds(row: unknown[]): Needs {
  return {
    entityId: String(row[0]),
    hunger: Number(row[1]),
    thirst: Number(row[2]),
    energy: Number(row[3]),
    warmth: Number(row[4]),
    updatedAtTick: Number(row[5]),
  };
}

const NEEDS_COLUMNS = 'entity_id, hunger, thirst, energy, warmth, updated_at_tick';

export function ensureNeeds(db: Database, entityId: string, tick: number): void {
  db.run('INSERT OR IGNORE INTO needs (entity_id, updated_at_tick) VALUES (?, ?)', [entityId, tick]);
}

export function getNeeds(db: Database, entityId: string): Needs | null {
  const row = queryRow(db, `SELECT ${NEEDS_COLUMNS} FROM needs WHERE entity_id = ?`, [entityId]);
  return row ? rowToNeeds(row) : null;
}

export function clamp(value: number): number {
  return Math.max(0, Math.min(100, value));
}

// A commit (buying a meal, resting) restores toward full — the opposite of
// decay. Used both by action applyOutcome hooks and, later, by any UI
// pre-commit projection that wants to preview the result.
export function restoreNeed(
  db: Database,
  bus: EventBus,
  entityId: string,
  need: NeedKey,
  amount: number,
  tick: number,
  note?: string,
): void {
  const needs = getNeeds(db, entityId);
  if (!needs) throw new Error(`Unknown needs row for entity: "${entityId}"`);
  const next = clamp(needs[need] + amount);
  db.run(`UPDATE needs SET ${need} = ?, updated_at_tick = ? WHERE entity_id = ?`, [next, tick, entityId]);
  bus.emit({
    tick,
    scope: 'personal',
    actorId: entityId,
    type: 'need.restored',
    message: note ?? `${entityId}'s ${need} improved.`,
    data: { need, amount, value: next },
  });
}

function triggerCollapse(
  db: Database,
  bus: EventBus,
  registry: ActionRegistry,
  entityId: string,
  need: NeedKey,
  tick: number,
): void {
  interruptCurrentAction(db, bus, entityId, tick);
  cancelQueuedActions(db, bus, entityId, tick);
  bus.emit({
    tick,
    scope: 'personal',
    actorId: entityId,
    type: 'need.collapsed',
    message: `${entityId} collapses from ${need} and is cared for until able to stand again.`,
    data: { need },
  });
  enqueueAction(db, registry, entityId, COLLAPSE_RECOVERY_ACTION, tick);
}

// The per-tick needs cadence (§4.2): decays every need, then checks for
// collapse. Skips decay entirely while the actor is already in recovery, so
// a collapse doesn't just immediately re-trigger itself.
//
// Reads needs + the collapse-recovery check as one combined query rather
// than getNeeds() + getCurrentAction() separately — this runs every single
// tick for every foreground (non-NPC) entity, so the extra round trip isn't
// free at scale: a 90-day (129,600-tick) run's per-tick cost here was a
// real, measured contributor to sql.js's WASM heap exhausting itself before
// Stage 4's exit test could complete (see population/cadence.ts's header
// comment and DECISIONS.md's Stage 4 entry for the fuller account — this
// and actionQueue.ts's removed per-tick progress_ticks write were the two
// fixes that got a 90-day, ~40-NPC run to actually finish).
export function tickNeeds(
  db: Database,
  bus: EventBus,
  registry: ActionRegistry,
  entityId: string,
  tick: number,
  context: { exposedToCold: boolean },
): void {
  const row = queryRow(
    db,
    `SELECT ${NEEDS_COLUMNS},
       EXISTS(
         SELECT 1 FROM actions
         WHERE actor_id = needs.entity_id AND status = 'in_progress' AND type = ?
       ) AS in_recovery
     FROM needs WHERE entity_id = ?`,
    [COLLAPSE_RECOVERY_ACTION, entityId],
  );
  if (!row) return;
  const needs = rowToNeeds(row);
  if (Number(row[6]) === 1) return;

  const next: Record<NeedKey, number> = {
    hunger: clamp(needs.hunger - DECAY_PER_TICK.hunger),
    thirst: clamp(needs.thirst - DECAY_PER_TICK.thirst),
    energy: clamp(needs.energy - DECAY_PER_TICK.energy),
    warmth: context.exposedToCold ? clamp(needs.warmth - DECAY_PER_TICK.warmth) : clamp(needs.warmth + 1),
  };

  db.run(
    'UPDATE needs SET hunger = ?, thirst = ?, energy = ?, warmth = ?, updated_at_tick = ? WHERE entity_id = ?',
    [next.hunger, next.thirst, next.energy, next.warmth, tick, entityId],
  );

  const depleted = NEED_KEYS.find((key) => next[key] <= 0);
  if (depleted) {
    triggerCollapse(db, bus, registry, entityId, depleted, tick);
  }
}

// Core survival mechanic, not world content — always available regardless
// of what a seed script registers, same spirit as the automatic nightly
// audit (§4.2).
export function registerCollapseRecoveryAction(registry: ActionRegistry): void {
  registry.register({
    type: COLLAPSE_RECOVERY_ACTION,
    durationTicks: COLLAPSE_RECOVERY_DURATION_TICKS,
    resolve: () => ({ success: true, message: 'You come around, weak but alive.' }),
    applyOutcome: (ctx) => {
      for (const need of NEED_KEYS) {
        restoreNeed(ctx.db, ctx.bus, ctx.actorId, need, COLLAPSE_RECOVERY_RESTORE, ctx.tick);
      }
    },
  });
}
