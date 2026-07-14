import type { Database } from 'sql.js';
import { applyMigrations } from './db/migrationRunner';
import { exportDatabase } from './db/sqlite';
import { EventBus, type EngineEvent, type EventScope } from './eventBus';
import { attachLogger, queryLog } from './logs/logger';
import { createRng, hashSeed, type Rng } from './rng';
import { deriveCalendar, type Calendar } from './time/clock';

export interface EngineOptions {
  seed: string;
}

/**
 * The simulation root. Owns the DB connection, the deterministic RNG stream,
 * and the tick loop. Holds no React/DOM dependency — see src/engine/ui-api
 * for the narrow surface the interface is allowed to consume.
 */
export class Engine {
  readonly db: Database;
  readonly bus = new EventBus();
  private rng: Rng;
  private detachLogger: () => void;

  private constructor(db: Database, seed: string) {
    this.db = db;
    this.rng = createRng(hashSeed(seed));
    this.detachLogger = attachLogger(db, this.bus);
  }

  static bootstrap(db: Database, options: EngineOptions): Engine {
    applyMigrations(db);
    const engine = new Engine(db, options.seed);
    engine.ensureWorldMeta(options.seed);
    return engine;
  }

  private ensureWorldMeta(seed: string): void {
    const existing = this.db.exec('SELECT id FROM world_meta WHERE id = 1');
    if (existing.length > 0 && existing[0].values.length > 0) return;

    this.db.run('INSERT INTO world_meta (id, tick, rng_seed, schema_version) VALUES (1, 0, ?, 1)', [
      seed,
    ]);
    this.bus.emit({
      tick: 0,
      scope: 'world',
      type: 'world.created',
      message: `World seeded with "${seed}".`,
    });
  }

  get tick(): number {
    const result = this.db.exec('SELECT tick FROM world_meta WHERE id = 1');
    return Number(result[0]?.values[0]?.[0] ?? 0);
  }

  get calendar(): Calendar {
    return deriveCalendar(this.tick);
  }

  advanceTicks(count: number): void {
    for (let i = 0; i < count; i++) {
      this.stepOneTick();
    }
  }

  private stepOneTick(): void {
    const nextTick = this.tick + 1;
    this.db.run('UPDATE world_meta SET tick = ? WHERE id = 1', [nextTick]);
    // Cadence hooks (needs, actions, market, households, ...) attach here
    // as each module lands — see MASTERPLAN.md §4.2.
  }

  queryLog(scope: EventScope, limit = 100): EngineEvent[] {
    return queryLog(this.db, scope, limit);
  }

  nextRandom(): number {
    return this.rng();
  }

  export(): Uint8Array {
    return exportDatabase(this.db);
  }

  dispose(): void {
    this.detachLogger();
    this.db.close();
  }
}
