import { queryRow, queryRows } from '../db/sqlite';
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
  // §9.2 "every business has an owner whose Management skill... modifies
  // the whole operation." Nullable — a company can exist before an owner is
  // assigned (companies/decisions.ts falls back to a neutral management
  // level for one with none).
  ownerId: string | null;
  // §9.6/§11.5 "insolvency": the tick a company's balance first hit zero and
  // hasn't recovered since, or null if solvent. Set/cleared by
  // companies/decisions.ts's daily cadence; once it's been true for longer
  // than that company's Management-weighted grace period, tryCloseCompany
  // acts on it (see closedAtTick below).
  insolventSinceTick: number | null;
  // §9.5 "upgrade tiers expand job slots, storage, and workstations" — starts
  // at 1; raised by companies/decisions.ts's tryUpgrade.
  tier: number;
  // §9.6 "permanent failure -> auction": the tick this company closed for
  // good, or null while still operating. Set once, never cleared — unlike
  // insolvency, closure isn't recoverable (matches real closures: workers
  // terminated, remaining equipment auctioned — see companies/decisions.ts's
  // tryCloseCompany).
  closedAtTick: number | null;
}

export function createCompany(
  db: Database,
  company: Omit<Company, 'ownerId' | 'insolventSinceTick' | 'tier' | 'closedAtTick'>,
): void {
  db.run('INSERT INTO companies (id, name, kind, site_id) VALUES (?, ?, ?, ?)', [
    company.id,
    company.name,
    company.kind,
    company.siteId,
  ]);
}

export function setCompanyOwner(db: Database, companyId: string, ownerId: string): void {
  db.run('UPDATE companies SET owner_id = ? WHERE id = ?', [ownerId, companyId]);
}

const COMPANY_COLUMNS = 'id, name, kind, site_id, owner_id, insolvent_since_tick, tier, closed_at_tick';

function rowToCompany(row: unknown[]): Company {
  return {
    id: String(row[0]),
    name: String(row[1]),
    kind: String(row[2]),
    siteId: String(row[3]),
    ownerId: typeof row[4] === 'string' ? row[4] : null,
    insolventSinceTick: row[5] === null ? null : Number(row[5]),
    tier: Number(row[6]),
    closedAtTick: row[7] === null ? null : Number(row[7]),
  };
}

export function getCompany(db: Database, id: string): Company | null {
  const row = queryRow(db, `SELECT ${COMPANY_COLUMNS} FROM companies WHERE id = ?`, [id]);
  return row ? rowToCompany(row) : null;
}

export function listCompanies(db: Database): Company[] {
  return queryRows(db, `SELECT ${COMPANY_COLUMNS} FROM companies ORDER BY id`).map(rowToCompany);
}

export function setCompanyInsolvency(db: Database, companyId: string, sinceTick: number | null): void {
  db.run('UPDATE companies SET insolvent_since_tick = ? WHERE id = ?', [sinceTick, companyId]);
}

// §9.5: raises a company's tier by one — companies/decisions.ts's tryUpgrade
// is the only caller, and it's responsible for the capacity/cost side.
export function bumpCompanyTier(db: Database, companyId: string): void {
  db.run('UPDATE companies SET tier = tier + 1 WHERE id = ?', [companyId]);
}

// §9.6 "permanent failure": marks a company closed for good — companies/
// decisions.ts's tryCloseCompany is the only caller, and it's responsible
// for terminating employment and auctioning/liquidating inventory first.
export function closeCompany(db: Database, companyId: string, tick: number): void {
  db.run('UPDATE companies SET closed_at_tick = ? WHERE id = ?', [tick, companyId]);
}

// §9.3 Ledger — a minimal, real version. Full tabbed company screens
// (Overview/Ledger, Supplies, ...) are Stage 6, player-owned companies only
// (§14.2); this is what companies/decisions.ts reads to make Management-
// weighted daily calls, and what any future business-log screen (§14.3)
// would read to narrate a company's history without re-deriving it from the
// whole event_log.
export type LedgerEntryKind = 'revenue' | 'material_cost' | 'wage' | 'tax';

export function recordLedgerEntry(
  db: Database,
  companyId: string,
  tick: number,
  kind: LedgerEntryKind,
  amount: number,
  note?: string,
): void {
  db.run('INSERT INTO company_ledger_entries (company_id, tick, kind, amount, note) VALUES (?, ?, ?, ?, ?)', [
    companyId,
    tick,
    kind,
    amount,
    note ?? null,
  ]);
}

export interface LedgerSummary {
  revenue: number;
  materialCost: number;
  wages: number;
  tax: number;
  net: number;
}

export function summarizeLedger(db: Database, companyId: string, sinceTick: number): LedgerSummary {
  const rows = queryRows(
    db,
    `SELECT kind, COALESCE(SUM(amount), 0) FROM company_ledger_entries
     WHERE company_id = ? AND tick >= ? GROUP BY kind`,
    [companyId, sinceTick],
  );
  const summary: LedgerSummary = { revenue: 0, materialCost: 0, wages: 0, tax: 0, net: 0 };
  for (const row of rows) {
    const amount = Number(row[1]);
    switch (String(row[0]) as LedgerEntryKind) {
      case 'revenue':
        summary.revenue = amount;
        break;
      case 'material_cost':
        summary.materialCost = amount;
        break;
      case 'wage':
        summary.wages = amount;
        break;
      case 'tax':
        summary.tax = amount;
        break;
    }
  }
  summary.net = summary.revenue - summary.materialCost - summary.wages - summary.tax;
  return summary;
}
