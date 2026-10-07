import { observeQueries } from '../db/sqlite';
import type { BindParams, Database } from '../db/sqlite';

// A measurement tool, not simulation logic: observes one Database's
// queries (db/sqlite.ts's queryRows) and wraps its run() so every statement
// the engine issues is timed and counted,
// keyed by its normalized SQL text. Used by the long-run performance harness
// (perf/longRun.ts) to answer "which queries get slower as history grows"
// with numbers instead of guesses. Pure TypeScript + `performance.now()`
// (available in Node and browsers alike), so it stays engine-safe — but
// nothing in the engine itself installs it; only measurement code does.
export interface SqlStat {
  sql: string;
  calls: number;
  totalMs: number;
}

export interface SqlProfiler {
  // Stats accumulated since the last reset(), most expensive first.
  snapshot(): SqlStat[];
  reset(): void;
  // Restores the Database's original methods.
  detach(): void;
}

function normalize(sql: string): string {
  const flat = sql.replace(/\s+/g, ' ').trim();
  return flat.length > 160 ? `${flat.slice(0, 157)}...` : flat;
}

export function attachSqlProfiler(db: Database): SqlProfiler {
  const stats = new Map<string, SqlStat>();
  // Normalizing the same literal SQL string over and over is itself a real
  // cost at millions of calls — memoize by the raw string's identity.
  const keyCache = new Map<string, string>();

  const record = (sql: string, ms: number): void => {
    let key = keyCache.get(sql);
    if (key === undefined) {
      key = normalize(sql);
      keyCache.set(sql, key);
    }
    let stat = stats.get(key);
    if (!stat) {
      stat = { sql: key, calls: 0, totalMs: 0 };
      stats.set(key, stat);
    }
    stat.calls++;
    stat.totalMs += ms;
  };

  // eslint-disable-next-line @typescript-eslint/unbound-method -- re-bound explicitly below
  const originalRun = db.run;

  observeQueries(db, record);
  db.run = (sql: string, params?: BindParams): void => {
    const start = performance.now();
    try {
      originalRun.call(db, sql, params);
    } finally {
      record(sql, performance.now() - start);
    }
  };

  return {
    snapshot: () => [...stats.values()].sort((a, b) => b.totalMs - a.totalMs).map((s) => ({ ...s })),
    reset: () => stats.clear(),
    detach: () => {
      observeQueries(db, null);
      // The class method again, rather than an own-property copy of it.
      delete (db as { run?: unknown }).run;
      if (db.run !== originalRun) db.run = originalRun;
    },
  };
}
