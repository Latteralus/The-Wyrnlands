import { queryRow, queryRows } from '../db/sqlite';
import { releaseTenuresForHolder } from '../world/tenure';
import type { Database } from '../db/sqlite';

// §9.1 Structure. A company is also an entities row (its id is the
// container/owner id its wallet and inventory hang off of, same as a
// person's) — see Engine.createCompany, which creates that entities row
// first. The same company model supports both NPC and player ownership.
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
  // §9.5: the tick of the last upgrade, for decisions.ts's cooldown.
  lastUpgradedTick: number | null;
  // §9.2 owner vs manager: who makes the daily decisions, when that isn't
  // the owner. Null = the owner manages, as every company so far does — see
  // getCompanyManagerId. The extension point for hiring a professional
  // manager, or an heir who owns the place but can't run it.
  managerId: string | null;
  // When the business opened — 0 for the seeded companies that predate the
  // game. Its own track-record checks (decisions.ts) measure from here.
  foundedAtTick: number;
  // Lifecycle milestones for the business log (decisions.ts's
  // recordMilestones) — null until reached.
  firstHireTick: number | null;
  firstProfitTick: number | null;
}

export type NewCompany = Pick<Company, 'id' | 'name' | 'kind' | 'siteId'> & { foundedAtTick?: number };

export function createCompany(db: Database, company: NewCompany): void {
  db.run('INSERT INTO companies (id, name, kind, site_id, founded_at_tick) VALUES (?, ?, ?, ?, ?)', [
    company.id,
    company.name,
    company.kind,
    company.siteId,
    company.foundedAtTick ?? 0,
  ]);
}

export function setCompanyOwner(db: Database, companyId: string, ownerId: string): void {
  db.run('UPDATE companies SET owner_id = ? WHERE id = ?', [ownerId, companyId]);
}

export function setCompanyManager(db: Database, companyId: string, managerId: string | null): void {
  db.run('UPDATE companies SET manager_id = ? WHERE id = ?', [managerId, companyId]);
}

// Whose Management skill runs the business (§9.2): its appointed manager,
// else its owner. Owner draws go to the owner either way.
export function getCompanyManagerId(company: Company): string | null {
  return company.managerId ?? company.ownerId;
}

export function setCompanyMilestone(
  db: Database,
  companyId: string,
  milestone: 'first_hire_tick' | 'first_profit_tick',
  tick: number,
): void {
  db.run(`UPDATE companies SET ${milestone} = ? WHERE id = ?`, [tick, companyId]);
}

// Open businesses an entity owns — how much an aspiring founder already
// has on their plate.
export function countOpenCompaniesOwnedBy(db: Database, ownerId: string): number {
  const row = queryRow(db, 'SELECT COUNT(*) FROM companies WHERE owner_id = ? AND closed_at_tick IS NULL', [
    ownerId,
  ]);
  return Number(row?.[0] ?? 0);
}

const COMPANY_COLUMNS =
  'id, name, kind, site_id, owner_id, insolvent_since_tick, tier, closed_at_tick, last_upgraded_tick, manager_id, founded_at_tick, first_hire_tick, first_profit_tick';

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
    lastUpgradedTick: row[8] === null || row[8] === undefined ? null : Number(row[8]),
    managerId: typeof row[9] === 'string' ? row[9] : null,
    foundedAtTick: Number(row[10] ?? 0),
    firstHireTick: row[11] === null || row[11] === undefined ? null : Number(row[11]),
    firstProfitTick: row[12] === null || row[12] === undefined ? null : Number(row[12]),
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
export function bumpCompanyTier(db: Database, companyId: string, tick: number): void {
  db.run('UPDATE companies SET tier = tier + 1, last_upgraded_tick = ? WHERE id = ?', [tick, companyId]);
}

// §9.6 "permanent failure": marks a company closed for good and gives up
// its land (world/tenure.ts) so the parcel is free for the next taker —
// every closure path comes through here. Callers (decisions.ts's closure
// and wind-down, seed content) are responsible for terminating employment
// and liquidating inventory first.
export function closeCompany(db: Database, companyId: string, tick: number): void {
  db.run('UPDATE companies SET closed_at_tick = ? WHERE id = ?', [tick, companyId]);
  releaseTenuresForHolder(db, companyId, tick);
}

// §9.3 Ledger — a minimal, real version. Full tabbed company screens
// (Overview/Ledger, Supplies, ...) are Stage 6, player-owned companies only
// (§14.2); this is what companies/decisions.ts reads to make Management-
// weighted daily calls, and what any future business-log screen (§14.3)
// would read to narrate a company's history without re-deriving it from the
// whole event_log.
// owner_draw (§9.3): profit paid out to the owner's household — equity, not
// an operating cost, so it's reported separately and excluded from net.
// owner_contribution is the reverse (founding capital, a rescue injection);
// capital is money spent on lasting assets (land, a founding tool). Both
// are kept out of operating net too, so a new business's startup outlay
// doesn't read as a month of losses. rent (world/tenure.ts leases) is an
// operating cost.
export type LedgerEntryKind =
  'revenue' | 'material_cost' | 'wage' | 'tax' | 'owner_draw' | 'owner_contribution' | 'capital' | 'rent';

export function recordLedgerEntry(
  db: Database,
  companyId: string,
  tick: number,
  kind: LedgerEntryKind,
  amount: number,
  note?: string,
  // Units traded, for a sale or purchase line (see recentDailySalesUnits).
  quantity?: number,
): void {
  db.run(
    'INSERT INTO company_ledger_entries (company_id, tick, kind, amount, note, quantity) VALUES (?, ?, ?, ?, ?, ?)',
    [companyId, tick, kind, amount, note ?? null, quantity ?? null],
  );
}

// Units this company sold to local buyers per day over a trailing window
// (merchant exports are recorded without a quantity on purpose — dumping a
// glut isn't demand to plan for).
export function recentDailySalesUnits(
  db: Database,
  companyId: string,
  sinceTick: number,
  days: number,
): number {
  const row = queryRow(
    db,
    "SELECT COALESCE(SUM(quantity), 0) FROM company_ledger_entries WHERE company_id = ? AND kind = 'revenue' AND tick > ?",
    [companyId, sinceTick],
  );
  return Number(row?.[0] ?? 0) / days;
}

export interface LedgerSummary {
  revenue: number;
  materialCost: number;
  wages: number;
  tax: number;
  rent: number;
  net: number;
  ownerDraws: number;
  ownerContributions: number;
  capital: number;
}

export function summarizeLedger(db: Database, companyId: string, sinceTick: number): LedgerSummary {
  const rows = queryRows(
    db,
    `SELECT kind, COALESCE(SUM(amount), 0) FROM company_ledger_entries
     WHERE company_id = ? AND tick >= ? GROUP BY kind`,
    [companyId, sinceTick],
  );
  const summary: LedgerSummary = {
    revenue: 0,
    materialCost: 0,
    wages: 0,
    tax: 0,
    rent: 0,
    net: 0,
    ownerDraws: 0,
    ownerContributions: 0,
    capital: 0,
  };
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
      case 'owner_draw':
        summary.ownerDraws = amount;
        break;
      case 'owner_contribution':
        summary.ownerContributions = amount;
        break;
      case 'capital':
        summary.capital = amount;
        break;
      case 'rent':
        summary.rent = amount;
        break;
    }
  }
  summary.net = summary.revenue - summary.materialCost - summary.wages - summary.tax - summary.rent;
  return summary;
}
