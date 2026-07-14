import { describe, expect, it } from 'vitest';
import { createDatabase } from './db/sqlite';
import { loadSqlJs } from './db/sqlite.node';
import { Engine } from './engine';

describe('Engine', () => {
  it('advances 10,000 ticks deterministically for a given seed', async () => {
    const SQL = await loadSqlJs();

    const runOnce = () => {
      const db = createDatabase(SQL);
      const engine = Engine.bootstrap(db, { seed: 'determinism-check' });
      engine.advanceTicks(10_000);
      const bytes = engine.export();
      engine.dispose();
      return bytes;
    };

    const first = runOnce();
    const second = runOnce();

    expect(first).toEqual(second);
    expect(first.length).toBeGreaterThan(0);
  });

  it('round-trips save -> load -> resave to identical bytes', async () => {
    const SQL = await loadSqlJs();

    const db = createDatabase(SQL);
    const engine = Engine.bootstrap(db, { seed: 'save-load-check' });
    engine.advanceTicks(500);
    const saved = engine.export();
    engine.dispose();

    const reloadedDb = createDatabase(SQL, saved);
    const reloadedEngine = Engine.bootstrap(reloadedDb, { seed: 'save-load-check' });
    const resaved = reloadedEngine.export();
    reloadedEngine.dispose();

    expect(resaved).toEqual(saved);
  });

  it('logs a world-scoped event on creation', async () => {
    const SQL = await loadSqlJs();
    const db = createDatabase(SQL);
    const engine = Engine.bootstrap(db, { seed: 'log-check' });

    const worldLog = engine.queryLog('world', 10);
    expect(worldLog.some((event) => event.type === 'world.created')).toBe(true);

    engine.dispose();
  });
});
