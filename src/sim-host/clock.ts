import type { Speed } from '../shared/protocol';

// The game clock, owned by the simulation process (MigrationPlan.md Phase 6).
// Real time only decides *when* the next batch of ticks runs; what a batch
// does depends on game ticks alone, so the world is the same however the
// ticks were split into batches (engine.test.ts's batching test).
//
// Pacing is unchanged from the browser version (hooks/useGameClock.ts):
// every 200 ms of real time, 5 in-game minutes at 1×, 20 at 4×, 80 at 16× —
// a day passes in about 8 real minutes at 1×. Batches are due on a fixed
// 200 ms grid, like the browser's setInterval, so timer granularity (about
// 16 ms on Windows) doesn't slowly stretch every interval. If a batch
// overruns (a busy day boundary) the next starts as soon as it finishes; if
// the clock falls far behind it re-anchors rather than racing to catch up.

export const BATCH_INTERVAL_MS = 200;
export const BASE_TICKS_PER_BATCH = 5;

export interface Timers {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  now(): number;
}

export const realTimers: Timers = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  now: () => performance.now(),
};

export class SimulationClock {
  private current: Speed = 'paused';
  private handle: unknown = null;
  // When the next batch is due, on the clock's 200 ms grid.
  private dueAt = 0;

  // `advance` runs one batch of that many in-game minutes.
  private readonly advance: (ticks: number) => void;
  private readonly timers: Timers;

  constructor(advance: (ticks: number) => void, timers: Timers = realTimers) {
    this.advance = advance;
    this.timers = timers;
  }

  get speed(): Speed {
    return this.current;
  }

  setSpeed(speed: Speed): void {
    this.current = speed;
    if (speed === 'paused') this.cancel();
    else if (this.handle === null) {
      this.dueAt = this.timers.now() + BATCH_INTERVAL_MS;
      this.schedule(BATCH_INTERVAL_MS);
    }
  }

  stop(): void {
    this.setSpeed('paused');
  }

  private cancel(): void {
    if (this.handle !== null) this.timers.clearTimeout(this.handle);
    this.handle = null;
  }

  private schedule(delayMs: number): void {
    this.handle = this.timers.setTimeout(() => this.tick(), delayMs);
  }

  private tick(): void {
    this.handle = null;
    const speed = this.current;
    if (speed === 'paused') return;
    try {
      this.advance(BASE_TICKS_PER_BATCH * speed);
    } catch {
      // advance() reports its own failure; a failed batch stops the clock.
      this.current = 'paused';
      return;
    }
    if (this.current === 'paused' || this.handle !== null) return;
    const now = this.timers.now();
    this.dueAt += BATCH_INTERVAL_MS;
    if (this.dueAt < now - BATCH_INTERVAL_MS) this.dueAt = now;
    this.schedule(Math.max(0, this.dueAt - now));
  }
}
