import { listCompanies, summarizeLedger } from '../companies/companies';
import { queryRow, queryRows } from '../db/sqlite';
import { getConservationCounters } from '../inventory/counters';
import { countActiveItems, countActiveItemsOfType } from '../inventory/items';
import { sumWalletBalances, getBalance } from '../inventory/wallet';
import { listJobSlotsForCompany, countActiveEmploymentsForSlot } from '../jobs/jobs';
import { listAllMarketListings } from '../market/market';
import { MAX_SCARCITY_MULTIPLIER } from '../market/pricing';
import { CHARITY_THRESHOLD, RESERVE_HEALTHY_THRESHOLD } from '../population/cadence';
import { getRecipeForSkill } from '../production/recipes';
import { MANAGEMENT_SKILL, getLevel } from '../skills/skills';
import type { Database } from '../db/sqlite';

// §17 "Balance harness": a read-only statistical picture of the economy at
// one moment (plus flows over a trailing window), so long runs can be judged
// by numbers — is anyone starving, are businesses solvent, do prices hold,
// does money drain away — rather than only by "it didn't crash". Engine-pure
// (no Node APIs); perf/longRun.ts's --econ flag writes these as CSV/JSON.
//
// Cost note: some window metrics scan items/event_log by tick without an
// index. That's deliberate — this runs a few times per simulated week at
// most, never per tick, and adding indexes the simulation itself doesn't
// need would tax every write for a measurement-only reader.

// Matches population/cadence.ts's SUBSISTENCE_HUNGER: an NPC whose hunger
// sits at or below this after the daily cadence wasn't fed a real meal.
const UNFED_HUNGER = 35;

export interface CompanySnapshot {
  id: string;
  name: string;
  status: 'open' | 'insolvent' | 'closed';
  managementLevel: number;
  tier: number;
  cash: number;
  employees: number;
  capacity: number;
  windowRevenue: number;
  windowCosts: number; // material + wages + tax
  windowNet: number;
  inputStock: number | null;
  outputStock: number | null;
}

export interface EconomySnapshot {
  tick: number;
  day: number;
  // Population
  households: number;
  householdsDeparted: number;
  householdsArrived: number; // cumulative immigrant households
  population: number;
  employed: number;
  unemployed: number;
  // Household money
  householdWealthTotal: number;
  householdWealthMin: number;
  householdWealthMedian: number;
  householdWealthMax: number;
  householdsDestitute: number; // below the charity threshold
  householdsStrained: number; // below the healthy-reserve threshold
  // Hunger
  peopleUnfed: number; // members at/below the subsistence floor right now
  hungryHouseholdDaysInWindow: number; // "goes without a proper meal" events
  // Labor
  averageWage: number;
  // Businesses
  businessesOpen: number;
  businessesInsolvent: number;
  businessesClosed: number;
  companies: CompanySnapshot[];
  // Markets
  prices: Record<string, number>;
  marketQuantity: Record<string, number>;
  // Flows over the window
  producedInWindow: Record<string, number>;
  consumedInWindow: Record<string, number>;
  merchantImportsInWindow: Record<string, number>;
  exportedInWindow: Record<string, number>;
  spoiledInWindow: Record<string, number>;
  // Money flows over the window: designed faucets/sinks by channel
  // (wallet.ts's `channel` tag; untagged = 'other'), plus internal flows
  // worth watching.
  faucetsInWindow: Record<string, number>;
  sinksInWindow: Record<string, number>;
  ownerDrawsInWindow: number;
  wagesInWindow: number;
  parishFund: number;
  // Conservation
  totalCoin: number;
  coinFaucetTotal: number;
  coinSinkTotal: number;
  activeGoods: number;
  goodsCreated: number;
  goodsDestroyed: number;
}

function countByType(db: Database, sql: string, params: (string | number)[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of queryRows(db, sql, params)) out[String(row[0])] = Number(row[1]);
  return out;
}

export function collectEconomySnapshot(
  db: Database,
  tick: number,
  windowTicks: number,
  minutesPerDay: number,
): EconomySnapshot {
  const windowStart = Math.max(0, tick - windowTicks);

  const householdRows = queryRows(
    db,
    `SELECT households.id, households.departed_at_tick, wallets.balance
     FROM households LEFT JOIN wallets ON wallets.owner_id = households.id ORDER BY households.id`,
  );
  const present = householdRows.filter((r) => r[1] === null);
  const balances = present.map((r) => Number(r[2] ?? 0)).sort((a, b) => a - b);

  const memberRows = queryRows(
    db,
    `SELECT household_members.entity_id, needs.hunger,
       EXISTS (SELECT 1 FROM employment WHERE employment.entity_id = household_members.entity_id AND employment.status = 'active')
     FROM household_members
     JOIN households ON households.id = household_members.household_id
     LEFT JOIN needs ON needs.entity_id = household_members.entity_id
     WHERE households.departed_at_tick IS NULL`,
  );
  const employed = memberRows.filter((r) => Number(r[2]) === 1).length;

  const companies = listCompanies(db).map((company): CompanySnapshot => {
    const slots = listJobSlotsForCompany(db, company.id);
    const ledger = summarizeLedger(db, company.id, windowStart);
    const recipe = slots.map((s) => getRecipeForSkill(s.skill)).find((r) => r !== null) ?? null;
    return {
      id: company.id,
      name: company.name,
      status:
        company.closedAtTick !== null ? 'closed' : company.insolventSinceTick !== null ? 'insolvent' : 'open',
      managementLevel: company.ownerId ? getLevel(db, company.ownerId, MANAGEMENT_SKILL) : -1,
      tier: company.tier,
      cash: getBalance(db, company.id),
      employees: slots.reduce((sum, s) => sum + countActiveEmploymentsForSlot(db, s.id), 0),
      capacity: slots.reduce((sum, s) => sum + s.capacity, 0),
      windowRevenue: ledger.revenue,
      windowCosts: ledger.materialCost + ledger.wages + ledger.tax,
      windowNet: ledger.net,
      inputStock: recipe?.inputGood ? countActiveItemsOfType(db, company.id, recipe.inputGood) : null,
      outputStock: recipe ? countActiveItemsOfType(db, company.id, recipe.outputGood) : null,
    };
  });

  const prices: Record<string, number> = {};
  const marketQuantity: Record<string, number> = {};
  for (const listing of listAllMarketListings(db)) {
    prices[listing.goodType] = listing.price;
    marketQuantity[listing.goodType] = listing.quantity;
  }

  const counters = getConservationCounters(db);
  const wageRow = queryRow(db, "SELECT AVG(wage) FROM employment WHERE status = 'active'");

  return {
    tick,
    day: Math.floor(tick / minutesPerDay),
    households: present.length,
    householdsDeparted: householdRows.length - present.length,
    householdsArrived: householdRows.filter((r) => String(r[0]).startsWith('household-immigrant-')).length,
    population: memberRows.length,
    employed,
    unemployed: memberRows.length - employed,
    householdWealthTotal: balances.reduce((a, b) => a + b, 0),
    householdWealthMin: balances[0] ?? 0,
    householdWealthMedian: balances[Math.floor(balances.length / 2)] ?? 0,
    householdWealthMax: balances[balances.length - 1] ?? 0,
    householdsDestitute: balances.filter((b) => b < CHARITY_THRESHOLD).length,
    householdsStrained: balances.filter((b) => b < RESERVE_HEALTHY_THRESHOLD).length,
    peopleUnfed: memberRows.filter((r) => r[1] !== null && Number(r[1]) <= UNFED_HUNGER).length,
    hungryHouseholdDaysInWindow: Number(
      queryRow(
        db,
        "SELECT COUNT(*) FROM event_log WHERE scope = 'settlement' AND tick > ? AND type = 'household.hardship.reduced_food'",
        [windowStart],
      )?.[0] ?? 0,
    ),
    averageWage: Math.round(Number(wageRow?.[0] ?? 0) * 100) / 100,
    businessesOpen: companies.filter((c) => c.status === 'open').length,
    businessesInsolvent: companies.filter((c) => c.status === 'insolvent').length,
    businessesClosed: companies.filter((c) => c.status === 'closed').length,
    companies,
    prices,
    marketQuantity,
    producedInWindow: countByType(
      db,
      'SELECT type, COUNT(*) FROM items WHERE created_at_tick > ? GROUP BY type ORDER BY type',
      [windowStart],
    ),
    consumedInWindow: countByType(
      db,
      "SELECT type, COUNT(*) FROM items WHERE status = 'consumed' AND destroyed_at_tick > ? GROUP BY type ORDER BY type",
      [windowStart],
    ),
    merchantImportsInWindow: countByType(
      db,
      "SELECT type, COUNT(*) FROM items WHERE id LIKE 'import-%' AND created_at_tick > ? GROUP BY type ORDER BY type",
      [windowStart],
    ),
    exportedInWindow: countByType(
      db,
      "SELECT type, COUNT(*) FROM items WHERE status = 'exported' AND destroyed_at_tick > ? GROUP BY type ORDER BY type",
      [windowStart],
    ),
    spoiledInWindow: countByType(
      db,
      "SELECT type, COUNT(*) FROM items WHERE status = 'spoiled' AND destroyed_at_tick > ? GROUP BY type ORDER BY type",
      [windowStart],
    ),
    faucetsInWindow: countByType(
      db,
      "SELECT channel, SUM(amount) FROM coin_flows WHERE kind = 'faucet' AND day >= ? GROUP BY 1 ORDER BY 1",
      [Math.floor(windowStart / minutesPerDay)],
    ),
    sinksInWindow: countByType(
      db,
      "SELECT channel, SUM(amount) FROM coin_flows WHERE kind = 'sink' AND day >= ? GROUP BY 1 ORDER BY 1",
      [Math.floor(windowStart / minutesPerDay)],
    ),
    ownerDrawsInWindow: Number(
      queryRow(
        db,
        "SELECT COALESCE(SUM(amount), 0) FROM company_ledger_entries WHERE kind = 'owner_draw' AND tick > ?",
        [windowStart],
      )?.[0] ?? 0,
    ),
    wagesInWindow: Number(
      queryRow(
        db,
        "SELECT COALESCE(SUM(amount), 0) FROM company_ledger_entries WHERE kind = 'wage' AND tick > ?",
        [windowStart],
      )?.[0] ?? 0,
    ),
    parishFund: getBalance(db, 'parish'),
    totalCoin: sumWalletBalances(db),
    coinFaucetTotal: counters.coinFaucetTotal,
    coinSinkTotal: counters.coinSinkTotal,
    activeGoods: countActiveItems(db),
    goodsCreated: counters.goodsCreated,
    goodsDestroyed: counters.goodsDestroyed,
  };
}

// One flat CSV row per snapshot — nested per-company/per-good fields are
// flattened to `company.<id>.<field>` / `price.<good>` columns. Columns are
// taken from the first snapshot; a key that only appears later (a new
// listing, an immigrant-founded company) is still emitted via the union.
export function economySnapshotsToCsv(snapshots: EconomySnapshot[]): string {
  const flat = snapshots.map((s) => {
    const row: Record<string, string | number> = {};
    for (const [key, value] of Object.entries(s)) {
      if (typeof value === 'number') row[key] = value;
    }
    for (const c of s.companies) {
      for (const [key, value] of Object.entries(c) as [string, string | number | null][]) {
        if (key === 'id' || key === 'name') continue;
        row[`company.${c.id}.${key}`] = value ?? '';
      }
    }
    for (const [prefix, record] of [
      ['price', s.prices],
      ['marketQty', s.marketQuantity],
      ['produced', s.producedInWindow],
      ['consumed', s.consumedInWindow],
      ['imported', s.merchantImportsInWindow],
      ['exported', s.exportedInWindow],
      ['spoiled', s.spoiledInWindow],
      ['faucet', s.faucetsInWindow],
      ['sink', s.sinksInWindow],
    ] as const) {
      for (const [good, n] of Object.entries(record)) row[`${prefix}.${good}`] = n;
    }
    return row;
  });
  const columns: string[] = [];
  for (const row of flat) for (const key of Object.keys(row)) if (!columns.includes(key)) columns.push(key);
  const lines = [columns.join(',')];
  for (const row of flat) lines.push(columns.map((c) => String(row[c] ?? '')).join(','));
  return lines.join('\n') + '\n';
}

// A run-level verdict over a series of snapshots — the numbers the §17
// balance harness judges "resilient instability" by. Thresholds are the
// targets set in the 2026-10-06 balancing pass (DECISIONS.md); they're
// reported, not enforced, so a run can be read even when it misses them.
export interface EconomyVerdict {
  meanUnfedShare: number; // average share of people unfed at sample points
  worstUnfedShare: number;
  businessesOpenAtEnd: number;
  businessesClosedAtEnd: number;
  coinStart: number;
  coinEnd: number;
  breadPriceMin: number;
  breadPriceMax: number;
  breadPriceAtCapShare: number; // share of samples with bread at its scarcity cap
  householdsArrived: number;
  householdsDeparted: number;
  populationStart: number;
  populationEnd: number;
  checks: { name: string; passed: boolean; detail: string }[];
}

export function summarizeEconomyRun(
  snapshots: EconomySnapshot[],
  breadBasePrice: number,
): EconomyVerdict | null {
  const first = snapshots[0];
  const last = snapshots[snapshots.length - 1];
  if (!first || !last) return null;
  const unfedShares = snapshots.map((s) => (s.population > 0 ? s.peopleUnfed / s.population : 0));
  const breadPrices = snapshots.map((s) => s.prices.bread ?? 0);
  const capPrice = Math.round(breadBasePrice * MAX_SCARCITY_MULTIPLIER);
  const verdict: EconomyVerdict = {
    meanUnfedShare: unfedShares.reduce((a, b) => a + b, 0) / unfedShares.length,
    worstUnfedShare: Math.max(...unfedShares),
    businessesOpenAtEnd: last.businessesOpen + last.businessesInsolvent,
    businessesClosedAtEnd: last.businessesClosed,
    coinStart: first.totalCoin,
    coinEnd: last.totalCoin,
    breadPriceMin: Math.min(...breadPrices),
    breadPriceMax: Math.max(...breadPrices),
    breadPriceAtCapShare: breadPrices.filter((p) => p >= capPrice).length / breadPrices.length,
    householdsArrived: last.householdsArrived,
    householdsDeparted: last.householdsDeparted,
    populationStart: first.population,
    populationEnd: last.population,
    checks: [],
  };
  const check = (name: string, passed: boolean, detail: string) =>
    verdict.checks.push({ name, passed, detail });
  check(
    'fed',
    verdict.meanUnfedShare <= 0.15,
    `mean unfed share ${(verdict.meanUnfedShare * 100).toFixed(1)}% (target <= 15%)`,
  );
  check(
    'no sustained famine',
    verdict.worstUnfedShare <= 0.5,
    `worst sample ${(verdict.worstUnfedShare * 100).toFixed(1)}% unfed (target <= 50%)`,
  );
  check(
    'businesses survive',
    verdict.businessesOpenAtEnd >= 2,
    `${verdict.businessesOpenAtEnd} open at end (target >= 2)`,
  );
  const coinRatio = verdict.coinStart > 0 ? verdict.coinEnd / verdict.coinStart : 0;
  check(
    'money stable',
    coinRatio >= 0.5 && coinRatio <= 2,
    `total coin ${verdict.coinStart} -> ${verdict.coinEnd} (x${coinRatio.toFixed(2)}, target 0.5-2)`,
  );
  check(
    'bread price not pinned',
    verdict.breadPriceAtCapShare <= 0.25,
    `bread at cap in ${(verdict.breadPriceAtCapShare * 100).toFixed(0)}% of samples (target <= 25%)`,
  );
  check(
    'population persists',
    verdict.populationEnd >= verdict.populationStart * 0.4,
    `population ${verdict.populationStart} -> ${verdict.populationEnd} (target >= 40% — the seeded town is larger than four businesses employ, so a first-year emigration wave is expected)`,
  );

  // Steady state: the run's second half, after the opening adjustment.
  // This is what "years or generations without collapsing" means — the
  // economy settles and stays settled.
  const late = snapshots.slice(Math.floor(snapshots.length / 2));
  const lateFirst = late[0];
  if (lateFirst && late.length >= 2) {
    const lateUnfed =
      late.reduce((sum, s) => sum + (s.population > 0 ? s.peopleUnfed / s.population : 0), 0) / late.length;
    check(
      'settled: fed',
      lateUnfed <= 0.1,
      `second-half mean unfed ${(lateUnfed * 100).toFixed(1)}% (target <= 10%)`,
    );
    const popRatio = lateFirst.population > 0 ? last.population / lateFirst.population : 0;
    check(
      'settled: population stable',
      popRatio >= 0.8,
      `second-half population ${lateFirst.population} -> ${last.population} (target >= 80%)`,
    );
    const lateCoin = lateFirst.totalCoin > 0 ? last.totalCoin / lateFirst.totalCoin : 0;
    check(
      'settled: money stable',
      lateCoin >= 0.75 && lateCoin <= 1.33,
      `second-half coin ${lateFirst.totalCoin} -> ${last.totalCoin} (x${lateCoin.toFixed(2)}, target 0.75-1.33)`,
    );
  }
  return verdict;
}
