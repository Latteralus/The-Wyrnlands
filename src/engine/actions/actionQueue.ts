import { queryRow, queryRows } from '../db/sqlite';
import { withOptional } from '../optional';
import type { EventBus } from '../eventBus';
import type { Rng } from '../rng';
import type { ActionRegistry } from './registry';
import type { ActionOutcome, ActionStatus, QueuedAction } from './types';
import type { Database } from 'sql.js';

const COLUMNS =
  'id, actor_id, type, status, queued_at_tick, started_at_tick, ends_at_tick, duration_ticks, progress_ticks, outcome, sequence';

function rowToAction(row: unknown[]): QueuedAction {
  return {
    id: Number(row[0]),
    actorId: String(row[1]),
    type: String(row[2]),
    status: row[3] as ActionStatus,
    queuedAtTick: Number(row[4]),
    startedAtTick: row[5] === null ? null : Number(row[5]),
    endsAtTick: row[6] === null ? null : Number(row[6]),
    durationTicks: Number(row[7]),
    progressTicks: Number(row[8]),
    outcome: typeof row[9] === 'string' ? (JSON.parse(row[9]) as ActionOutcome) : null,
    sequence: Number(row[10]),
  };
}

function getNextSequence(db: Database, actorId: string): number {
  const row = queryRow(db, 'SELECT COALESCE(MAX(sequence), -1) + 1 FROM actions WHERE actor_id = ?', [
    actorId,
  ]);
  return Number(row?.[0]);
}

export function getCurrentAction(db: Database, actorId: string): QueuedAction | null {
  const row = queryRow(
    db,
    `SELECT ${COLUMNS} FROM actions
     WHERE actor_id = ? AND status IN ('queued', 'in_progress')
     ORDER BY sequence ASC LIMIT 1`,
    [actorId],
  );
  return row ? rowToAction(row) : null;
}

export function listActorActions(db: Database, actorId: string): QueuedAction[] {
  return queryRows(db, `SELECT ${COLUMNS} FROM actions WHERE actor_id = ? ORDER BY sequence ASC`, [
    actorId,
  ]).map(rowToAction);
}

// The HUD's "current action + queue" (§14.2) only ever needs the handful of
// not-yet-resolved rows, not the actor's entire history — polling
// listActorActions() every tick for this is an O(n²) trap over a long play
// session (the same one the Stage 2 scenario test hit; see DECISIONS.md).
export function listActiveActions(db: Database, actorId: string): QueuedAction[] {
  return queryRows(
    db,
    `SELECT ${COLUMNS} FROM actions WHERE actor_id = ? AND status IN ('queued', 'in_progress') ORDER BY sequence ASC`,
    [actorId],
  ).map(rowToAction);
}

export function enqueueAction(
  db: Database,
  registry: ActionRegistry,
  actorId: string,
  type: string,
  currentTick: number,
): number {
  const definition = registry.get(type); // throws on an unregistered type
  const sequence = getNextSequence(db, actorId);
  db.run(
    `INSERT INTO actions (actor_id, type, status, queued_at_tick, duration_ticks, progress_ticks, sequence)
     VALUES (?, ?, 'queued', ?, ?, 0, ?)`,
    [actorId, type, currentTick, definition.durationTicks, sequence],
  );
  const row = queryRow(db, 'SELECT last_insert_rowid()');
  return Number(row?.[0]);
}

function startAction(db: Database, bus: EventBus, action: QueuedAction, currentTick: number): void {
  const endsAtTick = currentTick + action.durationTicks;
  db.run('UPDATE actions SET status = ?, started_at_tick = ?, ends_at_tick = ? WHERE id = ?', [
    'in_progress',
    currentTick,
    endsAtTick,
    action.id,
  ]);
  bus.emit({
    tick: currentTick,
    scope: 'personal',
    actorId: action.actorId,
    type: 'action.started',
    message: `${action.actorId} began ${action.type}.`,
  });
}

function resolveAction(
  db: Database,
  bus: EventBus,
  registry: ActionRegistry,
  rng: Rng,
  action: QueuedAction,
  currentTick: number,
): void {
  const definition = registry.get(action.type);
  const ctx = { db, bus, actorId: action.actorId, tick: currentTick };
  const outcome = definition.resolve(rng, ctx);
  const status: ActionStatus = outcome.success ? 'complete' : 'failed';
  db.run('UPDATE actions SET status = ?, progress_ticks = ?, outcome = ? WHERE id = ?', [
    status,
    action.durationTicks,
    JSON.stringify(outcome),
    action.id,
  ]);
  bus.emit(
    withOptional(
      {
        tick: currentTick,
        scope: 'personal' as const,
        actorId: action.actorId,
        type: outcome.success ? 'action.completed' : 'action.failed',
        message: outcome.message,
      },
      { data: outcome.data },
    ),
  );
  definition.applyOutcome?.(ctx, outcome);
}

// Runs one actor's queue forward by one tick. Chains transitions (a
// completion immediately followed by the next action starting) within the
// same call so an actor with queued work is never idle for a tick — "every
// timed action occupies the character exclusively" (§4.3), not idles between.
export function processActorActions(
  db: Database,
  bus: EventBus,
  registry: ActionRegistry,
  rng: Rng,
  actorId: string,
  currentTick: number,
): void {
  for (;;) {
    const action = getCurrentAction(db, actorId);
    if (!action) return;

    if (action.status === 'queued') {
      startAction(db, bus, action, currentTick);
      continue;
    }

    const progressTicks = currentTick - (action.startedAtTick ?? currentTick);
    if (progressTicks < action.durationTicks) {
      db.run('UPDATE actions SET progress_ticks = ? WHERE id = ?', [progressTicks, action.id]);
      return;
    }

    resolveAction(db, bus, registry, rng, action, currentTick);
  }
}

// A forced interruption (e.g. collapse, §6) doesn't just stop the current
// action — whatever else was queued behind it no longer applies either, so
// it's cancelled rather than left to silently resume later.
export function cancelQueuedActions(db: Database, bus: EventBus, actorId: string, currentTick: number): void {
  const queued = queryRows(db, "SELECT id FROM actions WHERE actor_id = ? AND status = 'queued'", [actorId]);
  if (queued.length === 0) return;
  db.run("UPDATE actions SET status = 'cancelled' WHERE actor_id = ? AND status = 'queued'", [actorId]);
  bus.emit({
    tick: currentTick,
    scope: 'personal',
    actorId,
    type: 'action.queue_cancelled',
    message: `${actorId}'s remaining queued actions were cancelled.`,
    data: { count: queued.length },
  });
}

// Proportional results on interruption (§4.3): the action is stopped where it
// stood, its partial progress preserved for the caller to judge.
export function interruptCurrentAction(
  db: Database,
  bus: EventBus,
  actorId: string,
  currentTick: number,
): void {
  const action = getCurrentAction(db, actorId);
  if (!action || action.status !== 'in_progress') return;

  const progressTicks = currentTick - (action.startedAtTick ?? currentTick);
  const fraction = action.durationTicks > 0 ? progressTicks / action.durationTicks : 0;
  db.run('UPDATE actions SET status = ?, progress_ticks = ? WHERE id = ?', [
    'interrupted',
    progressTicks,
    action.id,
  ]);
  bus.emit({
    tick: currentTick,
    scope: 'personal',
    actorId,
    type: 'action.interrupted',
    message: `${actorId}'s ${action.type} was interrupted (${Math.round(fraction * 100)}% complete).`,
    data: { fraction },
  });
}
