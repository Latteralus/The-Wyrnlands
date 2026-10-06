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

// Does NOT return a genuinely fresh WASM module in the browser (sql.js
// caches its module promise at its own top level, and ES modules have no
// invalidatable require cache) — calling it just returns the memoized
// instance. That used to matter: long sessions in one tab were exposed to
// the "memory ceiling" that checkpointing escaped in Node. The ceiling was
// actually sql.js's db.exec() leaking WASM stack per call (see db/
// sqlite.ts); the engine no longer calls exec(), so the browser no longer
// needs a fresh module for long sessions. Kept only so checkpoint.ts has
// the same shape on both platforms.
export function loadFreshSqlJs(): Promise<SqlJsStatic> {
  return initSqlJs({ locateFile: (file) => `/${file}` });
}
