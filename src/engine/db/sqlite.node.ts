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
// This matters because each WASM instance's linear memory only ever grows
// and is never reclaimed by the runtime — see checkpoint.ts's header
// comment for the full mechanism. This is what actually lets a long-running
// simulation escape accumulated heap damage; without it, checkpoint.ts's
// export/rehydrate cycle preserves state correctly (proven in
// checkpoint.test.ts) but doesn't fix the underlying memory problem at all,
// since "fresh" Database objects built this way were still sharing the one
// real heap.
//
// Node/CJS-only — there's no browser-side equivalent of require-cache
// invalidation for a statically-imported ES module (see sqlite.browser.ts's
// loadFreshSqlJs, which is NOT yet proven to give a genuinely fresh
// instance — that's a separate, open problem). Only checkpoint.ts's
// rehydration cycle should call this, and only occasionally: it recompiles
// the wasm binary, which isn't free.
export async function loadFreshSqlJs(): Promise<SqlJsStatic> {
  const resolved = nodeRequire.resolve('sql.js');
  delete nodeRequire.cache[resolved];
  const freshInitSqlJs = nodeRequire(resolved) as typeof initSqlJs;
  return freshInitSqlJs({ locateFile: locateWasm });
}
