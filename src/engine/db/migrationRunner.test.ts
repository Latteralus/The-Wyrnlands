import { describe, expect, it } from 'vitest';
import { createDatabase } from './sqlite';
import { loadSqlJs } from './sqlite.node';
import { applyMigrations } from './migrationRunner';

describe('applyMigrations', () => {
  it('creates the core schema once and is idempotent on re-run', async () => {
    const SQL = await loadSqlJs();
    const db = createDatabase(SQL);

    expect(applyMigrations(db)).toEqual([
      '0001_init',
      '0002_entities_and_actions',
      '0003_sites',
      '0004_inventory_and_audit',
    ]);
    expect(applyMigrations(db)).toEqual([]);

    const tables = db.exec("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name");
    const tableNames = tables[0].values.map((row) => String(row[0]));
    expect(tableNames).toEqual(
      expect.arrayContaining([
        'actions',
        'audits',
        'entities',
        'event_log',
        'items',
        'provenance_events',
        'schema_migrations',
        'sites',
        'wallets',
        'world_meta',
      ]),
    );

    db.close();
  });
});
