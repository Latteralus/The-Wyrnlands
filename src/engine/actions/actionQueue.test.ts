import { describe, expect, it } from 'vitest';
import { createDatabase } from '../db/sqlite';
import { loadSqlJs } from '../db/sqlite.node';
import { Engine } from '../engine';
import type { QueuedAction } from './types';

describe('action queue', () => {
  it('runs a queued chain sequentially, including a failed attempt, with no idle tick between actions', async () => {
    const SQL = await loadSqlJs();
    const db = createDatabase(SQL);
    const engine = Engine.bootstrap(db, { seed: 'actions-chain' });

    engine.registerActionType({
      type: 'chop_wood',
      durationTicks: 60,
      resolve: () => ({
        success: true,
        message: 'Chopped a load of wood.',
        data: { item: 'timber', qty: 1 },
      }),
    });
    engine.registerActionType({
      type: 'botched_smelt',
      durationTicks: 40,
      resolve: () => ({ success: false, message: 'The smelt was botched — ore wasted.' }),
    });

    engine.createEntity('villager-1', 'Test Villager');
    engine.queueAction('villager-1', 'chop_wood');
    engine.queueAction('villager-1', 'botched_smelt');
    engine.queueAction('villager-1', 'chop_wood');

    engine.advanceTicks(200); // comfortably more than 60 + 40 + 60

    const history = engine.getActorActions('villager-1');
    expect(history.map((a) => a.type)).toEqual(['chop_wood', 'botched_smelt', 'chop_wood']);
    expect(history.map((a) => a.status)).toEqual(['complete', 'failed', 'complete']);
    expect(history).toHaveLength(3);
    const [chopWood1, botchedSmelt, chopWood2] = history as [QueuedAction, QueuedAction, QueuedAction];

    // A completion and the next action's start land in the same tick — no
    // idle gap between chained actions (§4.3: actions occupy the actor
    // exclusively).
    expect(chopWood1.startedAtTick).toBe(1);
    expect(chopWood1.endsAtTick).toBe(61);
    expect(botchedSmelt.startedAtTick).toBe(61);
    expect(botchedSmelt.endsAtTick).toBe(101);
    expect(chopWood2.startedAtTick).toBe(101);
    expect(chopWood2.endsAtTick).toBe(161);

    expect(botchedSmelt.outcome?.success).toBe(false);
    expect(chopWood1.outcome?.data).toEqual({ item: 'timber', qty: 1 });

    const personalLog = engine.queryLog('personal', 20);
    expect(personalLog.filter((e) => e.type === 'action.completed')).toHaveLength(2);
    expect(personalLog.filter((e) => e.type === 'action.failed')).toHaveLength(1);
    expect(personalLog.filter((e) => e.type === 'action.started')).toHaveLength(3);

    engine.dispose();
  });

  it('marks an in-progress action interrupted with proportional partial progress', async () => {
    const SQL = await loadSqlJs();
    const db = createDatabase(SQL);
    const engine = Engine.bootstrap(db, { seed: 'actions-interrupt' });

    engine.registerActionType({
      type: 'long_haul',
      durationTicks: 100,
      resolve: () => ({ success: true, message: 'Hauled the cart to market.' }),
    });

    engine.createEntity('hauler-1', 'Test Hauler');
    engine.queueAction('hauler-1', 'long_haul');

    engine.advanceTicks(40);
    engine.interruptAction('hauler-1');

    const haulerActions = engine.getActorActions('hauler-1');
    expect(haulerActions).toHaveLength(1);
    const [action] = haulerActions as [QueuedAction];
    expect(action.status).toBe('interrupted');
    expect(action.progressTicks).toBe(39); // started at tick 1, interrupted at tick 40

    const personalLog = engine.queryLog('personal', 20);
    expect(personalLog.some((e) => e.type === 'action.interrupted')).toBe(true);

    engine.dispose();
  });

  it('throws when queueing an unregistered action type', async () => {
    const SQL = await loadSqlJs();
    const db = createDatabase(SQL);
    const engine = Engine.bootstrap(db, { seed: 'actions-unknown-type' });

    engine.createEntity('villager-2', 'Test Villager 2');
    expect(() => engine.queueAction('villager-2', 'nonexistent_action')).toThrow(/Unknown action type/);

    engine.dispose();
  });
});
