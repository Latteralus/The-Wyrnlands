// Pinned to the explicit subpath rather than the bare "sql.js" specifier:
// Vite's "browser" export condition resolves that to dist/sql-wasm-browser.js,
// whose companion binary is sql-wasm-browser.wasm; this build pairs with the
// sql-wasm.wasm that Node (sqlite.node.ts) loads too.
import initSqlJs, { type SqlJsStatic } from 'sql.js/dist/sql-wasm.js';

// Runs the engine on sql.js inside a web page. The game itself no longer
// does this — since the desktop migration the simulation runs in its own
// process (src/sim-host) — but the renderer benchmark
// (scripts/bench-renderer.mjs) still measures how the engine performs in a
// Chromium page, as it ran before. The .wasm is served straight from
// node_modules by the Vite dev server.
let sqlJsPromise: Promise<SqlJsStatic> | null = null;

export function loadSqlJs(): Promise<SqlJsStatic> {
  if (!sqlJsPromise) {
    sqlJsPromise = initSqlJs({ locateFile: (file) => `/node_modules/sql.js/dist/${file}` });
  }
  return sqlJsPromise;
}
