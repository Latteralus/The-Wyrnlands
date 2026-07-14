import initSqlJs, { type SqlJsStatic } from 'sql.js';
import { createRequire } from 'node:module';
import path from 'node:path';

let sqlJsPromise: Promise<SqlJsStatic> | null = null;

export function loadSqlJs(): Promise<SqlJsStatic> {
  if (!sqlJsPromise) {
    const require = createRequire(import.meta.url);
    const wasmDir = path.dirname(require.resolve('sql.js'));
    sqlJsPromise = initSqlJs({ locateFile: (file) => path.join(wasmDir, file) });
  }
  return sqlJsPromise;
}
