import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadSqlJs } from '../../engine/db/sqlite.node';
import { RpcClient } from '../../shared/rpcClient';
import { serveConnection } from '../rpcServer';
import { SaveLibrary } from '../saveLibrary';
import { SimulationHost } from '../simulationHost';
import { SqlJsStorage, type GameStorage } from '../storage';
import { createMemoryPorts } from './memoryPorts';
import type { MethodName, ParamsOf, ResultOf, SimulationNotification } from '../../shared/protocol';
import type { Timers } from '../clock';

// Test support: a real SimulationHost over a temporary save directory, with
// a hand-driven clock, reached through the same RPC client the preload uses.

export class ManualTimers implements Timers {
  private time = 0;
  private nextId = 1;
  private readonly queue = new Map<number, { at: number; callback: () => void }>();

  setTimeout(callback: () => void, ms: number): unknown {
    const id = this.nextId++;
    this.queue.set(id, { at: this.time + ms, callback });
    return id;
  }

  clearTimeout(handle: unknown): void {
    this.queue.delete(handle as number);
  }

  now(): number {
    return this.time;
  }

  // Time passing inside a callback (a batch that takes real time to run),
  // without firing anything.
  spend(ms: number): void {
    this.time += ms;
  }

  // Moves time forward, running every timer that falls due (in order),
  // including ones scheduled by those timers.
  advance(ms: number): void {
    const target = this.time + ms;
    for (;;) {
      let next: [number, { at: number; callback: () => void }] | undefined;
      for (const entry of this.queue)
        if (entry[1].at <= target && (!next || entry[1].at < next[1].at)) next = entry;
      if (!next) break;
      this.queue.delete(next[0]);
      this.time = next[1].at;
      next[1].callback();
    }
    this.time = target;
  }
}

export interface TestConnection {
  request<M extends MethodName>(
    method: M,
    ...params: ParamsOf<M> extends void ? [] : [ParamsOf<M>]
  ): Promise<ResultOf<M>>;
  notifications: SimulationNotification[];
  close(): void;
  traffic: { toHost: number[]; toClient: number[] };
}

export interface TestHost {
  host: SimulationHost;
  library: SaveLibrary;
  timers: ManualTimers;
  dir: string;
  connect(): TestConnection;
  dispose(): void;
}

export const sqlJsStorage = async (): Promise<GameStorage> => new SqlJsStorage(await loadSqlJs());

export async function createTestHost(
  options: { dir?: string; storage?: GameStorage; clock?: () => Date; backupIntervalMs?: number } = {},
): Promise<TestHost> {
  const dir = options.dir ?? mkdtempSync(path.join(tmpdir(), 'wyrnlands-host-'));
  const library = new SaveLibrary(path.join(dir, 'saves'));
  const timers = new ManualTimers();
  let fakeNow = Date.UTC(2026, 9, 6, 12, 0, 0);
  const host = new SimulationHost({
    library,
    storage: options.storage ?? (await sqlJsStorage()),
    timers,
    // A wall clock that moves on with every call, so updatedAt orders saves.
    wallClock: options.clock ?? (() => new Date((fakeNow += 1000))),
    ...(options.backupIntervalMs === undefined ? {} : { backupIntervalMs: options.backupIntervalMs }),
  });
  return {
    host,
    library,
    timers,
    dir,
    connect() {
      const ports = createMemoryPorts();
      serveConnection(host, ports.host);
      const client = new RpcClient(ports.client);
      const notifications: SimulationNotification[] = [];
      client.onNotification((n) => notifications.push(n));
      return {
        request: ((method: MethodName, params?: unknown) =>
          client.request(method, params)) as TestConnection['request'],
        notifications,
        close: () => ports.client.close(),
        traffic: ports.traffic,
      };
    },
    dispose() {
      host.shutdown();
      // Retries: on Windows a just-closed file can stay locked for a moment
      // (antivirus scanning, the indexer).
      if (!options.dir) rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    },
  };
}

// Lets queued port deliveries (setImmediate) run.
export async function settle(rounds = 3): Promise<void> {
  for (let i = 0; i < rounds; i++) await new Promise((resolve) => setImmediate(resolve));
}

export const NEW_GAME = {
  world: { seed: 'host-test', startSeasonIndex: 0 },
  character: { firstName: 'Edda', lastName: 'Hale', preset: 'standard' as const },
};
