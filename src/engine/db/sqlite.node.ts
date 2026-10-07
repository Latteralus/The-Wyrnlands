import { createRequire } from 'node:module';
import path from 'node:path';
import initSqlJs, { type SqlJsStatic } from 'sql.js';

const nodeRequire = createRequire(import.meta.url);

let sqlJsPromise: Promise<SqlJsStatic> | null = null;

function locateWasm(file: string): string {
  const wasmDir = path.dirname(nodeRequire.resolve('sql.js'));
  return path.join(wasmDir, file);
}

export function loadSqlJs(): Promise<SqlJsStatic> {
  if (!sqlJsPromise) {
    sqlJsPromise = initSqlJs({ locateFile: locateWasm });
  }
  return sqlJsPromise;
}

// A genuinely new WASM module instance — not the memoized one loadSqlJs()
// returns, and NOT simply "call initSqlJs() again": sql.js's own bundled
// code (sql-wasm.js) caches its module promise in a variable scoped to that
// module's own top level (`initSqlJsPromise`), entirely independent of the
// memoization in this file — a second call through the same imported
// `initSqlJs` binding just returns the first instance. Confirmed
// empirically (not assumed): calling the static import twice yielded the
// identical `SQL.Database` class both times. The only way to get a real
// second instance is to force Node to re-evaluate sql.js's module body from
// scratch — drop it from the CJS require cache and require it again — which
// *was* confirmed to give a distinct `SQL` object and a distinct `Database`
// class, with the second instance staying fully healthy after the first was
// deliberately stress-filled.
//
// This used to be load-bearing for long runs (a fresh module reset the
// stack that sql.js's db.exec() leaked — see db/sqlite.ts and
// checkpoint.ts's header); since the engine stopped calling exec(), it's
// only needed for checkpoint.ts's save/reload-in-a-fresh-module facility.
//
// Node/CJS-only — there's no browser-side equivalent of require-cache
// invalidation for a statically-imported ES module (and since the desktop
// migration nothing runs the game in a browser). Only checkpoint.ts's
// rehydration cycle should call this, and only occasionally: it recompiles
// the wasm binary, which isn't free.
export async function loadFreshSqlJs(): Promise<SqlJsStatic> {
  const resolved = nodeRequire.resolve('sql.js');
  delete nodeRequire.cache[resolved];
  const freshInitSqlJs = nodeRequire(resolved) as typeof initSqlJs;
  return freshInitSqlJs({ locateFile: locateWasm });
}
