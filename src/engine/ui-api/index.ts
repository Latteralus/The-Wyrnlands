import type { QueuedAction } from '../actions/types';
import type { Engine } from '../engine';
import type { EngineEvent, EventScope } from '../eventBus';
import type { Calendar } from '../time/clock';
import type { Site } from '../world/sites';

export type { EngineEvent, EventScope, QueuedAction, Calendar, Site };
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
  getActorActions(actorId: string): QueuedAction[];
  interruptAction(actorId: string): void;
  getBalance(ownerId: string): number;
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
    getActorActions: (actorId) => engine.getActorActions(actorId),
    interruptAction: (actorId) => engine.interruptAction(actorId),
    getBalance: (ownerId) => engine.getBalance(ownerId),
  };
}
