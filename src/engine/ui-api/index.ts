import type { QueuedAction } from '../actions/types';
import type { Company, LedgerSummary } from '../companies/companies';
import type { FoundingPlan, FoundingResult, StartupOutlay } from '../companies/founding';
import type { Engine } from '../engine';
import type { Entity } from '../entities';
import type { EngineEvent, EventScope } from '../eventBus';
import type { WornGear } from '../gear/gear';
import type { GearSlot } from '../goods/catalog';
import type { ApplyResult, Employment, JobSlot } from '../jobs/jobs';
import type { MarketActivity, MarketActivityFilter, MarketActivityKind } from '../market/activity';
import type {
  MarketOverview,
  MarketGood,
  MarketSeller,
  MarketPackLine,
  PersonalMarketListing,
  MarketHistoryPoint,
} from '../market/dashboard';
import type { MarketListing } from '../market/market';
import type { MarketTradeRequest, MarketTradeKind } from '../market/playerTrade';
import type { Needs } from '../needs/needs';
import type { RoutinePreferences } from '../player/preferences';
import type { PlayerProfile, PlayerHome } from '../player/profile';
import type { Household } from '../population/households';
import type { PresentEntity } from '../population/presence';
import type {
  BusinessProfile,
  CompanyRole,
  HouseholdMember,
  HouseholdProfile,
  InventoryLine,
  JobRecord,
  PersonProfile,
  Relation,
  StaffMember,
  WealthBand,
} from '../reports/profiles';
import type { SkillRecord } from '../skills/skills';
import type { Calendar } from '../time/clock';
import type { Site } from '../world/sites';
import type { TenureKind } from '../world/tenure';

export type {
  MarketActivity,
  MarketActivityFilter,
  MarketActivityKind,
  MarketOverview,
  MarketGood,
  MarketSeller,
  MarketPackLine,
  PersonalMarketListing,
  MarketHistoryPoint,
  MarketTradeRequest,
  MarketTradeKind,
  BusinessProfile,
  CompanyRole,
  HouseholdMember,
  HouseholdProfile,
  InventoryLine,
  JobRecord,
  PersonProfile,
  Relation,
  SkillRecord,
  StaffMember,
  WealthBand,
  EngineEvent,
  EventScope,
  QueuedAction,
  Calendar,
  Site,
  Needs,
  WornGear,
  MarketListing,
  JobSlot,
  Employment,
  ApplyResult,
  Entity,
  Household,
  PresentEntity,
  Company,
  LedgerSummary,
};
export { MINUTES_PER_DAY } from '../time/clock';
export { actionLabel } from '../market/playerTrade';

/**
 * The only surface React is allowed to touch. Screens call this instead of
 * reaching into Engine/db directly, so the engine stays swappable/testable
 * and React state always derives from engine queries (MASTERPLAN.md §4.2).
 */
export type { NewGameConfig, StartingItem } from '../player/newGame';
export type {
  RoutinePreferences,
  PlayerProfile,
  PlayerHome,
  FoundingResult,
  StartupOutlay,
  GearSlot,
  TenureKind,
};
export { IMPLEMENTED_SKILLS, MAX_SKILL_LEVEL, getXpForSkillLevel } from '../skills/skills';
export { listGoodDefinitions } from '../goods/catalog';

export interface UiApi {
  getPlayerEntityId(): string;
  isPlayerControlled(entityId: string): boolean;
  getPlayerProfile(): PlayerProfile;
  getPlayerHome(): PlayerHome;
  getPlayerRoutinePreferences(): RoutinePreferences;
  setPlayerRoutinePreferences(prefs: RoutinePreferences): void;
  equipPlayerItem(itemId: string): void;
  unequipPlayerSlot(slot: GearSlot): void;
  listBusinessTypes(): ReturnType<Engine['listBusinessTypes']>;
  estimatePlayerBusinessStartup(
    typeId: string,
    siteId: string,
    tenure: TenureKind,
    inputs: number,
  ): StartupOutlay | null;
  foundPlayerCompany(plan: Omit<FoundingPlan, 'founderId' | 'payerId'>): FoundingResult;
  getTick(): number;
  getCalendar(): Calendar;
  advanceTicks(count: number): void;
  queryLog(scope: EventScope, limit?: number): EngineEvent[];
  subscribe(listener: (event: EngineEvent) => void): () => void;
  listSites(): Site[];
  getSite(id: string): Site | null;
  queueAction(actorId: string, type: string): number;
  getActiveActions(actorId: string): QueuedAction[];
  getCurrentAction(actorId: string): QueuedAction | null;
  interruptAction(actorId: string): void;
  getBalance(ownerId: string): number;
  getNeeds(entityId: string): Needs | null;
  getWornGear(entityId: string): WornGear[];
  listMarketListings(siteId: string): MarketListing[];
  getMarketOverview(siteId: string, actorId: string): MarketOverview;
  getMarketHistory(siteId: string, goodType: string, windowDays: number): MarketHistoryPoint[];
  queryMarketActivity(siteId: string, filter?: MarketActivityFilter): MarketActivity[];
  queueMarketTrade(actorId: string, request: MarketTradeRequest): number;
  listJobOpenings(): JobSlot[];
  getEmployment(entityId: string): Employment | null;
  applyForJob(entityId: string, jobSlotId: string, haggle: boolean): ApplyResult;
  quitJob(entityId: string): void;
  getSkillLevel(entityId: string, skill: string): number;
  getEntity(id: string): Entity | null;
  listHouseholds(): Household[];
  getHousehold(id: string): Household | null;
  listHouseholdMembers(householdId: string): string[];
  getHouseholdIdForMember(entityId: string): string | null;
  listPresentEntities(siteId: string): PresentEntity[];
  listCompanies(): Company[];
  getCompany(id: string): Company | null;
  listJobSlotsForCompany(companyId: string): JobSlot[];
  countActiveEmploymentsForSlot(jobSlotId: string): number;
  getCompanyLedgerSummary(companyId: string, sinceTick: number): LedgerSummary;
  queryActorLog(actorId: string, limit?: number): EngineEvent[];
  // Public history of a business founded during play (who, when, why) —
  // null for one that predates the game.
  getCompanyFounding(companyId: string): CompanyFounding | null;
  // Who works a parcel of land right now, or null if nobody holds it.
  getSiteHolder(siteId: string): SiteHolder | null;
  // Profiles (§11.2, §14.2): public knowledge at the top level, everything
  // else under `inspect` — the screens show that only in Inspect mode.
  getPersonProfile(entityId: string): PersonProfile;
  getHouseholdProfile(householdId: string): HouseholdProfile | null;
  getBusinessProfile(companyId: string): BusinessProfile | null;
  // The calendar date a tick falls on.
  getCalendarAt(tick: number): Calendar;
}

export interface CompanyFounding {
  founderId: string;
  founderName: string;
  foundedTick: number;
  reasons: string[];
}

export interface SiteHolder {
  holderId: string;
  holderName: string;
  kind: 'freehold' | 'lease';
}

export function createUiApi(engine: Engine): UiApi {
  return {
    getPlayerEntityId: () => engine.getPlayerEntityId(),
    isPlayerControlled: (id) => engine.isPlayerControlled(id),
    getPlayerProfile: () => engine.getPlayerProfile(),
    getPlayerHome: () => engine.getPlayerHome(),
    getPlayerRoutinePreferences: () => engine.getRoutinePreferences(),
    setPlayerRoutinePreferences: (prefs) => engine.setPlayerRoutinePreferences(prefs),
    equipPlayerItem: (id) => engine.equipPlayerItem(id),
    unequipPlayerSlot: (slot) => engine.unequipPlayerSlot(slot),
    listBusinessTypes: () => engine.listBusinessTypes(),
    estimatePlayerBusinessStartup: (typeId, siteId, tenure, inputs) =>
      engine.estimatePlayerBusinessStartup(typeId, siteId, tenure, inputs),
    foundPlayerCompany: (plan) => engine.foundPlayerCompany(plan),
    getTick: () => engine.tick,
    getCalendar: () => engine.calendar,
    advanceTicks: (count) => engine.advanceTicks(count),
    queryLog: (scope, limit) => engine.queryLog(scope, limit),
    subscribe: (listener) => engine.bus.subscribe(listener),
    listSites: () => engine.listSites(),
    getSite: (id) => engine.getSite(id),
    queueAction: (actorId, type) => engine.queueAction(actorId, type),
    getActiveActions: (actorId) => engine.getActiveActions(actorId),
    getCurrentAction: (actorId) => engine.getCurrentAction(actorId),
    interruptAction: (actorId) => engine.interruptAction(actorId),
    getBalance: (ownerId) => engine.getBalance(ownerId),
    getNeeds: (entityId) => engine.getNeeds(entityId),
    getWornGear: (entityId) => engine.getWornGear(entityId),
    listMarketListings: (siteId) => engine.listMarketListings(siteId),
    getMarketOverview: (siteId, actorId) => engine.getMarketOverview(siteId, actorId),
    getMarketHistory: (siteId, goodType, windowDays) => engine.getMarketHistory(siteId, goodType, windowDays),
    queryMarketActivity: (siteId, filter) => engine.queryMarketActivity(siteId, filter),
    queueMarketTrade: (actorId, request) => engine.queueMarketTrade(actorId, request),
    listJobOpenings: () => engine.listJobOpenings(),
    getEmployment: (entityId) => engine.getEmployment(entityId),
    applyForJob: (entityId, jobSlotId, haggle) => engine.applyForJob(entityId, jobSlotId, { haggle }),
    quitJob: (entityId) => engine.quitJob(entityId),
    getSkillLevel: (entityId, skill) => engine.getSkillLevel(entityId, skill),
    getEntity: (id) => engine.getEntity(id),
    listHouseholds: () => engine.listHouseholds(),
    getHousehold: (id) => engine.getHousehold(id),
    listHouseholdMembers: (householdId) => engine.listHouseholdMembers(householdId),
    getHouseholdIdForMember: (entityId) => engine.getHouseholdIdForMember(entityId),
    listPresentEntities: (siteId) => engine.listPresentEntities(siteId),
    listCompanies: () => engine.listCompanies(),
    getCompany: (id) => engine.getCompany(id),
    listJobSlotsForCompany: (companyId) => engine.listJobSlotsForCompany(companyId),
    countActiveEmploymentsForSlot: (jobSlotId) => engine.countActiveEmploymentsForSlot(jobSlotId),
    getCompanyLedgerSummary: (companyId, sinceTick) => engine.getCompanyLedgerSummary(companyId, sinceTick),
    queryActorLog: (actorId, limit) => engine.queryActorLog(actorId, limit),
    getCompanyFounding: (companyId) => {
      const record = engine.getCompanyFounding(companyId);
      if (!record) return null;
      const reasons = record.details?.reasons;
      return {
        founderId: record.founderId,
        founderName: engine.getEntity(record.founderId)?.name ?? record.founderId,
        foundedTick: record.tick,
        reasons: Array.isArray(reasons) ? reasons.map(String) : [],
      };
    },
    getSiteHolder: (siteId) => {
      const tenure = engine.getOpenSiteTenure(siteId);
      if (!tenure) return null;
      return {
        holderId: tenure.holderId,
        holderName: engine.getEntity(tenure.holderId)?.name ?? tenure.holderId,
        kind: tenure.kind,
      };
    },
    getPersonProfile: (entityId) => engine.getPersonProfile(entityId),
    getHouseholdProfile: (householdId) => engine.getHouseholdProfile(householdId),
    getBusinessProfile: (companyId) => engine.getBusinessProfile(companyId),
    getCalendarAt: (tick) => engine.calendarAt(tick),
  };
}
