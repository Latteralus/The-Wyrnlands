import type { BindParams, Database, SqlJsStatic, SqlValue } from 'sql.js';

export type { BindParams, Database, SqlJsStatic, SqlValue };

export function createDatabase(SQL: SqlJsStatic, bytes?: Uint8Array): Database {
  return new SQL.Database(bytes);
}

export function exportDatabase(db: Database): Uint8Array {
  return db.export();
}

// Measurement hook (perf/sqlProfiler.ts) — an observer per Database, absent
// in normal play. A WeakMap rather than a field on the Database so nothing
// here changes sql.js's own object shape.
type QueryObserver = (sql: string, ms: number) => void;
const queryObservers = new WeakMap<Database, QueryObserver>();

export function observeQueries(db: Database, observer: QueryObserver | null): void {
  if (observer) queryObservers.set(db, observer);
  else queryObservers.delete(db);
}

// Every SELECT in the engine goes through here. Deliberately built on
// prepare/step/free, NEVER sql.js's db.exec():
//
// sql.js 1.14.1's Database.prototype.exec() does `stackAlloc(4)` for its
// pzTail out-parameter with no matching stackSave()/stackRestore(), so every
// exec() call permanently consumes 16 bytes (stack-aligned) of the WASM
// module's fixed 5 MB stack. After ~327,680 calls the stack pointer runs off
// the end of the stack region and the module dies — "memory access out of
// bounds" in the release build, "Aborted(stack overflow ...)" in sql.js's
// own debug build. Confirmed empirically (2026-10-06, see
// PERFORMANCE_AUDIT.md): a bare loop of db.exec('SELECT 1') fails at
// exactly 328,904 calls in the release build and 327,481 in the debug
// build, while the identical query through prepare/step/free survives
// 3,000,000 calls untouched. prepare() passes its SQL through Emscripten's
// ccall, which does restore the stack.
//
// That one leak was the entire "sql.js memory ceiling" this project fought
// from Stage 2 through Stage 5 (reduced exit tests, then checkpoint/
// rehydration to get a fresh WASM module before the stack ran out) — it
// tracked "distinct operation volume" because it was literally a per-call
// counter. db.run() with params also goes through prepare() and is safe;
// db.run() without params uses sqlite3_exec via ccall and is safe too.
export function queryRows(db: Database, sql: string, params?: BindParams): SqlValue[][] {
  const observer = queryObservers.get(db);
  const start = observer ? performance.now() : 0;
  const stmt = db.prepare(sql);
  const rows: SqlValue[][] = [];
  try {
    if (params !== undefined) stmt.bind(params);
    while (stmt.step()) rows.push(stmt.get());
  } finally {
    stmt.free();
  }
  if (observer) observer(sql, performance.now() - start);
  return rows;
}

export function queryRow(db: Database, sql: string, params?: BindParams): SqlValue[] | undefined {
  return queryRows(db, sql, params)[0];
}
