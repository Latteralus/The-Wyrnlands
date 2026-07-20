import { describe, expect, it } from 'vitest';
import { createDatabase } from '../db/sqlite';
import { loadSqlJs } from '../db/sqlite.node';
import { Engine } from '../engine';
import { recordLedgerEntry, summarizeLedger } from './companies';

describe('companies', () => {
  it('a company has no owner and no insolvency flag until assigned', async () => {
    const SQL = await loadSqlJs();
    const db = createDatabase(SQL);
    const engine = Engine.bootstrap(db, { seed: 'company-owner' });
    engine.createCompany({ id: 'co-1', name: 'Test Co', kind: 'test', siteId: 'nowhere' });

    expect(engine.getCompany('co-1')?.ownerId).toBeNull();
    expect(engine.getCompany('co-1')?.insolventSinceTick).toBeNull();

    engine.createEntity('owner-1', 'Test Owner');
    engine.setCompanyOwner('co-1', 'owner-1');
    expect(engine.getCompany('co-1')?.ownerId).toBe('owner-1');

    engine.dispose();
  });

  it('summarizeLedger nets revenue against material cost, wages, and tax within a window', async () => {
    const SQL = await loadSqlJs();
    const db = createDatabase(SQL);
    const engine = Engine.bootstrap(db, { seed: 'company-ledger' });
    engine.createCompany({ id: 'co-2', name: 'Test Co 2', kind: 'test', siteId: 'nowhere' });

    recordLedgerEntry(engine.db, 'co-2', 10, 'revenue', 100, 'sold goods');
    recordLedgerEntry(engine.db, 'co-2', 10, 'material_cost', 20, 'bought input');
    recordLedgerEntry(engine.db, 'co-2', 10, 'wage', 30, 'paid worker');
    recordLedgerEntry(engine.db, 'co-2', 10, 'tax', 5, 'tax');
    // Outside the query window — must not be counted.
    recordLedgerEntry(engine.db, 'co-2', 1, 'revenue', 1000, 'ancient sale');

    const summary = summarizeLedger(engine.db, 'co-2', 5);
    expect(summary.revenue).toBe(100);
    expect(summary.materialCost).toBe(20);
    expect(summary.wages).toBe(30);
    expect(summary.tax).toBe(5);
    expect(summary.net).toBe(100 - 20 - 30 - 5);

    engine.dispose();
  });
});
