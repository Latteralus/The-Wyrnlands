import type { Database } from 'sql.js';
import type { EventBus } from '../eventBus';
import type { Rng } from '../rng';
import type { ActionRegistry } from './registry';
import type { ActionStatus, QueuedAction } from './types';

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
    outcome: row[9] ? JSON.parse(String(row[9])) : null,
    sequence: Number(row[10]),
  };
}

function getNextSequence(db: Database, actorId: string): number {
  const result = db.exec('SELECT COALESCE(MAX(sequence), -1) + 1 FROM actions WHERE actor_id = ?', [
    actorId,
  ]);
  return Number(result[0].values[0][0]);
}

function getCurrentAction(db: Database, actorId: string): QueuedAction | null {
  const result = db.exec(
    `SELECT ${COLUMNS} FROM actions
     WHERE actor_id = ? AND status IN ('queued', 'in_progress')
     ORDER BY sequence ASC LIMIT 1`,
    [actorId],
  );
  if (result.length === 0) return null;
  return rowToAction(result[0].values[0]);
}

export function listActorActions(db: Database, actorId: string): QueuedAction[] {
  const result = db.exec(`SELECT ${COLUMNS} FROM actions WHERE actor_id = ? ORDER BY sequence ASC`, [
    actorId,
  ]);
  if (result.length === 0) return [];
  return result[0].values.map(rowToAction);
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
  const idResult = db.exec('SELECT last_insert_rowid()');
  return Number(idResult[0].values[0][0]);
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
  const outcome = definition.resolve(rng);
  const status: ActionStatus = outcome.success ? 'complete' : 'failed';
  db.run('UPDATE actions SET status = ?, progress_ticks = ?, outcome = ? WHERE id = ?', [
    status,
    action.durationTicks,
    JSON.stringify(outcome),
    action.id,
  ]);
  bus.emit({
    tick: currentTick,
    scope: 'personal',
    actorId: action.actorId,
    type: outcome.success ? 'action.completed' : 'action.failed',
    message: outcome.message,
    data: outcome.data,
  });
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

// Proportional results on interruption (§4.3): the action is stopped where it
// stood, its partial progress preserved for the caller to judge.
export function interruptCurrentAction(db: Database, bus: EventBus, actorId: string, currentTick: number): void {
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
