import { queryRow } from '../db/sqlite';
import { getGoodDefinition } from '../goods/catalog';
import { countActiveEmploymentsForSlot, listJobOpenings } from '../jobs/jobs';
import { marketWindowStats } from '../market/history';
import { getListing } from '../market/market';
import { WORKDAYS_PER_WEEK } from '../population/cadence';
import { getRecipeForSkill, type Recipe } from '../production/recipes';
import { listAvailableSites } from '../world/tenure';
import { listBusinessTypes, type BusinessType } from './businessTypes';
import type { Site } from '../world/sites';
import type { Database } from 'sql.js';

// Business opportunity (§11.3 "expected benefit − cost − risk"), in two
// layers:
//
// 1. MarketSignals — what the settlement's real state says about one kind
//    of business right now: what its output has been fetching and how much
//    of it sold, how much the town had to import (unmet demand) or the
//    merchant had to take off its hands (a glut), how much the existing
//    producers can turn out, whether a downstream business stands idle for
//    want of it, what its input costs, whether there's labor to hire and
//    land to work. Computed once per evaluation pass, from market_history
//    (market/history.ts) and the live companies — nothing invented, nothing
//    hardcoded per industry.
//
// 2. OpportunityEstimate — what one would-be founder BELIEVES those signals
//    add up to. Nobody has perfect information (§8.1 rule 6), and how good
//    the belief is depends on who's looking:
//      - Management (§9.2) decides how informed the reading is. A competent
//        manager plans to sell into the demand that's actually going unmet
//        at the going price, and sizes the business to it; a poor one
//        assumes every hand they hire turns into sales at the best price
//        lately seen, overlooks part of the wage, input and rent bill, and
//        hires to the limit. Management is never a production multiplier
//        here — it changes the estimate, and so the decisions.
//      - Experience in the trade (years worked in it, skill, having run one
//        before) narrows the estimate's random error: an old logger reads a
//        timber market better than a baker does.
//    The error itself is one draw from the engine's seeded RNG, so the same
//    world and seed always produce the same beliefs and the same decisions.

const MARKET_SITE_ID = 'market';
// The window a founder judges a market by: the last four weeks.
export const SIGNAL_WINDOW_DAYS = 28;
// What an observer assumes a typical hand turns out — counting heads at a
// rival business, not knowing each worker's skill. 0.8 ≈ a worker a few
// weeks into the trade (skills.ts: 0.6 + 0.07/level).
const TYPICAL_SUCCESS_CHANCE = 0.8;
const WORKDAY_FRACTION = WORKDAYS_PER_WEEK / 7;
// The merchant's asking price for imports (market/merchant.ts) — what an
// input with no local seller would cost.
const IMPORT_PRICE_MULTIPLIER = 1.5;

export function expectedOutputPerShift(recipe: Recipe): number {
  return (
    TYPICAL_SUCCESS_CHANCE * recipe.outputPerShiftSuccess +
    (1 - TYPICAL_SUCCESS_CHANCE) * recipe.outputPerShiftFailure
  );
}

export interface MarketSignals {
  businessTypeId: string;
  outputGood: string;
  inputGood: string | null;
  // Output prices: the four-week average (base price if it has never
  // traded) and the latest close.
  outputPrice: number;
  outputLastPrice: number;
  outputBasePrice: number;
  // Units a day over the window.
  soldPerDay: number;
  importedPerDay: number;
  exportedPerDay: number;
  // What the open producers of this good can turn out a day, by headcount.
  localCapacityPerDay: number;
  producersOpen: number;
  // Every open producer is posting its full complement and has it filled.
  producersAtCapacity: boolean;
  // Input the open businesses that use this good could process a day at
  // their current headcount — latent demand that shows even when nobody
  // sells the good locally at all (a mill standing idle after the farm
  // failed).
  downstreamNeedPerDay: number;
  // max(sold, downstream need) — what the town takes, or would take.
  demandPerDay: number;
  // Demand local producers don't meet: the larger of what had to be
  // imported and what demand exceeds local capacity by.
  unmetPerDay: number;
  inputPrice: number | null;
  unemployed: number;
  availableSites: Site[];
}

// Open companies whose recipe makes / uses a good, with their headcount.
function producersOf(db: Database, good: string, as: 'output' | 'input') {
  const out: { recipe: Recipe; workers: number; atCapacity: boolean; companyId: string }[] = [];
  for (const slot of listJobOpenings(db)) {
    const recipe = getRecipeForSkill(slot.skill);
    if (!recipe) continue;
    if ((as === 'output' ? recipe.outputGood : recipe.inputGood) !== good) continue;
    const workers = countActiveEmploymentsForSlot(db, slot.id);
    out.push({
      recipe,
      workers,
      atCapacity: slot.capacity >= slot.maxCapacity && workers >= slot.capacity,
      companyId: slot.companyId,
    });
  }
  return out;
}

// People in the settlement with no job — the labor a new business could
// hire (no ages are modeled yet, so every household member is an adult).
export function countUnemployedAdults(db: Database): number {
  const row = queryRow(
    db,
    `SELECT COUNT(*) FROM household_members
     JOIN households ON households.id = household_members.household_id
     WHERE households.departed_at_tick IS NULL
       AND NOT EXISTS (SELECT 1 FROM employment WHERE employment.entity_id = household_members.entity_id AND employment.status = 'active')`,
  );
  return Number(row?.[0] ?? 0);
}

export function computeMarketSignals(
  db: Database,
  type: BusinessType,
  tick: number,
  unemployed: number,
): MarketSignals | null {
  const recipe = getRecipeForSkill(type.skill);
  if (!recipe) return null;
  const output = recipe.outputGood;
  const def = getGoodDefinition(output);
  const stats = marketWindowStats(db, MARKET_SITE_ID, output, tick, SIGNAL_WINDOW_DAYS);
  const listing = getListing(db, MARKET_SITE_ID, output);
  const outputPrice = stats.avgPrice ?? listing?.price ?? def.basePrice;
  const outputLastPrice = stats.lastPrice ?? listing?.price ?? def.basePrice;

  // listJobOpenings (producersOf's source) already leaves out closed companies.
  const producers = producersOf(db, output, 'output');
  const localCapacityPerDay = producers.reduce(
    (sum, p) => sum + p.workers * expectedOutputPerShift(p.recipe) * WORKDAY_FRACTION,
    0,
  );
  const producerIds = new Set(producers.map((p) => p.companyId));
  const downstreamNeedPerDay = producersOf(db, output, 'input').reduce(
    (sum, p) =>
      sum +
      p.workers *
        ((expectedOutputPerShift(p.recipe) * p.recipe.inputUnits) / p.recipe.outputUnits) *
        WORKDAY_FRACTION,
    0,
  );
  const demandPerDay = Math.max(stats.soldPerDay, downstreamNeedPerDay);
  const unmetPerDay = Math.max(0, stats.importedPerDay, demandPerDay - localCapacityPerDay);

  let inputPrice: number | null = null;
  if (recipe.inputGood) {
    const inputStats = marketWindowStats(db, MARKET_SITE_ID, recipe.inputGood, tick, SIGNAL_WINDOW_DAYS);
    inputPrice =
      inputStats.avgPrice ??
      getListing(db, MARKET_SITE_ID, recipe.inputGood)?.price ??
      Math.ceil(getGoodDefinition(recipe.inputGood).basePrice * IMPORT_PRICE_MULTIPLIER);
  }

  return {
    businessTypeId: type.id,
    outputGood: output,
    inputGood: recipe.inputGood,
    outputPrice,
    outputLastPrice,
    outputBasePrice: def.basePrice,
    soldPerDay: stats.soldPerDay,
    importedPerDay: stats.importedPerDay,
    exportedPerDay: stats.exportedPerDay,
    localCapacityPerDay,
    producersOpen: producerIds.size,
    producersAtCapacity: producers.length > 0 && producers.every((p) => p.atCapacity),
    downstreamNeedPerDay,
    demandPerDay,
    unmetPerDay,
    inputPrice,
    unemployed,
    availableSites: listAvailableSites(db, type.siteKind),
  };
}

export function computeAllMarketSignals(db: Database, tick: number): MarketSignals[] {
  const unemployed = countUnemployedAdults(db);
  return listBusinessTypes()
    .map((type) => computeMarketSignals(db, type, tick, unemployed))
    .filter((s): s is MarketSignals => s !== null);
}

export interface FounderProfile {
  managementLevel: number; // 0-5
  experience: number; // 0..1 in this business's trade
}

export interface OpportunityEstimate {
  businessTypeId: string;
  positions: number;
  postedWage: number;
  outputPerWorkerPerDay: number;
  // What the founder believes they'll sell a day, and for how much.
  salesPerDay: number;
  price: number;
  revenuePerDay: number;
  wagesPerDay: number;
  inputCostPerDay: number;
  rentPerDay: number;
  profitPerMonth: number; // 30 days
  // How many days of input to stock at opening.
  openingStockDays: number;
  // Weeks of running costs the founder wants in hand as working capital.
  reserveWeeks: number;
  // The random error this founder's reading carried (+0.2 = believed 20%
  // more sales than the informed reading supports).
  error: number;
}

// How informed a reading is, 0 (Management 0) .. 1 (Management 5).
function informedness(managementLevel: number): number {
  return Math.min(1, Math.max(0, managementLevel / 5));
}

// The size of an estimate's random error: wide for a novice in an unfamiliar
// trade, narrow for a competent manager who knows the work.
export function estimateErrorSpread(profile: FounderProfile): number {
  return 0.5 * (1 - 0.6 * informedness(profile.managementLevel)) * (1 - 0.6 * profile.experience);
}

// A poor manager overlooks part of the cost of running a business...
const MAX_COST_BLINDNESS = 0.3;
// ...and expects to sell at a premium to the going price.
const MAX_PRICE_OPTIMISM = 0.15;

export function estimateOpportunity(
  signals: MarketSignals,
  type: BusinessType,
  profile: FounderProfile,
  weeklyRent: number,
  rng: () => number,
): OpportunityEstimate {
  const recipe = getRecipeForSkill(type.skill);
  if (!recipe) throw new Error(`No recipe for business type "${type.id}"`);
  const w = informedness(profile.managementLevel);
  const error = (rng() * 2 - 1) * estimateErrorSpread(profile);
  const perWorker = expectedOutputPerShift(recipe) * WORKDAY_FRACTION;

  // How many hands: an informed founder sizes to the unmet demand; a poor
  // one hires to the limit, believing every hand means more sales.
  const informedPositions = Math.min(
    type.startingMaxPositions,
    Math.max(1, Math.ceil(signals.unmetPerDay / perWorker)),
  );
  const positions = Math.min(
    type.startingMaxPositions,
    Math.max(1, Math.round(w * informedPositions + (1 - w) * type.startingMaxPositions)),
  );
  const capacity = positions * perWorker;

  // What sells: informed — only into demand nobody else meets (a glut the
  // merchant is exporting means there's none); naive — everything made.
  const informedSales = Math.min(capacity, signals.unmetPerDay);
  const salesPerDay = Math.min(capacity, Math.max(0, (w * informedSales + (1 - w) * capacity) * (1 + error)));
  const price =
    (w * signals.outputPrice + (1 - w) * Math.max(signals.outputPrice, signals.outputLastPrice)) *
    (1 + MAX_PRICE_OPTIMISM * (1 - w));

  // Labor is scarce when there are fewer people looking for work than
  // positions to fill: a competent founder posts a better wage to compete.
  const hires = positions - 1;
  const postedWage =
    profile.managementLevel >= 2 && signals.unemployed < hires
      ? type.wageMin + Math.ceil((type.wageMax - type.wageMin) / 2)
      : type.wageMin;

  const costSeen = 1 - MAX_COST_BLINDNESS * (1 - w);
  const wagesPerDay = positions * postedWage * WORKDAY_FRACTION * costSeen;
  const inputCostPerDay =
    recipe.inputGood && signals.inputPrice !== null
      ? ((salesPerDay * recipe.inputUnits) / recipe.outputUnits) * signals.inputPrice * costSeen
      : 0;
  const rentPerDay = (weeklyRent / 7) * costSeen;
  const revenuePerDay = salesPerDay * price;
  const profitPerMonth = 30 * (revenuePerDay - wagesPerDay - inputCostPerDay - rentPerDay);

  return {
    businessTypeId: type.id,
    positions,
    postedWage,
    outputPerWorkerPerDay: perWorker,
    salesPerDay,
    price,
    revenuePerDay,
    wagesPerDay,
    inputCostPerDay,
    rentPerDay,
    profitPerMonth,
    // A poor manager overstocks at opening (a week of input, not three days)
    // and keeps a thin cash reserve; a competent one the reverse.
    openingStockDays: Math.round(3 + 4 * (1 - w)),
    reserveWeeks: 1 + profile.managementLevel,
    error,
  };
}
