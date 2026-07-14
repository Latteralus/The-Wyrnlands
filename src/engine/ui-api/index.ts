import type { Engine } from '../engine';
import type { EngineEvent, EventScope } from '../eventBus';
import type { Calendar } from '../time/clock';

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
}

export function createUiApi(engine: Engine): UiApi {
  return {
    getTick: () => engine.tick,
    getCalendar: () => engine.calendar,
    advanceTicks: (count) => engine.advanceTicks(count),
    queryLog: (scope, limit) => engine.queryLog(scope, limit),
    subscribe: (listener) => engine.bus.subscribe(listener),
  };
}
