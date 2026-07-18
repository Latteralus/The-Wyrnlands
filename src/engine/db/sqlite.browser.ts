// Pinned to the explicit subpath rather than the bare "sql.js" specifier:
// Vite's "browser" export condition resolves that to dist/sql-wasm-browser.js,
// whose companion binary is sql-wasm-browser.wasm — a second wasm file to keep
// in sync in public/. Importing the same build sqlite.node.ts uses means both
// platforms request the one file we actually ship (public/sql-wasm.wasm).
import initSqlJs, { type SqlJsStatic } from 'sql.js/dist/sql-wasm.js';

let sqlJsPromise: Promise<SqlJsStatic> | null = null;

export function loadSqlJs(): Promise<SqlJsStatic> {
  if (!sqlJsPromise) {
    sqlJsPromise = initSqlJs({ locateFile: (file) => `/${file}` });
  }
  return sqlJsPromise;
}

// KNOWN GAP, do not use yet: this does NOT currently return a genuinely
// fresh WASM instance, and checkpoint.ts's whole fix depends on getting one
// — see sqlite.node.ts's loadFreshSqlJs() for the full mechanism and how it
// was confirmed there. sql.js's own bundled code caches its module promise
// in a variable scoped to *that module's own top level*
// (`initSqlJsPromise` in sql-wasm.js) — calling this imported `initSqlJs`
// binding again just returns the original instance, confirmed empirically
// on the Node side by comparing `SQL.Database` object identity across two
// calls (identical both times). The Node fix (dropping the CJS require
// cache and re-requiring) has no browser equivalent — ES module imports
// don't have an invalidatable cache the same way. A real browser fix likely
// needs a genuine dynamic `import()` with a cache-busting query against a
// separately-fetchable chunk (Vite code-splits real dynamic imports, unlike
// this static one), verified in an actual browser — not attempted here.
// Long real play sessions in one tab are exposed to the same WASM memory
// ceiling as the headless runs this fixed until this is solved; treat as a
// follow-up, not silently assumed fixed just because the Node side is.
export function loadFreshSqlJs(): Promise<SqlJsStatic> {
  return initSqlJs({ locateFile: (file) => `/${file}` });
}
