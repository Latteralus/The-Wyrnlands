import { describe, expect, it } from 'vitest';
import { applyMigrations } from './migrationRunner';
import { createDatabase, queryRows } from './sqlite';
import { loadSqlJs } from './sqlite.node';

describe('applyMigrations', () => {
  it('creates the core schema once and is idempotent on re-run', async () => {
    const SQL = await loadSqlJs();
    const db = createDatabase(SQL);

    expect(applyMigrations(db)).toEqual([
      '0001_init',
      '0002_entities_and_actions',
      '0003_sites',
      '0004_inventory_and_audit',
      '0005_survival',
      '0006_action_cancelled_status',
      '0007_jobs_and_companies',
      '0008_npcs_and_households',
      '0009_rng_state',
      '0010_production_chains',
      '0011_company_growth',
    ]);
    expect(applyMigrations(db)).toEqual([]);

    const tableNames = queryRows(db, "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").map(
      (row) => String(row[0]),
    );
    expect(tableNames).toEqual(
      expect.arrayContaining([
        'actions',
        'audits',
        'companies',
        'company_ledger_entries',
        'employment',
        'entities',
        'event_log',
        'gear',
        'households',
        'household_members',
        'items',
        'job_slots',
        'market_listings',
        'needs',
        'provenance_events',
        'schema_migrations',
        'sites',
        'skills',
        'wallets',
        'world_meta',
      ]),
    );

    db.close();
  });
});
