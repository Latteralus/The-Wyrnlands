import { queryRow, queryRows } from '../db/sqlite';
import { createNewGame } from '../player/newGame';
import { runScriptedPlayerUntil } from '../scenarios/scriptedPlayer';
import { MINUTES_PER_DAY } from '../time/clock';
import type { Database } from '../db/sqlite';
import type { Engine } from '../engine';

// A platform-neutral benchmark of the real game workload, used to compare
// simulation hosts (MigrationPlan.md Phase 28): Node (perf/longRun.ts), a
// Chromium renderer (scripts/bench-renderer.mjs), and the Electron
// simulation process. Pure TypeScript — no Node or DOM APIs — so exactly the
// same code is timed everywhere; each host supplies the database and hashes
// canonicalState() with its own SHA-256.

// The logical-state fingerprint: wallets, every item, employment, companies,
// households, needs, skills, listings, row counts, RNG state. Not raw DB
// bytes, which legitimately differ between physical write histories (and
// between SQLite backends). perf/longRun.ts hashes the same string.
export const FINGERPRINT_QUERIES = [
  'SELECT owner_id, balance FROM wallets ORDER BY owner_id',
  'SELECT id, type, quality_tier, container_id, status, durability, destroyed_at_tick FROM items ORDER BY id',
  'SELECT entity_id, job_slot_id, wage, hired_at_tick, status, terminated_at_tick FROM employment ORDER BY id',
  'SELECT id, owner_id, insolvent_since_tick, tier, closed_at_tick FROM companies ORDER BY id',
  'SELECT id, destitute_since_tick, departed_at_tick FROM households ORDER BY id',
  'SELECT entity_id, ROUND(hunger, 6), ROUND(thirst, 6), ROUND(energy, 6), ROUND(warmth, 6) FROM needs ORDER BY entity_id',
  'SELECT entity_id, skill, xp FROM skills ORDER BY entity_id, skill',
  'SELECT site_id, good_type, price, quantity, producer_company_id FROM market_listings ORDER BY site_id, good_type',
  'SELECT (SELECT COUNT(*) FROM event_log), (SELECT COUNT(*) FROM provenance_events), (SELECT COUNT(*) FROM actions), (SELECT COUNT(*) FROM company_ledger_entries)',
  'SELECT tick, rng_state, goods_created, goods_destroyed, coin_faucet_total, coin_sink_total FROM world_meta',
  'SELECT id, current_site_id FROM entities ORDER BY id',
  'SELECT * FROM settlement_activity_state ORDER BY actor_id',
  'SELECT id, price_adjustment FROM market_listings ORDER BY id',
  "SELECT actor_id, type, status, started_at_tick, ends_at_tick, duration_ticks, payload FROM actions WHERE status IN ('queued', 'in_progress') ORDER BY actor_id, sequence",
] as const;

// Syncs the RNG state into world_meta first, so it is part of the state.
export function canonicalState(engine: Engine): string {
  engine.syncRngState();
  return FINGERPRINT_QUERIES.map((sql) => JSON.stringify(queryRows(engine.db, sql))).join('');
}

// The named-player world every comparison uses: the real New Game path.
export function createBenchmarkGame(db: Database, seed: string): Engine {
  return createNewGame(db, {
    world: { seed },
    character: { firstName: 'Edda', lastName: 'Hale', preset: 'standard' },
  });
}

export function databaseBytes(db: Database): number {
  const pages = Number(queryRow(db, 'PRAGMA page_count')?.[0] ?? 0);
  const pageSize = Number(queryRow(db, 'PRAGMA page_size')?.[0] ?? 0);
  return pages * pageSize;
}

export interface BenchmarkSample {
  day: number;
  // Wall-clock for the days since the previous sample.
  intervalMs: number;
  cumulativeMs: number;
  msPerSimDay: number;
  dbBytes: number;
  failedAudits: number;
}

// Runs the scripted player (or the world alone) through each day in
// `sampleDays` (ascending), timing each stretch.
export function runBenchmark(
  engine: Engine,
  options: { sampleDays: number[]; player: boolean; now: () => number },
  onSample?: (sample: BenchmarkSample) => void,
): BenchmarkSample[] {
  const samples: BenchmarkSample[] = [];
  const start = options.now();
  let previousDay = Math.floor(engine.tick / MINUTES_PER_DAY);
  for (const day of options.sampleDays) {
    const intervalStart = options.now();
    runScriptedPlayerUntil(engine, day * MINUTES_PER_DAY, { player: options.player });
    const end = options.now();
    const sample: BenchmarkSample = {
      day,
      intervalMs: Math.round(end - intervalStart),
      cumulativeMs: Math.round(end - start),
      msPerSimDay: Math.round((end - intervalStart) / Math.max(1, day - previousDay)),
      dbBytes: databaseBytes(engine.db),
      failedAudits: Number(queryRow(engine.db, 'SELECT COUNT(*) FROM audits WHERE passed = 0')?.[0] ?? 0),
    };
    previousDay = day;
    samples.push(sample);
    onSample?.(sample);
  }
  return samples;
}
