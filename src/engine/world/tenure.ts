import { queryRow, queryRows } from '../db/sqlite';
import { getBalance, sinkCoin } from '../inventory/wallet';
import { getSite, listSitesByKind, type Site } from './sites';
import type { Database } from '../db/sqlite';
import type { EventBus } from '../eventBus';

// Land and site access (§5.1, §12, Stage 6's "buy/rent plots"). Who may work
// a parcel, and on what terms — the one ownership/access rule NPC companies
// use today and player enterprise will use later, so the two can never
// disagree about who holds a field.
//
// A parcel (a site with a land_value) is held by at most one entity at a
// time, as freehold (bought outright) or on a lease (an entry fine up front,
// then weekly rent). Sites without a land_value — the well, the market, the
// tavern — are commons and public places: never held.
//
// Who is paid: no lord, manor or treasury entity exists yet (taxes →
// treasury is Stage 8), so land purchases, entry fines and rent leave the
// settlement's economy as designed sinks (channels 'land' and 'rent'), the
// same honest simplification as company upgrades. When a treasury exists it
// becomes the payee and these become transfers.

export type TenureKind = 'freehold' | 'lease';

export interface Tenure {
  id: number;
  siteId: string;
  holderId: string;
  kind: TenureKind;
  weeklyRent: number;
  pricePaid: number;
  acquiredAtTick: number;
  releasedAtTick: number | null;
}

// A lease costs a fortieth of the parcel's value a week (its price over
// forty weeks — about two in-game years), after an entry fine of four
// weeks' rent — the medieval "entry fine". Cheap to start, a real line in
// the ledger for as long as the business runs.
export const LEASE_WEEKLY_RENT_FRACTION = 0.025;
export const LEASE_ENTRY_FINE_WEEKS = 4;

const TENURE_COLUMNS =
  'id, site_id, holder_id, kind, weekly_rent, price_paid, acquired_at_tick, released_at_tick';

function rowToTenure(row: unknown[]): Tenure {
  return {
    id: Number(row[0]),
    siteId: String(row[1]),
    holderId: String(row[2]),
    kind: row[3] as TenureKind,
    weeklyRent: Number(row[4]),
    pricePaid: Number(row[5]),
    acquiredAtTick: Number(row[6]),
    releasedAtTick: row[7] === null ? null : Number(row[7]),
  };
}

export function getOpenTenure(db: Database, siteId: string): Tenure | null {
  const row = queryRow(
    db,
    `SELECT ${TENURE_COLUMNS} FROM site_tenures WHERE site_id = ? AND released_at_tick IS NULL`,
    [siteId],
  );
  return row ? rowToTenure(row) : null;
}

export function listOpenTenuresForHolder(db: Database, holderId: string): Tenure[] {
  return queryRows(
    db,
    `SELECT ${TENURE_COLUMNS} FROM site_tenures WHERE holder_id = ? AND released_at_tick IS NULL ORDER BY id`,
    [holderId],
  ).map(rowToTenure);
}

export interface TenureTerms {
  // Paid on acquisition: the whole price (freehold) or the entry fine (lease).
  upfront: number;
  weeklyRent: number;
}

export function tenureTerms(site: Site, kind: TenureKind): TenureTerms | null {
  if (site.landValue === null || site.landValue === undefined) return null;
  if (kind === 'freehold') return { upfront: site.landValue, weeklyRent: 0 };
  const weeklyRent = Math.max(1, Math.ceil(site.landValue * LEASE_WEEKLY_RENT_FRACTION));
  return { upfront: weeklyRent * LEASE_ENTRY_FINE_WEEKS, weeklyRent };
}

export function isSiteAvailable(db: Database, siteId: string): boolean {
  const site = getSite(db, siteId);
  if (!site || site.landValue === null || site.landValue === undefined) return false;
  return getOpenTenure(db, siteId) === null;
}

// Parcels of a kind nobody holds right now — a closed company's land is
// released (companies.ts's closeCompany) and shows up here again.
export function listAvailableSites(db: Database, kind: string): Site[] {
  return listSitesByKind(db, kind).filter(
    (site) => site.landValue !== null && site.landValue !== undefined && !getOpenTenure(db, site.id),
  );
}

// Records a holding without any payment — for seed content describing land
// a business already held before the game began. Throws if already held.
export function grantSiteTenure(
  db: Database,
  siteId: string,
  holderId: string,
  kind: TenureKind,
  tick: number,
): void {
  const site = getSite(db, siteId);
  if (!site) throw new Error(`Unknown site: "${siteId}"`);
  if (getOpenTenure(db, siteId)) throw new Error(`"${siteId}" is already held.`);
  const weeklyRent = kind === 'lease' ? (tenureTerms(site, 'lease')?.weeklyRent ?? 0) : 0;
  db.run(
    'INSERT INTO site_tenures (site_id, holder_id, kind, weekly_rent, price_paid, acquired_at_tick) VALUES (?, ?, ?, ?, 0, ?)',
    [siteId, holderId, kind, weeklyRent, tick],
  );
}

// Acquires a parcel for holderId, paid by payerId (usually the same — a
// company buying or leasing its own ground). All-or-nothing: throws without
// changing anything if the parcel isn't available or the payer can't
// afford the upfront cost. Returns what was paid up front.
export function acquireSiteTenure(
  db: Database,
  bus: EventBus,
  params: { siteId: string; holderId: string; payerId: string; kind: TenureKind; tick: number },
): TenureTerms {
  const site = getSite(db, params.siteId);
  if (!site) throw new Error(`Unknown site: "${params.siteId}"`);
  const terms = tenureTerms(site, params.kind);
  if (!terms) throw new Error(`"${site.name}" isn't land that can be held.`);
  if (getOpenTenure(db, params.siteId)) throw new Error(`"${site.name}" is already held.`);
  if (getBalance(db, params.payerId) < terms.upfront) {
    throw new Error(`${params.payerId} can't afford ${terms.upfront} coin for "${site.name}".`);
  }

  if (terms.upfront > 0) {
    sinkCoin(
      db,
      bus,
      params.payerId,
      terms.upfront,
      params.tick,
      params.kind === 'freehold'
        ? `Buys ${site.name} outright for ${terms.upfront} coin.`
        : `Pays an entry fine of ${terms.upfront} coin to lease ${site.name}.`,
      'business',
      'land',
    );
  }
  db.run(
    'INSERT INTO site_tenures (site_id, holder_id, kind, weekly_rent, price_paid, acquired_at_tick) VALUES (?, ?, ?, ?, ?, ?)',
    [params.siteId, params.holderId, params.kind, terms.weeklyRent, terms.upfront, params.tick],
  );
  return terms;
}

// Gives up every parcel a holder still holds — a closing company's land
// returns to the pool (and to listAvailableSites) for the next taker.
// Freehold land surrendered on closure is forfeit, not sold: with no
// treasury or land market yet, there's nobody to pay for it (a named gap).
export function releaseTenuresForHolder(db: Database, holderId: string, tick: number): Tenure[] {
  const released = listOpenTenuresForHolder(db, holderId);
  if (released.length > 0) {
    db.run('UPDATE site_tenures SET released_at_tick = ? WHERE holder_id = ? AND released_at_tick IS NULL', [
      tick,
      holderId,
    ]);
  }
  return released;
}

// One week's rent on every lease a holder has: pays what it can. Unpaid rent
// isn't carried as arrears (no debt model before credit, post-v1) — a holder
// that can't pay is insolvent anyway, and insolvency closes it and releases
// the land. Returns the amount paid.
export function payWeeklyRent(db: Database, bus: EventBus, holderId: string, tick: number): number {
  let paid = 0;
  for (const tenure of listOpenTenuresForHolder(db, holderId)) {
    if (tenure.weeklyRent <= 0) continue;
    const amount = Math.min(tenure.weeklyRent, getBalance(db, holderId));
    if (amount <= 0) continue;
    sinkCoin(db, bus, holderId, amount, tick, `Pays ${amount} coin rent.`, 'business', 'rent');
    paid += amount;
  }
  return paid;
}
