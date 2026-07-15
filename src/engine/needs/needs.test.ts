import { describe, expect, it } from 'vitest';
import { createDatabase } from '../db/sqlite';
import { loadSqlJs } from '../db/sqlite.node';
import { Engine } from '../engine';

describe('needs', () => {
  it('decays every tick and collapses when a need bottoms out, then recovers', async () => {
    const SQL = await loadSqlJs();
    const db = createDatabase(SQL);
    const engine = Engine.bootstrap(db, { seed: 'needs-collapse' });
    engine.createEntity('villager-1', 'Test Villager');
    engine.ensureNeeds('villager-1');

    // Thirst decays fastest (§6) — 100 / (100/600 per tick) = 600 ticks to
    // empty. Advance comfortably past that.
    engine.advanceTicks(610);

    const afterCollapse = engine.getNeeds('villager-1');
    expect(afterCollapse?.thirst).toBe(0);
    expect(afterCollapse?.hunger).toBeGreaterThan(0);
    expect(afterCollapse?.hunger).toBeLessThan(100);

    const personalLog = engine.queryLog('personal', 50);
    const collapseEvent = personalLog.find((e) => e.type === 'need.collapsed');
    expect(collapseEvent?.data).toEqual({ need: 'thirst' });

    const actions = engine.getActorActions('villager-1');
    const recovery = actions.find((a) => a.type === 'collapse_recovery');
    expect(recovery).toBeDefined();
    expect(recovery?.status).toBe('in_progress');

    // Needs don't keep draining while the actor is being cared for.
    const midRecovery = engine.getNeeds('villager-1');
    engine.advanceTicks(100);
    const stillRecovering = engine.getNeeds('villager-1');
    expect(stillRecovering?.hunger).toBeCloseTo(midRecovery!.hunger, 5);

    // Recovery (240 ticks, started at tick 610) finishes at tick 850 and
    // restores every need — advance just past that.
    engine.advanceTicks(141);
    const recovered = engine.getActorActions('villager-1').find((a) => a.type === 'collapse_recovery');
    expect(recovered?.status).toBe('complete');
    const afterRecovery = engine.getNeeds('villager-1');
    expect(afterRecovery?.thirst).toBeGreaterThan(stillRecovering!.thirst);
    expect(afterRecovery?.hunger).toBeGreaterThan(stillRecovering!.hunger);

    engine.dispose();
  });

  it('restoreNeed clamps to [0, 100]', async () => {
    const SQL = await loadSqlJs();
    const db = createDatabase(SQL);
    const engine = Engine.bootstrap(db, { seed: 'needs-clamp' });
    engine.createEntity('villager-2', 'Test Villager 2');
    engine.ensureNeeds('villager-2');

    engine.restoreNeed('villager-2', 'hunger', 500);
    expect(engine.getNeeds('villager-2')?.hunger).toBe(100);

    engine.dispose();
  });

  it('warmth regenerates outside winter and stays put once full', async () => {
    const SQL = await loadSqlJs();
    const db = createDatabase(SQL);
    const engine = Engine.bootstrap(db, { seed: 'needs-warmth' });
    engine.createEntity('villager-3', 'Test Villager 3');
    engine.ensureNeeds('villager-3');

    engine.advanceTicks(50);
    expect(engine.getNeeds('villager-3')?.warmth).toBe(100);

    engine.dispose();
  });
});
