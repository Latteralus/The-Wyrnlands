import { ALL_DOMAINS, VIEW_DOMAINS } from '../../shared/protocol';
import type { Calendar } from '../../shared/gameRules';
import type {
  Domain,
  MethodName,
  ParamsOf,
  ResultOf,
  SessionInfo,
  SimulationNotification,
  Speed,
  ViewName,
  WyrnlandsBridge,
} from '../../shared/protocol';

// The renderer's side of the simulation protocol (shared/protocol.ts). The
// world runs in the simulation process; React only asks for snapshots,
// sends the player's commands, and listens for what changed. Nothing here
// advances time: the clock lives in the simulation process
// (MigrationPlan.md Phase 6).

export type RequestArgs<M extends MethodName> = ParamsOf<M> extends void ? [] : [ParamsOf<M>];

export class SimulationClient {
  private readonly bridge: WyrnlandsBridge;

  constructor(bridge: WyrnlandsBridge) {
    this.bridge = bridge;
  }

  request<M extends MethodName>(method: M, ...params: RequestArgs<M>): Promise<ResultOf<M>> {
    return this.bridge.request(method, params[0]) as Promise<ResultOf<M>>;
  }

  onNotification(listener: (notification: SimulationNotification) => void): () => void {
    return this.bridge.onNotification(listener);
  }

  exportSave() {
    return this.bridge.exportSave();
  }

  importSave() {
    return this.bridge.importSave();
  }
}

export function getBridge(): WyrnlandsBridge | null {
  return (globalThis as { wyrnlands?: WyrnlandsBridge }).wyrnlands ?? null;
}

// What the simulation has pushed: the session, the clock, and a version
// counter per change domain that views key their refreshes on.
export interface SimulationState {
  session: SessionInfo | null;
  tick: number;
  calendar: Calendar | null;
  speed: Speed;
  versions: Record<Domain, number>;
  // Bumped whenever the save list may have changed.
  savesVersion: number;
  // Bumped when a game starts or ends, so every view refetches.
  epoch: number;
  hostError: string | null;
}

export class SimulationStore {
  private state: SimulationState = {
    session: null,
    tick: 0,
    calendar: null,
    speed: 'paused',
    versions: { clock: 0, player: 0, market: 0, world: 0, logs: 0 },
    savesVersion: 0,
    epoch: 0,
    hostError: null,
  };
  private readonly listeners = new Set<() => void>();

  constructor(client: SimulationClient) {
    client.onNotification((notification) => this.receive(notification));
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getState = (): SimulationState => this.state;

  // A view's refresh key: changes when any domain it depends on does.
  viewVersion(view: ViewName): string {
    return `${this.state.epoch}:${VIEW_DOMAINS[view].map((d) => this.state.versions[d]).join('.')}`;
  }

  setSession(session: SessionInfo | null): void {
    this.update({
      session,
      tick: session?.tick ?? 0,
      calendar: session?.calendar ?? null,
      speed: session?.speed ?? 'paused',
      epoch: this.state.epoch + 1,
    });
  }

  clearHostError(): void {
    this.update({ hostError: null });
  }

  private receive(notification: SimulationNotification): void {
    switch (notification.type) {
      case 'simulation.updated': {
        const versions = { ...this.state.versions };
        for (const domain of notification.domains) versions[domain]++;
        this.update({ tick: notification.tick, calendar: notification.calendar, versions });
        break;
      }
      case 'clock.changed':
        this.update({ speed: notification.speed });
        break;
      case 'session.changed':
        this.setSession(notification.session);
        break;
      case 'saves.changed':
        this.update({ savesVersion: this.state.savesVersion + 1 });
        break;
      case 'host.error':
        this.update({ hostError: notification.message });
        break;
    }
  }

  // Everything is stale (e.g. after the window was reloaded).
  invalidateAll(): void {
    const versions = { ...this.state.versions };
    for (const domain of ALL_DOMAINS) versions[domain]++;
    this.update({ versions });
  }

  private update(changes: Partial<SimulationState>): void {
    this.state = { ...this.state, ...changes };
    for (const listener of this.listeners) listener();
  }
}

export interface ViewSnapshot<T> {
  key: string | null;
  data: T | undefined;
  error: { key: string; message: string } | null;
}

// Fetches one view for one component (hooks.ts's useView): at most one
// request in flight; changes that arrive meanwhile collapse into a single
// follow-up fetch, so a busy clock can't queue up stale requests or starve
// the view of fresh data. Lives outside React state so the in-flight
// bookkeeping never has to be read during render.
export class ViewFetcher<T> {
  private snapshot: ViewSnapshot<T> = { key: null, data: undefined, error: null };
  private target: { key: string; view: ViewName; params: unknown } | null = null;
  private inFlight = false;
  private again = false;
  private active = true;
  private readonly listeners = new Set<() => void>();
  private readonly client: SimulationClient;

  constructor(client: SimulationClient) {
    this.client = client;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): ViewSnapshot<T> => this.snapshot;

  load(key: string, view: ViewName, params: unknown): void {
    this.active = true;
    this.target = { key, view, params };
    this.fetch();
  }

  stop(): void {
    this.active = false;
  }

  private fetch(): void {
    if (this.inFlight) {
      this.again = true;
      return;
    }
    const target = this.target;
    if (!target) return;
    this.inFlight = true;
    (this.client.request as (method: ViewName, params?: unknown) => Promise<T>)(target.view, target.params)
      .then(
        (data) => {
          if (this.active && this.target?.key === target.key)
            this.publish({ ...this.snapshot, key: target.key, data, error: null });
        },
        (failure: unknown) => {
          if (this.active && this.target?.key === target.key)
            this.publish({
              ...this.snapshot,
              error: {
                key: target.key,
                message: failure instanceof Error ? failure.message : String(failure),
              },
            });
        },
      )
      .finally(() => {
        this.inFlight = false;
        if (this.again && this.active) {
          this.again = false;
          this.fetch();
        }
      });
  }

  private publish(snapshot: ViewSnapshot<T>): void {
    this.snapshot = snapshot;
    for (const listener of this.listeners) listener();
  }
}
