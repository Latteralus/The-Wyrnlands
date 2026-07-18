import { queryRow } from '../db/sqlite';
import type { Database } from 'sql.js';

// §9.1 Structure. A company is also an entities row (its id is the
// container/owner id its wallet and inventory hang off of, same as a
// person's) — see Engine.createCompany, which creates that entities row
// first. NPC-run for now; player-owned companies (§9.1 "Company screens
// (player-owned)") arrive Stage 6.
export interface Company {
  id: string;
  name: string;
  kind: string;
  siteId: string;
}

export function createCompany(db: Database, company: Company): void {
  db.run('INSERT INTO companies (id, name, kind, site_id) VALUES (?, ?, ?, ?)', [
    company.id,
    company.name,
    company.kind,
    company.siteId,
  ]);
}

export function getCompany(db: Database, id: string): Company | null {
  const row = queryRow(db, 'SELECT id, name, kind, site_id FROM companies WHERE id = ?', [id]);
  return row
    ? { id: String(row[0]), name: String(row[1]), kind: String(row[2]), siteId: String(row[3]) }
    : null;
}
