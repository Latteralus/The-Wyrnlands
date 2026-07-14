import { describe, expect, it } from 'vitest';
import { createDatabase } from './sqlite';
import { loadSqlJs } from './sqlite.node';
import { applyMigrations } from './migrationRunner';

describe('applyMigrations', () => {
  it('creates the core schema once and is idempotent on re-run', async () => {
    const SQL = await loadSqlJs();
    const db = createDatabase(SQL);

    expect(applyMigrations(db)).toEqual(['0001_init']);
    expect(applyMigrations(db)).toEqual([]);

    const tables = db.exec("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name");
    const tableNames = tables[0].values.map((row) => String(row[0]));
    expect(tableNames).toEqual(
      expect.arrayContaining(['event_log', 'schema_migrations', 'world_meta']),
    );

    db.close();
  });
});
