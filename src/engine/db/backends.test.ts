import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inspectConservation } from '../audit/conservationAudit';
import { Engine } from '../engine';
import { canonicalState, createBenchmarkGame } from '../perf/benchmark';
import { loadGame, openGame } from '../player/loadGame';
import { runScriptedPlayerUntil } from '../scenarios/scriptedPlayer';
import { seedDemoWorld } from '../seed/demoWorld';
import { migrations } from './migrations';
import {
  createDatabase,
  queryRow,
  queryRows,
  withSavepoint,
  type Database,
  type SqlJsStatic,
} from './sqlite';
import { isNativeSqliteAvailable, NativeDatabase } from './sqlite.native';
import { loadSqlJs } from './sqlite.node';

// The two SQLite backends must be interchangeable (MigrationPlan.md Phases
// 9–10, 14, 27): the same simulation, migrations, transactions, audits and
// saves on sql.js (WebAssembly) and native node:sqlite. Needs Node 22.16+/24
// — `npm run test:native` runs the suite on Electron's own Node.

const MINUTES_PER_DAY = 1440;
let SQL: SqlJsStatic;
let dir: string;
beforeAll(async () => {
  SQL = await loadSqlJs();
  dir = mkdtempSync(path.join(tmpdir(), 'wyrnlands-backends-'));
});
afterAll(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));

const backends = (): { name: string; open: (file?: string) => Database }[] => [
  { name: 'sql.js', open: () => createDatabase(SQL) },
  { name: 'native (memory)', open: () => new NativeDatabase(':memory:') },
  {
    name: 'native (file)',
    open: (file = path.join(dir, `${Math.random()}.sqlite`)) => new NativeDatabase(file, { durable: true }),
  },
];

describe.skipIf(!isNativeSqliteAvailable())('SQLite backends are interchangeable', () => {
  it('bind and read values identically', () => {
    const results = backends().map(({ open }) => {
      const db = open();
      db.run('CREATE TABLE t (untyped, n INTEGER, s TEXT, r REAL, b BLOB)');
      for (const value of [5, -3, 2.5, 4_000_000_000, 0, null] as const)
        db.run('INSERT INTO t VALUES (?, ?, ?, ?, ?)', [value, value, value, value, value]);
      db.run('INSERT INTO t (b) VALUES (?)', [new Uint8Array([1, 2, 255])]);
      const rows = queryRows(
        db,
        'SELECT typeof(untyped), untyped, typeof(n), n, s, typeof(r), r, ? / 2, ? / 2, b FROM t ORDER BY rowid',
        [7, 7.5],
      );
      const duplicateNames = queryRow(db, 'SELECT 1 AS a, 2 AS a');
      db.close();
      return { rows, duplicateNames };
    });
    for (const result of results.slice(1)) expect(result).toEqual(results[0]);
    // sql.js semantics: 32-bit integers bind as INTEGER (so 7 / 2 = 3).
    expect(results[0]?.rows[0]?.slice(0, 5)).toEqual(['integer', 5, 'integer', 5, '5']);
    expect(results[0]?.rows[0]?.[7]).toBe(3);
    expect(results[0]?.duplicateNames).toEqual([1, 2]);
  });

  it('run the same world to the identical state', () => {
    const states = backends().map(({ open }) => {
      const engine = createBenchmarkGame(open(), 'backend-equivalence');
      runScriptedPlayerUntil(engine, 4 * MINUTES_PER_DAY, { player: true });
      const audit = engine.runConservationAudit();
      const state = canonicalState(engine);
      const provenance = queryRows(
        engine.db,
        'SELECT item_id, tick, event_type, actor_id, from_container_id, to_container_id FROM provenance_events ORDER BY id LIMIT 500',
      );
      engine.dispose();
      return { state, audit: audit.passed, provenance };
    });
    for (const state of states) expect(state.audit).toBe(true);
    for (const state of states.slice(1)) expect(state).toEqual(states[0]);
  });

  it('migrate a fresh database to the identical schema', () => {
    const schemas = backends().map(({ open }) => {
      const db = open();
      const engine = Engine.bootstrap(db, { seed: 'schema' });
      const schema = queryRows(db, 'SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name');
      const applied = queryRows(db, 'SELECT id FROM schema_migrations ORDER BY id').map((r) => r[0]);
      engine.dispose();
      return { schema, applied };
    });
    for (const schema of schemas.slice(1)) expect(schema).toEqual(schemas[0]);
    expect(schemas[0]?.applied).toEqual(migrations.map((m) => m.id).sort());
  });

  it('migrate a legacy (schema-22) save the same way', () => {
    // A save from before migration 0023, made the way the old version left it.
    const e = createBenchmarkGame(createDatabase(SQL), 'legacy-save');
    e.setAutonomous(e.getPlayerEntityId(), false);
    e.export();
    e.db.run('DROP TABLE player_preferences');
    for (const column of ['player_entity_id', 'save_format_version', 'game_version'])
      e.db.run(`ALTER TABLE world_meta DROP COLUMN ${column}`);
    e.db.run('DROP INDEX idx_entities_simulation_mode');
    e.db.run('ALTER TABLE entities DROP COLUMN simulation_mode');
    e.db.run("DELETE FROM schema_migrations WHERE id = '0023_player_experience'");
    const legacy = e.export();
    e.dispose();

    const viaSqlJs = loadGame(SQL, legacy);
    const file = path.join(dir, 'legacy.sqlite');
    writeFileSync(file, legacy);
    const viaNative = openGame(new NativeDatabase(file, { durable: true }));
    for (const engine of [viaSqlJs, viaNative]) {
      expect(queryRows(engine.db, 'SELECT id FROM schema_migrations ORDER BY id').map((r) => r[0])).toEqual(
        migrations.map((m) => m.id).sort(),
      );
      expect(inspectConservation(engine.db, engine.tick).passed).toBe(true);
    }
    expect(canonicalState(viaNative)).toBe(canonicalState(viaSqlJs));
    viaSqlJs.dispose();
    viaNative.dispose();
  });

  it('roll back failed transactions and savepoints', () => {
    for (const { open } of backends()) {
      const db = open();
      db.run('CREATE TABLE t (x INTEGER)');
      expect(() =>
        withSavepoint(db, () => {
          db.run('INSERT INTO t VALUES (?)', [1]);
          throw new Error('abandon');
        }),
      ).toThrow('abandon');
      // Nested inside an explicit transaction, as commands inside a batch are.
      db.run('BEGIN');
      db.run('INSERT INTO t VALUES (?)', [2]);
      expect(() =>
        withSavepoint(db, () => {
          db.run('INSERT INTO t VALUES (?)', [3]);
          throw new Error('inner');
        }),
      ).toThrow('inner');
      db.run('COMMIT');
      expect(queryRows(db, 'SELECT x FROM t ORDER BY x')).toEqual([[2]]);
      db.close();
    }
  });

  it('roll back a whole batch of ticks that fails part-way', () => {
    for (const { open } of backends()) {
      const engine = Engine.bootstrap(open(), { seed: 'rollback' });
      seedDemoWorld(engine);
      engine.advanceTicks(10);
      const before = canonicalState(engine);
      engine.registerActionType({
        type: 'explode',
        durationTicks: 1,
        resolve: () => {
          throw new Error('mid-batch failure');
        },
      });
      engine.queueAction(engine.getPlayerEntityId(), 'explode');
      expect(() => engine.advanceTicks(50)).toThrow('mid-batch failure');
      expect(engine.tick).toBe(10);
      // The queued action itself was committed before the batch began.
      engine.db.run("DELETE FROM actions WHERE type = 'explode'");
      expect(canonicalState(engine)).toBe(before);
      engine.dispose();
    }
  });

  it('carry saves across backends in both directions', () => {
    const native = createBenchmarkGame(new NativeDatabase(':memory:'), 'portable');
    native.advanceTicks(MINUTES_PER_DAY);
    const nativeState = canonicalState(native);
    const toSqlJs = loadGame(SQL, native.export());
    expect(canonicalState(toSqlJs)).toBe(nativeState);
    const backToNative = openGame(NativeDatabase.fromBytes(toSqlJs.export()));
    expect(canonicalState(backToNative)).toBe(nativeState);
    // A VACUUM INTO copy of a live file-backed game is a plain SQLite file.
    const file = path.join(dir, 'live.sqlite');
    const live = createBenchmarkGame(new NativeDatabase(file, { durable: true }), 'portable');
    live.advanceTicks(MINUTES_PER_DAY);
    live.syncRngState();
    (live.db as NativeDatabase).copyTo(path.join(dir, 'copy.sqlite'));
    const copied = loadGame(SQL, new Uint8Array(readFileSync(path.join(dir, 'copy.sqlite'))));
    expect(canonicalState(copied)).toBe(nativeState);
    for (const engine of [native, toSqlJs, backToNative, live, copied]) engine.dispose();
  });
});
