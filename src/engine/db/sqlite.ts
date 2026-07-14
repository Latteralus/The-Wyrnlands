import type { BindParams, Database, SqlJsStatic, SqlValue } from 'sql.js';

export type { BindParams, Database, SqlJsStatic, SqlValue };

export function createDatabase(SQL: SqlJsStatic, bytes?: Uint8Array): Database {
  return new SQL.Database(bytes);
}

export function exportDatabase(db: Database): Uint8Array {
  return db.export();
}

// db.exec() returns [] (not a result with an empty `values`) when a SELECT
// matches zero rows — confirmed empirically against sql.js, since nothing in
// its own type declarations documents the distinction. These two helpers
// fold that "no result set at all" case into a plain empty array/undefined
// so callers get an ordinary noUncheckedIndexedAccess-safe shape instead of
// repeating the `result[0]?.values ?? []` dance at every call site.
export function queryRows(db: Database, sql: string, params?: BindParams): SqlValue[][] {
  const result = db.exec(sql, params);
  return result[0]?.values ?? [];
}

export function queryRow(db: Database, sql: string, params?: BindParams): SqlValue[] | undefined {
  return queryRows(db, sql, params)[0];
}
