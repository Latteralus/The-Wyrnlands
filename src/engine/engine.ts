import {
  enqueueAction,
  getCurrentAction,
  interruptCurrentAction,
  listActiveActions,
  listActorActions,
  processActorActions,
} from './actions/actionQueue';
import { ActionRegistry } from './actions/registry';
import { runConservationAudit, type AuditResult } from './audit/conservationAudit';
import { createCompany, getCompany, type Company } from './companies/companies';
import { applyMigrations } from './db/migrationRunner';
import { exportDatabase, queryRow, queryRows } from './db/sqlite';
import { EventBus, type EngineEvent, type EventScope } from './eventBus';
import { equipItem, getWornGear, getWornItemInSlot, wearGear, type WornGear } from './gear/gear';
import { getGoodDefinition } from './goods/catalog';
import { canCarry, getCarriedWeightKg } from './inventory/capacity';
import {
  destroyItem,
  getItem,
  getProvenanceChain,
  produceItem,
  transferItem,
  type ProduceItemParams,
} from './inventory/items';
import { ensureWallet, faucetCoin, getBalance, sinkCoin, transferCoin } from './inventory/wallet';
import {
  applyForJob,
  createJobSlot,
  getActiveEmployment,
  listJobOpenings,
  quitJob,
  type ApplyResult,
  type CreateJobSlotParams,
  type Employment,
  type JobSlot,
} from './jobs/jobs';
import { attachLogger, queryLog } from './logs/logger';
import {
  decrementStock,
  getListing,
  listListingsForSite,
  seedListing,
  type MarketListing,
} from './market/market';
import {
  ensureNeeds,
  getNeeds,
  registerCollapseRecoveryAction,
  restoreNeed,
  tickNeeds,
  type Needs,
  type NeedKey,
} from './needs/needs';
import { createRng, hashSeed, type Rng } from './rng';
import { addXp, ensureSkill, getLevel, getSuccessChance, getXp } from './skills/skills';
import { MINUTES_PER_DAY, deriveCalendar, type Calendar } from './time/clock';
import { travelDurationTicks, type TravelConditions } from './world/grid';
import {
  createSite,
  distanceBetweenSites,
  getSite,
  listSites,
  listSitesByKind,
  type Site,
} from './world/sites';
import type { ActionDefinition, QueuedAction } from './actions/types';
import type { DestructionReason, Item, ProvenanceEvent } from './inventory/types';
import type { Database } from 'sql.js';

// A body-slot garment needs at least this much warmth rating to count as
// protection from a winter chill (§6). Placeholder threshold alongside the
// needs decay constants in needs.ts.
const WARMTH_PROTECTION_THRESHOLD = 30;

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
    registerCollapseRecoveryAction(this.actions);
  }

  static bootstrap(db: Database, options: EngineOptions): Engine {
    applyMigrations(db);
    const engine = new Engine(db, options.seed);
    engine.ensureWorldMeta(options.seed);
    return engine;
  }

  private ensureWorldMeta(seed: string): void {
    const existing = queryRow(this.db, 'SELECT id FROM world_meta WHERE id = 1');
    if (existing) return;

    this.db.run('INSERT INTO world_meta (id, tick, rng_seed, schema_version) VALUES (1, 0, ?, 1)', [seed]);
    this.bus.emit({
      tick: 0,
      scope: 'world',
      type: 'world.created',
      message: `World seeded with "${seed}".`,
    });
  }

  get tick(): number {
    const row = queryRow(this.db, 'SELECT tick FROM world_meta WHERE id = 1');
    return Number(row?.[0] ?? 0);
  }

  get calendar(): Calendar {
    return deriveCalendar(this.tick);
  }

  // Wrapped in one explicit transaction rather than leaving each tick's
  // writes as their own autocommit statement: sql.js's WASM heap doesn't
  // reclaim per-statement rollback-journal overhead between thousands of
  // individual autocommits, and a long headless run (this method is the
  // *only* thing that drives ticks — §Stage 2's 30-day exit scenario, later
  // Stage 4/5's 90-day/2-year runs) reliably exhausts it and crashes with
  // "out of memory" well under 100k ticks. One transaction per call fixes it
  // — confirmed empirically (30k ticks unwrapped: OOM; 43.2k wrapped: clean).
  advanceTicks(count: number): void {
    this.db.run('BEGIN');
    try {
      for (let i = 0; i < count; i++) {
        this.stepOneTick();
      }
      this.db.run('COMMIT');
    } catch (err) {
      // A sufficiently severe error (e.g. SQLite's own out-of-memory) can
      // force-abort the transaction itself, leaving nothing for this
      // ROLLBACK to roll back — that secondary failure must not mask the
      // original error, which is the one worth seeing.
      try {
        this.db.run('ROLLBACK');
      } catch {
        // transaction already gone; original err is what matters
      }
      throw err;
    }
  }

  private stepOneTick(): void {
    const nextTick = this.tick + 1;
    this.db.run('UPDATE world_meta SET tick = ? WHERE id = 1', [nextTick]);
    this.applyNeedsCadence(nextTick);
    this.processActiveActions(nextTick);
    // Further cadence hooks (market, households, ...) attach here as each
    // module lands — see MASTERPLAN.md §4.2.
    if (nextTick % MINUTES_PER_DAY === 0) {
      runConservationAudit(this.db, this.bus, nextTick);
    }
  }

  private processActiveActions(currentTick: number): void {
    const rows = queryRows(
      this.db,
      "SELECT DISTINCT actor_id FROM actions WHERE status IN ('queued', 'in_progress') ORDER BY actor_id ASC",
    );
    for (const row of rows) {
      processActorActions(this.db, this.bus, this.actions, this.rng, String(row[0]), currentTick);
    }
  }

  // Needs decay before actions resolve each tick, so an action that
  // completes this same tick sees the tick's own decay applied first.
  private applyNeedsCadence(currentTick: number): void {
    const season = deriveCalendar(currentTick).season;
    const rows = queryRows(this.db, 'SELECT entity_id FROM needs ORDER BY entity_id ASC');
    for (const row of rows) {
      const entityId = String(row[0]);
      const body = getWornItemInSlot(this.db, entityId, 'body');
      const warmth = body ? (getGoodDefinition(body.goodType).warmth ?? 0) : 0;
      const exposedToCold = season === 'winter' && warmth < WARMTH_PROTECTION_THRESHOLD;
      tickNeeds(this.db, this.bus, this.actions, entityId, currentTick, { exposedToCold });
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

  // Cheap "what's happening right now" query — unlike getActorActions(),
  // this doesn't scan the actor's whole history, so it's safe to poll every
  // tick (a headless scenario script's own decision loop, a future HUD).
  getCurrentAction(actorId: string): QueuedAction | null {
    return getCurrentAction(this.db, actorId);
  }

  // The HUD's "current action + queue" (§14.2) — just the not-yet-resolved
  // rows, same reasoning as getCurrentAction() above.
  getActiveActions(actorId: string): QueuedAction[] {
    return listActiveActions(this.db, actorId);
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

  listSites(): Site[] {
    return listSites(this.db);
  }

  distanceBetweenSites(aId: string, bId: string): number {
    return distanceBetweenSites(this.db, aId, bId);
  }

  travelDurationBetweenSites(aId: string, bId: string, conditions: TravelConditions): number {
    return travelDurationTicks(this.distanceBetweenSites(aId, bId), conditions);
  }

  produceItem(params: Omit<ProduceItemParams, 'tick'> & { tick?: number }): void {
    produceItem(this.db, this.bus, { ...params, tick: params.tick ?? this.tick });
  }

  transferItem(itemId: string, toContainerId: string, options?: { actorId?: string; note?: string }): void {
    transferItem(this.db, this.bus, itemId, toContainerId, this.tick, options);
  }

  destroyItem(
    itemId: string,
    reason: DestructionReason,
    options?: { actorId?: string; note?: string },
  ): void {
    destroyItem(this.db, this.bus, itemId, reason, this.tick, options);
  }

  getItem(itemId: string): Item | null {
    return getItem(this.db, itemId);
  }

  getProvenanceChain(itemId: string): ProvenanceEvent[] {
    return getProvenanceChain(this.db, itemId);
  }

  ensureWallet(ownerId: string): void {
    ensureWallet(this.db, ownerId);
  }

  getBalance(ownerId: string): number {
    return getBalance(this.db, ownerId);
  }

  faucetCoin(ownerId: string, amount: number, note?: string): void {
    faucetCoin(this.db, this.bus, ownerId, amount, this.tick, note);
  }

  sinkCoin(ownerId: string, amount: number, note?: string): void {
    sinkCoin(this.db, this.bus, ownerId, amount, this.tick, note);
  }

  transferCoin(fromOwnerId: string, toOwnerId: string, amount: number, note?: string): void {
    transferCoin(this.db, this.bus, fromOwnerId, toOwnerId, amount, this.tick, note);
  }

  runConservationAudit(): AuditResult {
    return runConservationAudit(this.db, this.bus, this.tick);
  }

  // --- Needs (§6) ---

  ensureNeeds(entityId: string): void {
    ensureNeeds(this.db, entityId, this.tick);
  }

  getNeeds(entityId: string): Needs | null {
    return getNeeds(this.db, entityId);
  }

  restoreNeed(entityId: string, need: NeedKey, amount: number, note?: string): void {
    restoreNeed(this.db, this.bus, entityId, need, amount, this.tick, note);
  }

  // --- Skills (§13.2) ---

  ensureSkill(entityId: string, skill: string): void {
    ensureSkill(this.db, entityId, skill);
  }

  getSkillXp(entityId: string, skill: string): number {
    return getXp(this.db, entityId, skill);
  }

  getSkillLevel(entityId: string, skill: string): number {
    return getLevel(this.db, entityId, skill);
  }

  getSkillSuccessChance(entityId: string, skill: string): number {
    return getSuccessChance(this.db, entityId, skill);
  }

  addSkillXp(entityId: string, skill: string, amount: number): void {
    addXp(this.db, entityId, skill, amount);
  }

  // --- Gear (§6, §14.2) ---

  equipItem(entityId: string, itemId: string): void {
    equipItem(this.db, this.bus, entityId, itemId, this.tick);
  }

  getWornGear(entityId: string): WornGear[] {
    return getWornGear(this.db, entityId);
  }

  wearGear(entityId: string, slot: WornGear['slot'], amount: number): void {
    wearGear(this.db, this.bus, entityId, slot, amount, this.tick);
  }

  // --- Market (§Stage 2) ---

  seedMarketListing(siteId: string, goodType: string, price: number, quantity: number): void {
    seedListing(this.db, siteId, goodType, price, quantity);
  }

  getMarketListing(siteId: string, goodType: string): MarketListing | null {
    return getListing(this.db, siteId, goodType);
  }

  listMarketListings(siteId: string): MarketListing[] {
    return listListingsForSite(this.db, siteId);
  }

  decrementMarketStock(siteId: string, goodType: string, quantity: number): void {
    decrementStock(this.db, siteId, goodType, quantity);
  }

  // --- Companies & jobs (§9, §Stage 3) ---

  // A company is also an entities row (its own wallet/inventory owner),
  // same as a person — see companies/companies.ts's header comment.
  createCompany(company: Company): void {
    this.createEntity(company.id, company.name);
    createCompany(this.db, company);
    this.ensureWallet(company.id);
  }

  getCompany(id: string): Company | null {
    return getCompany(this.db, id);
  }

  createJobSlot(params: CreateJobSlotParams): void {
    createJobSlot(this.db, params);
  }

  listJobOpenings(): JobSlot[] {
    return listJobOpenings(this.db);
  }

  getEmployment(entityId: string): Employment | null {
    return getActiveEmployment(this.db, entityId);
  }

  applyForJob(entityId: string, jobSlotId: string, options: { haggle: boolean }): ApplyResult {
    return applyForJob(this.db, this.bus, entityId, jobSlotId, this.tick, options, () => this.nextRandom());
  }

  quitJob(entityId: string): void {
    quitJob(this.db, this.bus, entityId, this.tick);
  }

  // --- Inventory capacity (§14.2) ---

  getCarriedWeightKg(containerId: string): number {
    return getCarriedWeightKg(this.db, containerId);
  }

  canCarry(containerId: string, additionalWeightKg: number): boolean {
    return canCarry(this.db, containerId, additionalWeightKg);
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
