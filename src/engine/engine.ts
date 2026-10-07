import {
  enqueueAction,
  getCurrentAction,
  interruptCurrentAction,
  listActiveActions,
  listActorActions,
  listActorsWithDueActions,
  processActorActions,
} from './actions/actionQueue';
import { ActionRegistry } from './actions/registry';
import { runConservationAudit, type AuditResult } from './audit/conservationAudit';
import { getBusinessType, listBusinessTypes } from './companies/businessTypes';
import {
  closeCompany,
  createCompany,
  getCompany,
  listCompanies,
  setCompanyOwner,
  summarizeLedger,
  type Company,
  type LedgerSummary,
  type NewCompany,
} from './companies/companies';
import { applyCompanyDailyCadence, shutDownCompany } from './companies/decisions';
import {
  getFoundingRecord,
  foundCompany,
  estimateStartupOutlay,
  type FoundingRecord,
  type FoundingPlan,
  type StartupOutlay,
  type FoundingResult,
} from './companies/founding';
import { applyMigrations } from './db/migrationRunner';
import { exportDatabase, queryRow, queryRows } from './db/sqlite';
import {
  createEntity,
  getEntity,
  getPlayerEntityId,
  isPlayerControlled,
  type SimulationMode,
  type Entity,
} from './entities';
import { EventBus, type EngineEvent, type EventScope } from './eventBus';
import { equipItem, unequipItem, getWornGear, getWornItemInSlot, wearGear, type WornGear } from './gear/gear';
import { getGoodDefinition, type GearSlot } from './goods/catalog';
import { canCarry, getCarriedWeightKg } from './inventory/capacity';
import {
  destroyItem,
  getItem,
  getProvenanceChain,
  produceItem,
  transferItem,
  type ProduceItemParams,
} from './inventory/items';
import { applySpoilage } from './inventory/spoilage';
import { ensureWallet, faucetCoin, getBalance, sinkCoin, transferCoin } from './inventory/wallet';
import {
  applyForJob,
  countActiveEmploymentsForSlot,
  createJobSlot,
  getActiveEmployment,
  getJobSlot,
  listJobOpenings,
  listJobSlotsForCompany,
  quitJob,
  terminateAllEmploymentsForCompany,
  type ApplyForJobOptions,
  type ApplyResult,
  type CreateJobSlotParams,
  type Employment,
  type JobSlot,
  type QuitJobOptions,
} from './jobs/jobs';
import { createWorkShiftActionDefinition } from './jobs/shifts';
import { attachLogger, queryActorLog, queryLog } from './logs/logger';
import { queryMarketActivity, type MarketActivityFilter } from './market/activity';
import { getMarketHistory, getMarketOverview } from './market/dashboard';
import { recordMarketDay } from './market/history';
import {
  decrementStock,
  getListing,
  listListingsForSite,
  seedListing,
  type MarketListing,
} from './market/market';
import { applyMerchantTrade } from './market/merchant';
import { marketTradeType, registerPlayerMarketAction, type MarketTradeRequest } from './market/playerTrade';
import { driftMarketPrices } from './market/pricing';
import {
  ensureNeeds,
  getNeeds,
  registerCollapseRecoveryAction,
  restoreNeed,
  tickNeeds,
  type Needs,
  type NeedKey,
} from './needs/needs';
import { getRoutinePreferences, setRoutinePreferences, type RoutinePreferences } from './player/preferences';
import { getPlayerProfile, getPlayerHome } from './player/profile';
import {
  applyHouseholdDailyCadence,
  applyHouseholdMigrationWeeklyCadence,
  applyNpcJobSeekingWeeklyCadence,
  applyParishTitheWeeklyCadence,
  applyNpcLaborDailyCadence,
  applyWorkplaceExperienceWeeklyCadence,
} from './population/cadence';
import { applyEntrepreneurshipCadence, ENTREPRENEURSHIP_INTERVAL_DAYS } from './population/entrepreneurship';
import {
  addHouseholdMember,
  createHousehold,
  getHousehold,
  getHouseholdIdForMember,
  listHouseholdMembers,
  listHouseholds,
  type Household,
} from './population/households';
import { listPresentEntities, type PresentEntity } from './population/presence';
import { getRecipeForSkill } from './production/recipes';
import {
  getBusinessProfile,
  getHouseholdProfile,
  getPersonProfile,
  type BusinessProfile,
  type HouseholdProfile,
  type PersonProfile,
} from './reports/profiles';
import { createRng, hashSeed, type SeededRng } from './rng';
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
import { getOpenTenure, grantSiteTenure, type Tenure, type TenureKind } from './world/tenure';
import type { ActionDefinition, QueuedAction } from './actions/types';
import type { Database } from './db/sqlite';
import type { DestructionReason, Item, ProvenanceEvent } from './inventory/types';
import type { PhaseTimer } from './perf/phaseTimer';

// A body-slot garment needs at least this much warmth rating to count as
// protection from a winter chill (§6). Placeholder threshold alongside the
// needs decay constants in needs.ts.
const WARMTH_PROTECTION_THRESHOLD = 30;

// How often an idle autonomous character's routine is consulted — every ten
// in-game minutes, not every tick: plenty responsive for a day's rhythm, and
// a tenth of the queries.
const ROUTINE_INTERVAL_TICKS = 10;

// A routine's choice: an action type, or a shift at a job slot (the engine
// registers that slot's shift action if need be, and records the day).
export type RoutineChoice =
  { type: string; workShiftJobSlotId?: never } | { type?: never; workShiftJobSlotId: string };
export type RoutinePolicy = (
  engine: Engine,
  actorId: string,
  lastShiftDay: number | null,
) => RoutineChoice | null;

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
  private rng: SeededRng;
  private detachLogger: () => void;
  // Cached, not re-queried per call — see getStartSeasonIndex()'s comment.
  private startSeasonIndex: number | null = null;

  // Resumes the RNG from wherever it left off (world_meta.rng_state) rather
  // than always re-deriving it from the seed string — a brand-new world has
  // no saved state yet (the row doesn't exist until ensureWorldMeta below
  // inserts it), so this only ever takes effect for a DB that already has
  // one: a reload, or a checkpoint/rehydration cycle (checkpoint.ts). Without
  // this, either path would silently restart the draw sequence from the
  // beginning, breaking §4.2's "same DB + same seed = same result" guarantee
  // the moment any more ticks ran afterward — confirmed as a real, not just
  // theoretical, gap once checkpoint/rehydration made it load-bearing.
  private constructor(db: Database, seed: string) {
    this.db = db;
    const row = queryRow(db, 'SELECT rng_state FROM world_meta WHERE id = 1');
    const savedState = typeof row?.[0] === 'number' ? row[0] : null;
    this.rng = createRng(savedState ?? hashSeed(seed));
    this.detachLogger = attachLogger(db, this.bus);
    registerCollapseRecoveryAction(this.actions);
    for (const action of queryRows(
      db,
      "SELECT DISTINCT type FROM actions WHERE type LIKE 'market:%' AND status IN ('queued', 'in_progress')",
    )) {
      registerPlayerMarketAction(this.actions, String(action[0]));
    }
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

    // start_season_index defaults to 0 (spring) here — deliberately NOT
    // rolled at this layer. Engine.bootstrap() runs for every test and
    // caller in this codebase, most of which have nothing to do with §5.4's
    // rolled starting conditions and were written assuming a fixed,
    // predictable spring start (confirmed the hard way: rolling it here
    // broke five unrelated unit tests — needs.test.ts's winter-dependent
    // assertions, stage2/stage3's consumption-tracing scripts tuned for a
    // specific season, engine.test.ts's save/reload byte comparison). §5.4
    // is seed-layer content, same as every other roll in this family
    // (price level, harvest quality, business failure — see seed/
    // demoWorld.ts) — setStartSeasonIndex() below is how seed code opts in.
    this.db.run('INSERT INTO world_meta (id, tick, rng_seed, schema_version) VALUES (1, 0, ?, 1)', [seed]);
    this.bus.emit({
      tick: 0,
      scope: 'world',
      type: 'world.created',
      message: `World seeded with "${seed}".`,
    });
  }

  // §5.4: seed code's opt-in hook for rolling a starting season (see
  // seed/demoWorld.ts) — must be called before any calendar-dependent
  // behavior runs (ticks, needs decay), and before anything else reads
  // engine.calendar, since getStartSeasonIndex() below caches its result.
  setStartSeasonIndex(index: number): void {
    this.db.run('UPDATE world_meta SET start_season_index = ? WHERE id = 1', [index]);
    this.startSeasonIndex = index;
  }

  getPlayerProfile() {
    return getPlayerProfile(this.db, this.getPlayerEntityId());
  }

  getPlayerHome() {
    return getPlayerHome(this.db, this.getPlayerEntityId());
  }

  equipPlayerItem(itemId: string): void {
    equipItem(this.db, this.bus, this.getPlayerEntityId(), itemId, this.tick);
  }

  unequipPlayerSlot(slot: GearSlot): void {
    unequipItem(this.db, this.bus, this.getPlayerEntityId(), slot, this.tick);
  }

  listBusinessTypes() {
    return listBusinessTypes().map((type) => ({
      ...type,
      inputGood: getRecipeForSkill(type.skill)?.inputGood ?? null,
      minimumInputUnits: getRecipeForSkill(type.skill)?.inputUnits ?? 0,
    }));
  }

  estimatePlayerBusinessStartup(
    typeId: string,
    siteId: string,
    tenure: TenureKind,
    inputs: number,
  ): StartupOutlay | null {
    const type = getBusinessType(typeId);
    return type ? estimateStartupOutlay(this.db, type, siteId, tenure, inputs) : null;
  }

  foundPlayerCompany(plan: Omit<FoundingPlan, 'founderId' | 'payerId'>): FoundingResult {
    const type = getBusinessType(plan.businessTypeId);
    const recipe = type ? getRecipeForSkill(type.skill) : null;
    if (recipe?.inputGood) {
      const listing = getListing(this.db, 'market', recipe.inputGood);
      if (
        !Number.isSafeInteger(plan.initialInputUnits) ||
        plan.initialInputUnits < recipe.inputUnits ||
        !listing ||
        listing.quantity < plan.initialInputUnits
      )
        return {
          ok: false,
          reason: `Opening stock needs at least ${recipe.inputUnits} ${recipe.inputGood}; only ${listing?.quantity ?? 0} available.`,
        };
    }
    const playerId = this.getPlayerEntityId();
    const result = foundCompany(
      this.db,
      this.bus,
      { ...plan, founderId: playerId, payerId: playerId },
      this.tick,
    );
    if (result.ok) {
      this.bus.emit({
        tick: this.tick,
        scope: 'personal',
        actorId: playerId,
        type: 'player.business_founded',
        message: `You found ${plan.companyName}.`,
        data: { companyId: result.companyId },
      });
      if (plan.founderWorks) this.ensureWorkShiftAction(`${result.companyId}-${plan.businessTypeId}`);
    }
    return result;
  }

  getPlayerEntityId(): string {
    const id = getPlayerEntityId(this.db);
    if (!id) throw new Error('No controlled character in this world.');
    return id;
  }

  isPlayerControlled(entityId: string): boolean {
    return isPlayerControlled(this.db, entityId);
  }

  getRoutinePreferences(entityId = this.getPlayerEntityId()): RoutinePreferences {
    return getRoutinePreferences(this.db, entityId);
  }

  setPlayerRoutinePreferences(prefs: RoutinePreferences): void {
    setRoutinePreferences(this.db, this.getPlayerEntityId(), prefs);
  }

  get tick(): number {
    const row = queryRow(this.db, 'SELECT tick FROM world_meta WHERE id = 1');
    return Number(row?.[0] ?? 0);
  }

  // applyNeedsCadence below calls this every tick, and start_season_index
  // never changes after world creation (unlike tick itself) — after slice
  // 3's performance investigation into per-operation cost at scale, a
  // per-tick query for a value that's permanently fixed after
  // ensureWorldMeta runs is worth avoiding on principle, not just when
  // profiling proves it necessary. Lazy so it's safe to call before
  // ensureWorldMeta as well as after (both bootstrap and a reload/
  // rehydration path guarantee the row exists by the time anything
  // external can reach this method).
  getStartSeasonIndex(): number {
    if (this.startSeasonIndex === null) {
      const row = queryRow(this.db, 'SELECT start_season_index FROM world_meta WHERE id = 1');
      this.startSeasonIndex = Number(row?.[0] ?? 0);
    }
    return this.startSeasonIndex;
  }

  get calendar(): Calendar {
    return deriveCalendar(this.tick, this.getStartSeasonIndex());
  }

  // The date a past (or future) tick falls on — for "hired in spring of
  // year 1" lines in profiles and logs.
  calendarAt(tick: number): Calendar {
    return deriveCalendar(tick, this.getStartSeasonIndex());
  }

  // §5.4: a short, human-readable record of this world's rolled starting
  // scenario (season, price levels, harvest quality, any business already
  // failed) — set once by seed code (seed/demoWorld.ts) after rolling it,
  // read back by anything that wants to narrate "this village, this
  // season, this situation" (§14.4's First Hour). Reuses world_meta's own
  // scenario_roll column (migration 0001), unused until now.
  setScenarioRoll(summary: string): void {
    this.db.run('UPDATE world_meta SET scenario_roll = ? WHERE id = 1', [summary]);
  }

  getScenarioRoll(): string | null {
    const row = queryRow(this.db, 'SELECT scenario_roll FROM world_meta WHERE id = 1');
    return typeof row?.[0] === 'string' ? row[0] : null;
  }

  // Wrapped in one explicit transaction rather than leaving each tick's
  // writes as their own autocommit statement: sql.js's WASM heap doesn't
  // reclaim per-statement rollback-journal overhead between thousands of
  // individual autocommits, and a long headless run (this method is the
  // *only* thing that drives ticks — §Stage 2's 30-day exit scenario, later
  // Stage 4/5's 90-day/2-year runs) reliably exhausts it and crashes with
  // "out of memory" well under 100k ticks. One transaction per call fixes it
  // — confirmed empirically (30k ticks unwrapped: OOM; 43.2k wrapped: clean).
  //
  // A SAVEPOINT rather than BEGIN: on its own it is exactly a transaction
  // (committed when released), and inside a caller's transaction it nests —
  // so a caller can make several batches and commands one commit (a
  // file-backed database pays per commit; perf/longRun.ts's --commit day).
  // The whole batch still rolls back if any tick in it fails.
  advanceTicks(count: number): void {
    this.db.run('SAVEPOINT advance_ticks');
    try {
      for (let i = 0; i < count; i++) {
        this.stepOneTick();
      }
      // The RNG position commits with the ticks that consumed it, so a
      // database that is itself the save (a file-backed SQLite session)
      // always resumes the draw sequence exactly where its last committed
      // tick left it — even if the process dies before the next export.
      this.syncRngState();
      this.db.run('RELEASE advance_ticks');
    } catch (err) {
      // A sufficiently severe error (e.g. SQLite's own out-of-memory) can
      // force-abort the transaction itself, leaving nothing to roll back —
      // that secondary failure must not mask the original error, which is
      // the one worth seeing.
      try {
        this.db.run('ROLLBACK TO advance_ticks');
        this.db.run('RELEASE advance_ticks');
      } catch {
        // transaction already gone; original err is what matters
      }
      throw err;
    }
  }

  // Measurement hook (perf/longRun.ts) — null in normal play, in which case
  // timed() is a plain call. Not simulation state; never persisted.
  phaseTimer: PhaseTimer | null = null;

  private timed(phase: string, fn: () => void): void {
    if (!this.phaseTimer) {
      fn();
      return;
    }
    const start = performance.now();
    fn();
    this.phaseTimer.record(phase, performance.now() - start);
  }

  private stepOneTick(): void {
    const nextTick = this.tick + 1;
    this.db.run('UPDATE world_meta SET tick = ? WHERE id = 1', [nextTick]);
    this.timed('tick.needs', () => this.applyNeedsCadence(nextTick));
    this.timed('tick.actions', () => this.processActiveActions(nextTick));
    if (this.routinePolicy && nextTick % ROUTINE_INTERVAL_TICKS === 0) {
      this.timed('tick.routine', () => this.applyRoutines(nextTick));
    }

    // §4.2's staggered cadence: daily (household budgets) → weekly
    // (hiring/wages) → nightly (conservation audit). NPCs' entire economic
    // footprint (feeding, wages, skill gain, production) lives in these
    // coarse per-household/per-employment passes rather than the player's
    // per-tick action-queue machinery — see population/cadence.ts's header
    // comment for why that split is load-bearing, not cosmetic.
    if (nextTick % MINUTES_PER_DAY === 0) {
      const exposedToCold = deriveCalendar(nextTick, this.getStartSeasonIndex()).season === 'winter';

      // The day's economy, in the order goods actually move (2026-10-06
      // balancing pass): workers' shifts produce (workdays only) →
      // companies restock inputs, put the day's output on the market and
      // (weekly) pay owners → the merchant imports into shortages and buys
      // up gluts → prices drift toward the new stock levels → households
      // eat and heat from what's on the shelves → perishables spoil.
      this.timed('daily.labor', () => applyNpcLaborDailyCadence(this.db, this.bus, nextTick, this.rng));
      this.timed('daily.companies', () => applyCompanyDailyCadence(this.db, this.bus, nextTick));
      this.timed('daily.merchant', () => applyMerchantTrade(this.db, this.bus, nextTick));
      this.timed('daily.prices', () => {
        driftMarketPrices(this.db);
        recordMarketDay(this.db, nextTick);
      });
      this.timed('daily.households', () =>
        applyHouseholdDailyCadence(this.db, this.bus, nextTick, exposedToCold),
      );
      this.timed('daily.spoilage', () => applySpoilage(this.db, this.bus, nextTick));

      if ((nextTick / MINUTES_PER_DAY) % 7 === 0) {
        // People with savings weigh starting a business of their own
        // (population/entrepreneurship.ts) — before job-seeking, so a new
        // business's openings are there for this week's hiring pass.
        if ((nextTick / MINUTES_PER_DAY) % ENTREPRENEURSHIP_INTERVAL_DAYS === 0) {
          this.timed('fortnightly.entrepreneurship', () =>
            applyEntrepreneurshipCadence(this.db, this.bus, nextTick, this.rng),
          );
        }
        this.timed('weekly.experience', () => applyWorkplaceExperienceWeeklyCadence(this.db, nextTick));
        // §Stage 5: fills newly-opened job slots (company growth) and
        // realizes §10's "another member works" adaptation rung.
        this.timed('weekly.jobSeeking', () =>
          applyNpcJobSeekingWeeklyCadence(this.db, this.bus, nextTick, this.rng),
        );
        // §11.4 Migration — after job-seeking so a household about to
        // qualify gets this week's hiring pass first (migrate is the
        // ladder's last rung, after "another member works").
        this.timed('weekly.migration', () =>
          applyHouseholdMigrationWeeklyCadence(this.db, this.bus, nextTick, this.rng),
        );
        // §8.2: the parish's charity fund is replenished by tithes.
        this.timed('weekly.tithe', () => applyParishTitheWeeklyCadence(this.db, this.bus, nextTick));
      }
      this.timed('nightly.audit', () => runConservationAudit(this.db, this.bus, nextTick));
    }
  }

  // Only actors with an action starting or ending now — see
  // actionQueue.ts's listActorsWithDueActions.
  private processActiveActions(currentTick: number): void {
    for (const actorId of listActorsWithDueActions(this.db, currentTick)) {
      processActorActions(this.db, this.bus, this.actions, this.rng, actorId, currentTick);
    }
  }

  // Needs decay before actions resolve each tick, so an action that
  // completes this same tick sees the tick's own decay applied first.
  // Selects foreground simulation explicitly — confirmed empirically that this
  // per-tick, per-entity path cannot scale past a handful of entities (see
  // population/cadence.ts's header comment); NPCs' needs are handled by the
  // daily household cadence instead.
  private applyNeedsCadence(currentTick: number): void {
    const season = deriveCalendar(currentTick, this.getStartSeasonIndex()).season;
    const rows = queryRows(
      this.db,
      `SELECT entity_id FROM needs
       WHERE entity_id IN (SELECT id FROM entities WHERE simulation_mode = 'foreground')
       ORDER BY entity_id ASC`,
    );
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

  // --- Daily routines (autonomous characters) ---
  //
  // A character marked autonomous lives their day without every action
  // being queued by hand: whenever they're idle, the routine policy picks
  // what they do next (work their shift, eat, drink, sleep). The policy is
  // world content — it chooses among the seed's own action types, and seed
  // code registers it alongside them (seed/demoWorld.ts) — while which
  // characters are autonomous is saved world state (autonomous_actors).
  // Anything queued by hand runs first: the routine only acts when the
  // character has nothing to do.
  private routinePolicy: RoutinePolicy | null = null;

  setRoutinePolicy(policy: RoutinePolicy | null): void {
    this.routinePolicy = policy;
  }

  setAutonomous(entityId: string, autonomous: boolean): void {
    if (autonomous) this.db.run('INSERT OR IGNORE INTO autonomous_actors (entity_id) VALUES (?)', [entityId]);
    else this.db.run('DELETE FROM autonomous_actors WHERE entity_id = ?', [entityId]);
  }

  isAutonomous(entityId: string): boolean {
    return queryRow(this.db, 'SELECT 1 FROM autonomous_actors WHERE entity_id = ?', [entityId]) !== undefined;
  }

  // Shift actions exist per job slot; a business founded during play has
  // slots no seed code knew about, so they're registered when first needed.
  ensureWorkShiftAction(jobSlotId: string): string {
    const type = `work_shift_${jobSlotId}`;
    if (!this.actions.has(type)) {
      const slot = getJobSlot(this.db, jobSlotId);
      if (!slot) throw new Error(`Unknown job slot: "${jobSlotId}"`);
      this.actions.register(
        createWorkShiftActionDefinition(jobSlotId, { durationTicks: slot.shiftDurationTicks }),
      );
    }
    return type;
  }

  private applyRoutines(tick: number): void {
    const policy = this.routinePolicy;
    if (!policy) return;
    const rows = queryRows(
      this.db,
      'SELECT entity_id, last_shift_day FROM autonomous_actors ORDER BY entity_id',
    );
    for (const row of rows) {
      const actorId = String(row[0]);
      if (getCurrentAction(this.db, actorId)) continue;
      const lastShiftDay = row[1] === null ? null : Number(row[1]);
      const choice = policy(this, actorId, lastShiftDay);
      if (!choice) continue;
      let type: string;
      if (choice.workShiftJobSlotId !== undefined) {
        type = this.ensureWorkShiftAction(choice.workShiftJobSlotId);
        this.db.run('UPDATE autonomous_actors SET last_shift_day = ? WHERE entity_id = ?', [
          Math.floor(tick / MINUTES_PER_DAY),
          actorId,
        ]);
      } else {
        type = choice.type;
      }
      if (!this.actions.has(type)) continue;
      enqueueAction(this.db, this.actions, actorId, type, tick);
    }
  }

  createEntity(id: string, name: string): void {
    createEntity(this.db, id, name);
  }

  queueAction(actorId: string, type: string): number {
    registerPlayerMarketAction(this.actions, type);
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

  transferItem(
    itemId: string,
    toContainerId: string,
    options?: { actorId?: string; note?: string; scope?: EventScope },
  ): void {
    transferItem(this.db, this.bus, itemId, toContainerId, this.tick, options);
  }

  destroyItem(
    itemId: string,
    reason: DestructionReason,
    options?: { actorId?: string; note?: string; scope?: EventScope },
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

  faucetCoin(ownerId: string, amount: number, note?: string, scope?: EventScope): void {
    faucetCoin(this.db, this.bus, ownerId, amount, this.tick, note, scope);
  }

  sinkCoin(ownerId: string, amount: number, note?: string, scope?: EventScope): void {
    sinkCoin(this.db, this.bus, ownerId, amount, this.tick, note, scope);
  }

  transferCoin(
    fromOwnerId: string,
    toOwnerId: string,
    amount: number,
    note?: string,
    scope?: EventScope,
  ): void {
    transferCoin(this.db, this.bus, fromOwnerId, toOwnerId, amount, this.tick, note, scope);
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

  getMarketOverview(siteId: string, actorId: string) {
    return getMarketOverview(this.db, siteId, actorId);
  }

  getMarketHistory(siteId: string, goodType: string, windowDays: number) {
    return getMarketHistory(this.db, siteId, goodType, this.tick, windowDays);
  }

  queryMarketActivity(siteId: string, filter?: MarketActivityFilter) {
    return queryMarketActivity(this.db, siteId, filter);
  }

  queueMarketTrade(actorId: string, request: MarketTradeRequest): number {
    return this.queueAction(actorId, marketTradeType(request));
  }

  decrementMarketStock(siteId: string, goodType: string, quantity: number): void {
    decrementStock(this.db, siteId, goodType, quantity);
  }

  // --- Companies & jobs (§9, §Stage 3) ---

  // A company is also an entities row (its own wallet/inventory owner),
  // same as a person — see companies/companies.ts's header comment.
  createCompany(company: NewCompany): void {
    this.createEntity(company.id, company.name);
    createCompany(this.db, company);
    this.ensureWallet(company.id);
  }

  // Land a business already held before the game began (seed content) —
  // no payment, unlike a founding's acquireSiteTenure (world/tenure.ts).
  grantSiteTenure(siteId: string, holderId: string, kind: TenureKind = 'freehold'): void {
    grantSiteTenure(this.db, siteId, holderId, kind, this.tick);
  }

  getOpenSiteTenure(siteId: string): Tenure | null {
    return getOpenTenure(this.db, siteId);
  }

  // Why a business exists (companies/founding.ts's founding record), as
  // the town would tell it: who started it, when, and what they saw.
  getCompanyFounding(companyId: string): FoundingRecord | null {
    return getFoundingRecord(this.db, companyId);
  }

  // §11.2/§14.2 profiles (reports/profiles.ts) — read-only.
  getPersonProfile(entityId: string): PersonProfile {
    return getPersonProfile(this.db, entityId);
  }

  getHouseholdProfile(householdId: string): HouseholdProfile | null {
    return getHouseholdProfile(this.db, householdId);
  }

  getBusinessProfile(companyId: string): BusinessProfile | null {
    return getBusinessProfile(this.db, companyId, this.tick);
  }

  getCompany(id: string): Company | null {
    return getCompany(this.db, id);
  }

  listCompanies(): Company[] {
    return listCompanies(this.db);
  }

  // §9.2: assigns (or reassigns) a company's Management-skilled owner —
  // separate from createCompany because the owner is usually a distinct NPC
  // entity created afterward (see seed/demoWorld.ts).
  setCompanyOwner(companyId: string, ownerId: string): void {
    setCompanyOwner(this.db, companyId, ownerId);
  }

  getCompanyLedgerSummary(companyId: string, sinceTick: number): LedgerSummary {
    return summarizeLedger(this.db, companyId, sinceTick);
  }

  createJobSlot(params: CreateJobSlotParams): void {
    createJobSlot(this.db, params);
  }

  listJobOpenings(): JobSlot[] {
    return listJobOpenings(this.db);
  }

  // §14.2 "NPC business view": a company's job slots (title, wage band,
  // capacity) — unlike listJobOpenings(), includes a closed company's slots
  // too, since the business view still needs to show what it *used* to hire
  // for.
  listJobSlotsForCompany(companyId: string): JobSlot[] {
    return listJobSlotsForCompany(this.db, companyId);
  }

  countActiveEmploymentsForSlot(jobSlotId: string): number {
    return countActiveEmploymentsForSlot(this.db, jobSlotId);
  }

  getEmployment(entityId: string): Employment | null {
    return getActiveEmployment(this.db, entityId);
  }

  applyForJob(entityId: string, jobSlotId: string, options: ApplyForJobOptions): ApplyResult {
    return applyForJob(this.db, this.bus, entityId, jobSlotId, this.tick, options, () => this.nextRandom());
  }

  quitJob(entityId: string, options?: QuitJobOptions): void {
    quitJob(this.db, this.bus, entityId, this.tick, options);
  }

  // §9.6/§5.4: lets seed code (or anything else deciding a business's fate
  // outside the daily cadence's own tryCloseCompany) close a company for
  // good — used by seed/demoWorld.ts's rolled starting conditions ("one may
  // be freshly failed — the shuttered mill opening", §5.4) to seed a
  // company that's already closed before the game begins. Caller is
  // responsible for terminating employment first (below) — this only flips
  // the flag.
  closeCompany(companyId: string): void {
    closeCompany(this.db, companyId, this.tick);
  }

  // §9.6/§5.4: closes a business through the one real closure path
  // (companies/decisions.ts's shutDownCompany): workers let go, tools to
  // auction, stock spoiled, remaining cash back to the owner, land freed.
  // Seed content uses it for a business that failed before the game began.
  shutDownCompany(
    companyId: string,
    message: string,
    reason: 'insolvency' | 'wound_down' | 'failed_before_start' = 'failed_before_start',
  ): void {
    const company = getCompany(this.db, companyId);
    if (!company || company.closedAtTick !== null) return;
    shutDownCompany(this.db, this.bus, company, this.tick, { message, reason });
  }

  terminateAllEmploymentsForCompany(companyId: string, message: string): void {
    terminateAllEmploymentsForCompany(this.db, this.bus, companyId, this.tick, message);
  }

  // --- Population: households & NPCs (§10, §11, §Stage 4) ---

  // A household is also an entities row (its own wallet/inventory owner),
  // same as a company — see population/households.ts's header comment.
  createHousehold(household: Omit<Household, 'destituteSinceTick' | 'departedAtTick' | 'hungerDays'>): void {
    this.createEntity(household.id, household.name);
    createHousehold(this.db, household);
    this.ensureWallet(household.id);
  }

  getHousehold(id: string): Household | null {
    return getHousehold(this.db, id);
  }

  listHouseholds(): Household[] {
    return listHouseholds(this.db);
  }

  addHouseholdMember(
    householdId: string,
    entityId: string,
    mode: SimulationMode = isPlayerControlled(this.db, entityId) ? 'foreground' : 'background',
  ): void {
    addHouseholdMember(this.db, householdId, entityId, mode);
  }

  listHouseholdMembers(householdId: string): string[] {
    return listHouseholdMembers(this.db, householdId);
  }

  getHouseholdIdForMember(entityId: string): string | null {
    return getHouseholdIdForMember(this.db, entityId);
  }

  getEntity(id: string): Entity | null {
    return getEntity(this.db, id);
  }

  // §14.2 location panels' "presence roster" (§Stage 4's hourly version —
  // see population/presence.ts's header comment for why this is a
  // deterministic lookup, not simulated movement).
  listPresentEntities(siteId: string): PresentEntity[] {
    const hourOfDay = Math.floor(this.calendar.minuteOfDay / 60);
    return listPresentEntities(this.db, siteId, hourOfDay);
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

  // §14.3 business logs: one actor's whole visible history, across scopes.
  queryActorLog(actorId: string, limit = 100): EngineEvent[] {
    return queryActorLog(this.db, actorId, limit);
  }

  nextRandom(): number {
    return this.rng();
  }

  // Syncs the RNG's current state into world_meta first — a plain per-call
  // write, not a per-tick one, so this doesn't reintroduce the per-tick DB
  // write cost actionQueue.ts's progress_ticks fix just removed. Without
  // this, the exported bytes would resume (on rehydration) from whatever
  // rng_state was last written at *construction* time, not from here —
  // silently replaying draws that already happened.
  export(): Uint8Array {
    this.syncRngState();
    return exportDatabase(this.db);
  }

  // Writes the RNG's current position into world_meta.rng_state, so whatever
  // reads or copies the database next — an export, a file-backed save, a
  // state fingerprint — resumes the draw sequence from here.
  syncRngState(): void {
    this.db.run('UPDATE world_meta SET rng_state = ? WHERE id = 1', [this.rng.getState()]);
  }

  dispose(): void {
    this.detachLogger();
    this.db.close();
  }
}
