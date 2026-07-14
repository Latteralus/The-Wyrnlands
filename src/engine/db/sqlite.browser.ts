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
