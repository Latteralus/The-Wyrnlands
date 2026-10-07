import { describe, expect, it } from 'vitest';
import { BATCH_INTERVAL_MS, SimulationClock } from './clock';
import { ManualTimers } from './testing/testHost';

describe('simulation clock pacing', () => {
  it('runs 5 in-game minutes per batch at 1×, scaled by speed, every 200 ms', () => {
    const timers = new ManualTimers();
    const batches: number[] = [];
    const clock = new SimulationClock((ticks) => batches.push(ticks), timers);
    clock.setSpeed(1);
    timers.advance(BATCH_INTERVAL_MS * 3);
    clock.setSpeed(16);
    timers.advance(BATCH_INTERVAL_MS * 2);
    clock.setSpeed('paused');
    timers.advance(BATCH_INTERVAL_MS * 10);
    expect(batches).toEqual([5, 5, 5, 80, 80]);
  });

  it('keeps to the 200 ms grid when batches take time, so a second of play is five batches', () => {
    const timers = new ManualTimers();
    let batches = 0;
    const clock = new SimulationClock(() => {
      batches++;
      timers.spend(150); // each batch costs 150 ms of real time
    }, timers);
    clock.setSpeed(4);
    timers.advance(5 * BATCH_INTERVAL_MS);
    expect(batches).toBe(5);
  });

  it('after an overrun, runs the next batch at once — without a burst to catch up', () => {
    const timers = new ManualTimers();
    const startedAt: number[] = [];
    const clock = new SimulationClock(() => {
      startedAt.push(timers.now());
      timers.spend(startedAt.length === 1 ? 1000 : 10); // one very slow batch
    }, timers);
    clock.setSpeed(16);
    timers.advance(2000);
    expect(startedAt.slice(0, 3)).toEqual([200, 1200, 1400]);
  });

  it('stops after a failed batch', () => {
    const timers = new ManualTimers();
    let calls = 0;
    const clock = new SimulationClock(() => {
      calls++;
      throw new Error('boom');
    }, timers);
    clock.setSpeed(4);
    timers.advance(BATCH_INTERVAL_MS * 5);
    expect(calls).toBe(1);
    expect(clock.speed).toBe('paused');
  });
});
