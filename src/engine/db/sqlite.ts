import type { Database, SqlJsStatic } from 'sql.js';

export type { Database, SqlJsStatic };

export function createDatabase(SQL: SqlJsStatic, bytes?: Uint8Array): Database {
  return new SQL.Database(bytes);
}

export function exportDatabase(db: Database): Uint8Array {
  return db.export();
}
