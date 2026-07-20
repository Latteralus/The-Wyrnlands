import type { QueuedAction } from '../actions/types';
import type { Company, LedgerSummary } from '../companies/companies';
import type { Engine } from '../engine';
import type { Entity } from '../entities';
import type { EngineEvent, EventScope } from '../eventBus';
import type { WornGear } from '../gear/gear';
import type { ApplyResult, Employment, JobSlot } from '../jobs/jobs';
import type { MarketListing } from '../market/market';
import type { Needs } from '../needs/needs';
import type { Household } from '../population/households';
import type { PresentEntity } from '../population/presence';
import type { Calendar } from '../time/clock';
import type { Site } from '../world/sites';

export type {
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

/**
 * The only surface React is allowed to touch. Screens call this instead of
 * reaching into Engine/db directly, so the engine stays swappable/testable
 * and React state always derives from engine queries (MASTERPLAN.md §4.2).
 */
export interface UiApi {
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
}

export function createUiApi(engine: Engine): UiApi {
  return {
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
  };
}
