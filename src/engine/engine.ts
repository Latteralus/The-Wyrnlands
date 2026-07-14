import type { Database } from 'sql.js';
import { enqueueAction, interruptCurrentAction, listActorActions, processActorActions } from './actions/actionQueue';
import { ActionRegistry } from './actions/registry';
import type { ActionDefinition, QueuedAction } from './actions/types';
import { applyMigrations } from './db/migrationRunner';
import { exportDatabase } from './db/sqlite';
import { EventBus, type EngineEvent, type EventScope } from './eventBus';
import { attachLogger, queryLog } from './logs/logger';
import { createRng, hashSeed, type Rng } from './rng';
import { deriveCalendar, type Calendar } from './time/clock';
import { travelDurationTicks, type TravelConditions } from './world/grid';
import { createSite, distanceBetweenSites, getSite, listSitesByKind, type Site } from './world/sites';

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
  readonly actions = new ActionRegistry();
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
    this.processActiveActions(nextTick);
    // Further cadence hooks (needs, market, households, ...) attach here
    // as each module lands — see MASTERPLAN.md §4.2.
  }

  private processActiveActions(currentTick: number): void {
    const result = this.db.exec(
      "SELECT DISTINCT actor_id FROM actions WHERE status IN ('queued', 'in_progress') ORDER BY actor_id ASC",
    );
    if (result.length === 0) return;
    for (const row of result[0].values) {
      processActorActions(this.db, this.bus, this.actions, this.rng, String(row[0]), currentTick);
    }
  }

  registerActionType(definition: ActionDefinition): void {
    this.actions.register(definition);
  }

  createEntity(id: string, name: string): void {
    this.db.run('INSERT OR IGNORE INTO entities (id, name) VALUES (?, ?)', [id, name]);
  }

  queueAction(actorId: string, type: string): number {
    return enqueueAction(this.db, this.actions, actorId, type, this.tick);
  }

  getActorActions(actorId: string): QueuedAction[] {
    return listActorActions(this.db, actorId);
  }

  interruptAction(actorId: string): void {
    interruptCurrentAction(this.db, this.bus, actorId, this.tick);
  }

  createSite(site: Site): void {
    createSite(this.db, site);
  }

  getSite(id: string): Site | null {
    return getSite(this.db, id);
  }

  listSitesByKind(kind: string): Site[] {
    return listSitesByKind(this.db, kind);
  }

  distanceBetweenSites(aId: string, bId: string): number {
    return distanceBetweenSites(this.db, aId, bId);
  }

  travelDurationBetweenSites(aId: string, bId: string, conditions: TravelConditions): number {
    return travelDurationTicks(this.distanceBetweenSites(aId, bId), conditions);
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
