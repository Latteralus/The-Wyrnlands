import { createRequire } from 'node:module';
import path from 'node:path';
import initSqlJs, { type SqlJsStatic } from 'sql.js';

let sqlJsPromise: Promise<SqlJsStatic> | null = null;

export function loadSqlJs(): Promise<SqlJsStatic> {
  if (!sqlJsPromise) {
    const require = createRequire(import.meta.url);
    const wasmDir = path.dirname(require.resolve('sql.js'));
    sqlJsPromise = initSqlJs({ locateFile: (file) => path.join(wasmDir, file) });
  }
  return sqlJsPromise;
}
