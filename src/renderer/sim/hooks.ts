import { useCallback, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import { deriveCalendar, type Calendar } from '../../shared/gameRules';
import { ViewFetcher, type SimulationClient, type SimulationState } from './client';
import { SimulationContext, type SimulationContextValue } from './context';
import type { ParamsOf, ResultOf, ViewName } from '../../shared/protocol';

export function useSimulation(): SimulationContextValue {
  const value = useContext(SimulationContext);
  if (!value) throw new Error('useSimulation outside SimulationProvider');
  return value;
}

// One piece of what the simulation has pushed (the session, the clock,
// change counters). The component re-renders only when that piece changes —
// so the app shell doesn't redraw on every batch of ticks, only the HUD and
// whatever shows the time. `select` must return a primitive or an object
// held in the state (not a new one per call).
export function useSimulationValue<T>(select: (state: SimulationState) => T): T {
  const { store } = useSimulation();
  return useSyncExternalStore(store.subscribe, () => select(store.getState()));
}

export const useCalendar = (): Calendar | null => useSimulationValue((s) => s.calendar);

// Turns ticks into calendar dates for this world (log timestamps, hire dates).
export function useCalendarAt(): (tick: number) => Calendar {
  const start = useSimulationValue((s) => s.session?.startSeasonIndex ?? 0);
  return useCallback((tick: number) => deriveCalendar(tick, start), [start]);
}

// Sends one of the player's commands. Errors come back to the caller with
// the simulation's message ("You need 40 more coin…").
export function useCommand(): SimulationClient['request'] {
  const { client } = useSimulation();
  return useCallback<SimulationClient['request']>(
    (method, ...params) => client.request(method, ...params),
    [client],
  );
}

export interface ViewResult<T> {
  data: T | undefined;
  error: string | null;
}

// A screen's live snapshot: fetched when the screen (or its parameters)
// appear, and again whenever the simulation reports a change in a domain
// the view depends on (shared/protocol.ts's VIEW_DOMAINS). Views without
// parameters take `undefined`. `keepPrevious`: while new parameters load,
// keep showing the last snapshot — for forms whose parameters change as the
// player types — instead of nothing.
export function useView<V extends ViewName>(
  view: V,
  params: ParamsOf<V>,
  options: { enabled?: boolean; keepPrevious?: boolean } = {},
): ViewResult<ResultOf<V>> {
  const { client, store } = useSimulation();
  const enabled = options.enabled ?? true;
  const paramsJson = JSON.stringify(params ?? null);
  const key = `${view}:${paramsJson}`;
  const version = useSyncExternalStore(store.subscribe, () => store.viewVersion(view));
  const [fetcher] = useState(() => new ViewFetcher<ResultOf<V>>(client));
  const snapshot = useSyncExternalStore(fetcher.subscribe, fetcher.getSnapshot);

  useEffect(() => {
    if (!enabled) return;
    fetcher.load(key, view, JSON.parse(paramsJson));
  }, [fetcher, key, view, paramsJson, version, enabled]);
  useEffect(() => () => fetcher.stop(), [fetcher]);

  return {
    data: snapshot.key === key || (options.keepPrevious && snapshot.key !== null) ? snapshot.data : undefined,
    error: snapshot.error?.key === key ? snapshot.error.message : null,
  };
}
