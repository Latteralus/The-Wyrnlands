import { listCompanies, summarizeLedger } from '../companies/companies';
import { listFoundingRecords } from '../companies/founding';
import { queryRow } from '../db/sqlite';
import { getEntityName } from '../entities';
import { getBalance } from '../inventory/wallet';
import { countActiveEmploymentsForSlot, listJobSlotsForCompany } from '../jobs/jobs';
import { MINUTES_PER_DAY } from '../time/clock';
import type { Database } from '../db/sqlite';

// Business churn over a run (§17 balance harness): which businesses the
// world started with, which were founded during play — by whom, with how
// much, why — and how each fared. Read-only; perf/longRun.ts prints it at
// the end of every run.

export interface CompanyOutcome {
  id: string;
  name: string;
  kind: string;
  founded: boolean; // founded during play (vs seeded)
  founderName: string | null;
  foundedDay: number;
  investment: number | null;
  status: 'open' | 'insolvent' | 'closed';
  closedDay: number | null;
  closeReason: string | null;
  lifetimeRevenue: number;
  lifetimeNet: number;
  ownerDraws: number;
  ownerContributions: number;
  cash: number;
  employees: number;
  reasons: string[];
}

export interface EntrepreneurshipReport {
  day: number;
  startingCompanies: number;
  foundedCount: number;
  closedCount: number;
  closedFoundedCount: number;
  survivingFounded: number;
  industriesEntered: Record<string, number>;
  companies: CompanyOutcome[];
}

export function collectEntrepreneurshipReport(db: Database, tick: number): EntrepreneurshipReport {
  const foundings = new Map(listFoundingRecords(db).map((f) => [f.companyId, f]));
  const companies = listCompanies(db).map((company): CompanyOutcome => {
    const founding = foundings.get(company.id) ?? null;
    const ledger = summarizeLedger(db, company.id, 0);
    const closeReason = queryRow(
      db,
      "SELECT json_extract(data, '$.reason') FROM event_log WHERE actor_id = ? AND type = 'business.closed' ORDER BY id DESC LIMIT 1",
      [company.id],
    )?.[0];
    const reasons = founding?.details?.reasons;
    return {
      id: company.id,
      name: company.name,
      kind: company.kind,
      founded: founding !== null,
      founderName: founding ? getEntityName(db, founding.founderId) : null,
      foundedDay: Math.floor(company.foundedAtTick / MINUTES_PER_DAY),
      investment: founding?.investment ?? null,
      status:
        company.closedAtTick !== null ? 'closed' : company.insolventSinceTick !== null ? 'insolvent' : 'open',
      closedDay: company.closedAtTick === null ? null : Math.floor(company.closedAtTick / MINUTES_PER_DAY),
      closeReason: typeof closeReason === 'string' ? closeReason : null,
      lifetimeRevenue: ledger.revenue,
      lifetimeNet: ledger.net,
      ownerDraws: ledger.ownerDraws,
      ownerContributions: ledger.ownerContributions,
      cash: getBalance(db, company.id),
      employees: listJobSlotsForCompany(db, company.id).reduce(
        (sum, slot) => sum + countActiveEmploymentsForSlot(db, slot.id),
        0,
      ),
      reasons: Array.isArray(reasons) ? reasons.map(String) : [],
    };
  });

  const foundedList = companies.filter((c) => c.founded);
  const industriesEntered: Record<string, number> = {};
  for (const c of foundedList) industriesEntered[c.kind] = (industriesEntered[c.kind] ?? 0) + 1;
  return {
    day: Math.floor(tick / MINUTES_PER_DAY),
    startingCompanies: companies.length - foundedList.length,
    foundedCount: foundedList.length,
    closedCount: companies.filter((c) => c.status === 'closed').length,
    closedFoundedCount: foundedList.filter((c) => c.status === 'closed').length,
    survivingFounded: foundedList.filter((c) => c.status !== 'closed').length,
    industriesEntered,
    companies,
  };
}

export function formatEntrepreneurshipReport(report: EntrepreneurshipReport): string[] {
  const lines = [
    `Business churn by day ${report.day}: started with ${report.startingCompanies}, founded ${report.foundedCount} ` +
      `(${report.survivingFounded} still open), closed ${report.closedCount} in all; industries entered ${JSON.stringify(report.industriesEntered)}`,
  ];
  for (const c of report.companies) {
    const origin = c.founded
      ? `founded day ${c.foundedDay} by ${c.founderName} with ${c.investment} coin`
      : 'seeded';
    const fate =
      c.status === 'closed'
        ? `closed day ${c.closedDay} (${c.closeReason ?? '?'})`
        : `${c.status}, ${c.employees} employed, cash ${c.cash}`;
    lines.push(
      `    ${c.name} [${c.kind}] — ${origin}; ${fate}; lifetime revenue ${c.lifetimeRevenue}, net ${c.lifetimeNet}, ` +
        `draws ${c.ownerDraws}, owner put in ${c.ownerContributions}`,
    );
    if (c.reasons.length > 0) lines.push(`        why: ${c.reasons.join('; ')}`);
  }
  return lines;
}
