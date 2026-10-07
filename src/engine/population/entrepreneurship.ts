import { getBusinessType, type BusinessType } from '../companies/businessTypes';
import { countOpenCompaniesOwnedBy } from '../companies/companies';
import { estimateStartupOutlay, foundCompany, type StartupOutlay } from '../companies/founding';
import {
  computeAllMarketSignals,
  estimateOpportunity,
  type MarketSignals,
  type OpportunityEstimate,
} from '../companies/opportunity';
import { queryRow, queryRows } from '../db/sqlite';
import { isBackgroundActor, getEntityName } from '../entities';
import { getBalance } from '../inventory/wallet';
import { getRecipeForSkill } from '../production/recipes';
import { getLevel, MANAGEMENT_SKILL } from '../skills/skills';
import { MINUTES_PER_DAY } from '../time/clock';
import { tenureTerms } from '../world/tenure';
import { WORKDAYS_PER_WEEK, weeklyFoodCost } from './cadence';
import { listHouseholdMembers } from './households';
import { getTrait } from './traits';
import type { EventBus } from '../eventBus';
import type { Site } from '../world/sites';
import type { Database } from 'sql.js';

// NPC-founded businesses (DECISIONS.md, "Business founding"). Every
// ENTREPRENEURSHIP_INTERVAL_DAYS, people with real savings weigh whether to
// start a business of their own — and the few who are willing, can afford
// it, and believe in an opportunity the market is actually showing, do.
//
// Nothing here spawns a business because an industry is missing. A failed
// bakery leaves a shortage; the shortage shows up as imports and high
// prices (market/history.ts); someone with savings, the nerve and a
// plausible grasp of the trade may read that as an opportunity
// (companies/opportunity.ts) and found a bakery (companies/founding.ts) —
// or nobody does, and the town keeps importing bread.
//
// Who is a candidate, cheaply and in this order (so the expensive part runs
// for a handful of people at most):
//   - a household with savings above what the cheapest business on offer
//     needs to open (land, a tool, a week's wage) plus two weeks' food —
//     one SQL query; most households never get past it;
//   - one member per household (they share one purse): the best manager;
//   - not someone who closed a business recently, already runs two, or
//     runs one that's new or in trouble;
//   - ambition: a roll weighted by the ambition trait decides whether they
//     think about it at all this time.
// Then, for each kind of business with land available, the founder forms
// their own estimate (companies/opportunity.ts) — only for trades they know
// (experience) unless they're a capable manager (Management 2+), who will
// look further afield. They pick the best return they believe in and go
// ahead only if:
//   - it clears MIN_MONTHLY_PROFIT a month, by their estimate;
//   - it pays back within a period their risk tolerance accepts;
//   - their household can fund the whole plan — opening outlay plus the
//     working capital they think they need — and still keep its cushion
//     (a few weeks' food; less for the bold and the badly organised).
//
// Cadence: fortnightly. A season is 30 days and a year 120 (time/clock.ts),
// and a town can empty within two months of losing its farm — four-weekly
// evaluation was too slow for anyone to answer a collapse before it was
// over, weekly needlessly frequent for a decision people take rarely.
export const ENTREPRENEURSHIP_INTERVAL_DAYS = 14;

const MIN_MONTHLY_PROFIT = 100;
// Payback a founder accepts, in 30-day periods: 3 for the most cautious,
// up to 12 (three in-game years) for the boldest.
const MIN_PAYBACK_MONTHS = 3;
const PAYBACK_MONTHS_PER_RISK = 9;
// Household cushion, in weeks of food: 2 always (the household must eat),
// plus up to 6 more for the cautious — less for a poor manager, who keeps
// a thinner margin than they should.
const BASE_CUSHION_WEEKS = 2;
const CAUTION_CUSHION_WEEKS = 6;
const BASE_WILLINGNESS = 0.2;
const AMBITION_WILLINGNESS = 0.6;
// Someone whose business just closed doesn't immediately try again.
const RECOVERY_DAYS_AFTER_CLOSURE = 112;
// An owner looks at a second business only once their first is established.
const MIN_EXISTING_BUSINESS_AGE_DAYS = 120;
const MAX_OPEN_COMPANIES_PER_OWNER = 2;
// Management a founder needs to take on a trade they've never worked.
const OUTSIDE_TRADE_MANAGEMENT = 2;
const MIN_TRADE_EXPERIENCE = 0.2;
// Experience saturates after this many days worked in a trade (two years).
const EXPERIENCE_FULL_DAYS = 240;

export interface EntrepreneurshipPassStats {
  candidates: number;
  considered: number;
  estimates: number;
  founded: string[];
}

// How well someone knows a trade, 0..1: days worked in it, skill in it, and
// whether they've run a business of this kind before (a failed owner keeps
// what they learned).
export function tradeExperience(db: Database, entityId: string, type: BusinessType, tick: number): number {
  const daysRow = queryRow(
    db,
    `SELECT COALESCE(SUM(MIN(COALESCE(employment.terminated_at_tick, ?), ?) - employment.hired_at_tick), 0)
     FROM employment JOIN job_slots ON job_slots.id = employment.job_slot_id
     WHERE employment.entity_id = ? AND job_slots.skill = ?`,
    [tick, tick, entityId, type.skill],
  );
  const days = Number(daysRow?.[0] ?? 0) / MINUTES_PER_DAY;
  const ranOne =
    queryRow(db, 'SELECT 1 FROM companies WHERE owner_id = ? AND kind = ? LIMIT 1', [entityId, type.id]) !==
    undefined;
  return Math.min(
    1,
    0.5 * Math.min(1, days / EXPERIENCE_FULL_DAYS) +
      0.3 * (getLevel(db, entityId, type.skill) / 5) +
      (ranOne ? 0.4 : 0),
  );
}

// Whether someone is in a position to start something new right now (see
// the header comment's candidate rules).
function isFreeToFound(db: Database, entityId: string, tick: number): boolean {
  const lastClosure = queryRow(
    db,
    'SELECT MAX(closed_at_tick) FROM companies WHERE owner_id = ? AND closed_at_tick IS NOT NULL',
    [entityId],
  )?.[0];
  if (typeof lastClosure === 'number' && tick - lastClosure < RECOVERY_DAYS_AFTER_CLOSURE * MINUTES_PER_DAY)
    return false;
  const owned = countOpenCompaniesOwnedBy(db, entityId);
  if (owned >= MAX_OPEN_COMPANIES_PER_OWNER) return false;
  if (owned > 0) {
    // founded_at_tick 0 = a business that predates the game: established.
    const shaky = queryRow(
      db,
      `SELECT 1 FROM companies WHERE owner_id = ? AND closed_at_tick IS NULL
         AND (insolvent_since_tick IS NOT NULL OR (founded_at_tick > 0 AND founded_at_tick > ?)) LIMIT 1`,
      [entityId, tick - MIN_EXISTING_BUSINESS_AGE_DAYS * MINUTES_PER_DAY],
    );
    if (shaky) return false;
  }
  return true;
}

function cheapestSite(sites: Site[]): Site | null {
  return (
    [...sites].sort((a, b) => (a.landValue ?? 0) - (b.landValue ?? 0) || a.id.localeCompare(b.id))[0] ?? null
  );
}

// The least anyone could open any business on offer with: its land, its
// tool, a week of one wage — plus two weeks' food for one. Households below
// this aren't candidates at all.
function minimumCandidatePurse(
  db: Database,
  signals: MarketSignals[],
  weeklyFoodForOne: number,
): number | null {
  let min: number | null = null;
  for (const s of signals) {
    const type = getBusinessType(s.businessTypeId);
    const site = cheapestSite(s.availableSites);
    if (!type || !site) continue;
    const outlay = estimateStartupOutlay(db, type, site.id, 'lease', 0);
    if (!outlay) continue;
    const need = outlay.total + type.wageMin * WORKDAYS_PER_WEEK;
    if (min === null || need < min) min = need;
  }
  return min === null ? null : min + BASE_CUSHION_WEEKS * weeklyFoodForOne;
}

interface Option {
  type: BusinessType;
  site: Site;
  signals: MarketSignals;
  estimate: OpportunityEstimate;
  outlay: StartupOutlay;
  initialInputUnits: number;
  reserve: number;
  needed: number;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// What the founder saw — the reasons that make it an opening, in words.
function describeSignals(s: MarketSignals): string[] {
  const reasons: string[] = [];
  if (s.producersOpen === 0) reasons.push(`nobody in town makes ${s.outputGood}`);
  if (s.importedPerDay >= 0.5)
    reasons.push(`the merchant has been bringing in ${round1(s.importedPerDay)} ${s.outputGood} a day`);
  if (s.downstreamNeedPerDay > s.localCapacityPerDay + 0.5)
    reasons.push(`businesses that need ${s.outputGood} could use far more than is made locally`);
  else if (s.soldPerDay > s.localCapacityPerDay + 0.5)
    reasons.push(
      `the town has been buying ${round1(s.soldPerDay)} ${s.outputGood} a day, more than local hands can make`,
    );
  if (s.outputPrice >= s.outputBasePrice * 1.15)
    reasons.push(
      `${s.outputGood} has been fetching ${Math.round(s.outputPrice)} coin against a usual ${s.outputBasePrice}`,
    );
  if (s.producersOpen > 0 && s.producersAtCapacity)
    reasons.push(`the town's ${s.outputGood} producers are already working flat out`);
  if (reasons.length === 0) reasons.push(`there's room for another ${s.businessTypeId}`);
  return reasons;
}

function companyNameFor(db: Database, founderId: string, type: BusinessType, site: Site): string {
  const surname = getEntityName(db, founderId).split(' ').slice(-1)[0] ?? 'New';
  const name = `${surname} ${type.nameSuffix}`;
  const taken = queryRow(db, 'SELECT 1 FROM companies WHERE name = ? LIMIT 1', [name]) !== undefined;
  return taken ? `${name} at ${site.name}` : name;
}

export function applyEntrepreneurshipCadence(
  db: Database,
  bus: EventBus,
  tick: number,
  rng: () => number,
): EntrepreneurshipPassStats {
  const stats: EntrepreneurshipPassStats = { candidates: 0, considered: 0, estimates: 0, founded: [] };
  let signals = computeAllMarketSignals(db, tick);
  if (signals.every((s) => s.availableSites.length === 0)) return stats;

  const weeklyFoodForOne = weeklyFoodCost(db, '');
  const minPurse = minimumCandidatePurse(db, signals, weeklyFoodForOne);
  if (minPurse === null) return stats;

  const households = queryRows(
    db,
    `SELECT households.id FROM households JOIN wallets ON wallets.owner_id = households.id
     WHERE households.departed_at_tick IS NULL AND wallets.balance >= ? ORDER BY households.id`,
    [minPurse],
  ).map((row) => String(row[0]));

  for (const householdId of households) {
    const founderId = listHouseholdMembers(db, householdId)
      .filter((id) => isBackgroundActor(db, id) && isFreeToFound(db, id, tick))
      .map((id) => ({ id, management: getLevel(db, id, MANAGEMENT_SKILL) }))
      .sort((a, b) => b.management - a.management || a.id.localeCompare(b.id))[0]?.id;
    if (!founderId) continue;
    stats.candidates++;

    const ambition = getTrait(db, founderId, 'ambition');
    if (rng() >= BASE_WILLINGNESS + AMBITION_WILLINGNESS * ambition) continue;
    stats.considered++;

    const management = getLevel(db, founderId, MANAGEMENT_SKILL);
    const risk = getTrait(db, founderId, 'risk_tolerance');
    const options: Option[] = [];
    for (const s of signals) {
      const type = getBusinessType(s.businessTypeId);
      const site = cheapestSite(s.availableSites);
      if (!type || !site) continue;
      const experience = tradeExperience(db, founderId, type, tick);
      if (experience < MIN_TRADE_EXPERIENCE && management < OUTSIDE_TRADE_MANAGEMENT) continue;

      const terms = tenureTerms(site, 'lease');
      if (!terms) continue;
      const estimate = estimateOpportunity(
        s,
        type,
        { managementLevel: management, experience },
        terms.weeklyRent,
        rng,
      );
      stats.estimates++;
      const recipe = getRecipeForSkill(type.skill);
      const initialInputUnits = recipe?.inputGood
        ? Math.ceil(
            ((estimate.salesPerDay * recipe.inputUnits) / recipe.outputUnits) * estimate.openingStockDays,
          )
        : 0;
      const outlay = estimateStartupOutlay(db, type, site.id, 'lease', initialInputUnits);
      if (!outlay) continue;
      const weeklyRunning = 7 * (estimate.wagesPerDay + estimate.rentPerDay + estimate.inputCostPerDay);
      const reserve = Math.ceil(estimate.reserveWeeks * weeklyRunning);
      options.push({
        type,
        site,
        signals: s,
        estimate,
        outlay,
        initialInputUnits,
        reserve,
        needed: outlay.total + reserve,
      });
    }

    const best = options
      .filter((o) => o.estimate.profitPerMonth > 0)
      .sort((a, b) => b.estimate.profitPerMonth / b.needed - a.estimate.profitPerMonth / a.needed)[0];
    if (!best) continue;
    if (best.estimate.profitPerMonth < MIN_MONTHLY_PROFIT) continue;
    const paybackMonths = best.needed / best.estimate.profitPerMonth;
    if (paybackMonths > MIN_PAYBACK_MONTHS + PAYBACK_MONTHS_PER_RISK * risk) continue;

    const informed = management / 5;
    const cushionWeeks = BASE_CUSHION_WEEKS + CAUTION_CUSHION_WEEKS * (1 - risk) * (0.5 + 0.5 * informed);
    const purse = getBalance(db, householdId);
    const cushion = Math.ceil(cushionWeeks * weeklyFoodCost(db, householdId));
    if (purse - cushion < best.needed) continue; // can't fund the plan and still keep the household safe

    const founderName = getEntityName(db, founderId);
    const profit = Math.round(best.estimate.profitPerMonth);
    const reasons = describeSignals(best.signals);
    bus.emit({
      tick,
      scope: 'settlement',
      actorId: founderId,
      type: 'entrepreneur.opportunity',
      message: `${founderName} sees an opening: ${reasons.join('; ')} — and reckons a ${best.type.id} could clear about ${profit} coin a month.`,
      data: { businessType: best.type.id, reasons, estimatedProfitPerMonth: profit },
    });

    const result = foundCompany(
      db,
      bus,
      {
        founderId,
        payerId: householdId,
        businessTypeId: best.type.id,
        siteId: best.site.id,
        tenureKind: 'lease',
        companyName: companyNameFor(db, founderId, best.type, best.site),
        positions: best.estimate.positions,
        postedWage: best.estimate.postedWage,
        investment: best.needed,
        initialInputUnits: best.initialInputUnits,
        founderWorks: countOpenCompaniesOwnedBy(db, founderId) === 0,
        details: {
          reasons,
          founder: {
            management,
            experience: round1(tradeExperience(db, founderId, best.type, tick)),
            ambition: round1(ambition),
            riskTolerance: round1(risk),
            householdPurse: purse,
            cushion,
          },
          believed: {
            salesPerDay: round1(best.estimate.salesPerDay),
            price: round1(best.estimate.price),
            profitPerMonth: profit,
            paybackMonths: round1(paybackMonths),
            error: round1(best.estimate.error),
          },
          market: {
            outputPrice: round1(best.signals.outputPrice),
            soldPerDay: round1(best.signals.soldPerDay),
            importedPerDay: round1(best.signals.importedPerDay),
            exportedPerDay: round1(best.signals.exportedPerDay),
            localCapacityPerDay: round1(best.signals.localCapacityPerDay),
            downstreamNeedPerDay: round1(best.signals.downstreamNeedPerDay),
            unmetPerDay: round1(best.signals.unmetPerDay),
            unemployed: best.signals.unemployed,
          },
          outlay: best.outlay,
          reserve: best.reserve,
        },
      },
      tick,
    );
    if (result.ok) {
      stats.founded.push(result.companyId);
      // The town just changed: a new producer, a parcel taken, hands
      // wanted. Whoever weighs things next sees that, not the old picture.
      signals = computeAllMarketSignals(db, tick);
    }
  }
  return stats;
}
