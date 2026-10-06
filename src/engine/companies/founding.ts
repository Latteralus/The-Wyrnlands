import { queryRow, queryRows, withSavepoint } from '../db/sqlite';
import { createEntity, getEntity, getEntityName } from '../entities';
import { getGoodDefinition } from '../goods/catalog';
import { ensureWallet, getBalance, transferCoin } from '../inventory/wallet';
import {
  applyForJob,
  createJobSlot,
  getActiveEmployment,
  quitJob,
  setJobSlotMaxCapacity,
} from '../jobs/jobs';
import { buyFromMarket, companyBuyFromMarket, getListing } from '../market/market';
import { getRecipeForSkill } from '../production/recipes';
import { MINUTES_PER_DAY } from '../time/clock';
import { getSite } from '../world/sites';
import { acquireSiteTenure, isSiteAvailable, tenureTerms, type TenureKind } from '../world/tenure';
import { getBusinessType, type BusinessType } from './businessTypes';
import { createCompany, getCompany, recordLedgerEntry, setCompanyOwner } from './companies';
import type { EventBus } from '../eventBus';
import type { Database } from 'sql.js';

// Founding a company (§9.1; Stage 6's "found a company") — the one way a new
// business comes into existence during play, whoever founds it: an NPC
// acting on an opportunity it believes in (population/entrepreneurship.ts)
// today, the player from Stage 6. Nothing here decides WHETHER to found;
// it carries out a decision someone already made, with real money and
// real goods, and either completes in full or leaves no trace.
//
// The steps, in order: capital moves from the founder's purse to the new
// company; the company takes its land (lease or freehold, world/tenure.ts);
// it buys its working tool and opening stock of input at market prices;
// it posts its positions; the founder takes one of them if they're working
// it themselves. Workers are never created or assigned: the positions are
// openings, filled (or not) by the ordinary weekly job-seeking pass.
//
// All writes happen inside one savepoint (db/sqlite.ts's withSavepoint): if
// any step fails — the tool sold out, the money falls short at today's
// prices — every earlier step is rolled back and no half-made company is
// left behind.

const MARKET_SITE_ID = 'market';

export interface FoundingPlan {
  founderId: string;
  // Whose purse funds it — the founder's household (NPC), or the founder's
  // own wallet (a foreground actor like the player).
  payerId: string;
  businessTypeId: string;
  siteId: string;
  tenureKind: TenureKind;
  companyName: string;
  // Positions posted at opening (the founder's own included, if working).
  positions: number;
  postedWage: number;
  // Capital moved from the payer into the company. Must cover the outlay
  // (land, tool, opening stock); whatever's left is its working capital.
  investment: number;
  // Opening stock of input for a transformation business (0 for extraction).
  initialInputUnits: number;
  // Whether the founder works a position themselves (an owner-operator) or
  // runs it from outside, staffing every position by hiring.
  founderWorks: boolean;
  // The founder's reasoning — stored with the founding record as the
  // business's "why it exists" (estimates are what they believed then).
  details?: Record<string, unknown>;
}

export interface StartupOutlay {
  land: number;
  weeklyRent: number;
  tool: number;
  inputs: number;
  total: number;
}

// What opening costs at today's prices, before any working capital: the
// land's upfront cost, one working tool, and the opening stock of input.
// Null if this can't be founded at all right now (the parcel isn't
// available or isn't the right kind, the tool isn't for sale).
export function estimateStartupOutlay(
  db: Database,
  type: BusinessType,
  siteId: string,
  tenureKind: TenureKind,
  initialInputUnits: number,
): StartupOutlay | null {
  const site = getSite(db, siteId);
  if (!site || site.kind !== type.siteKind || !isSiteAvailable(db, siteId)) return null;
  const terms = tenureTerms(site, tenureKind);
  if (!terms) return null;

  let tool = 0;
  if (type.toolGoodType) {
    const listing = getListing(db, MARKET_SITE_ID, type.toolGoodType);
    if (!listing || listing.quantity <= 0) return null;
    tool = listing.price;
  }

  let inputs = 0;
  const inputGood = getRecipeForSkill(type.skill)?.inputGood ?? null;
  if (inputGood && initialInputUnits > 0) {
    const price = getListing(db, MARKET_SITE_ID, inputGood)?.price ?? getGoodDefinition(inputGood).basePrice;
    inputs = initialInputUnits * price;
  }
  return {
    land: terms.upfront,
    weeklyRent: terms.weeklyRent,
    tool,
    inputs,
    total: terms.upfront + tool + inputs,
  };
}

export type FoundingResult =
  { ok: true; companyId: string; outlay: StartupOutlay } | { ok: false; reason: string };

function newCompanyId(db: Database, founderId: string, tick: number): string {
  const base = `company-${Math.floor(tick / MINUTES_PER_DAY)}-${founderId}`;
  let id = base;
  for (let n = 2; getEntity(db, id); n++) id = `${base}-${n}`;
  return id;
}

export function foundCompany(db: Database, bus: EventBus, plan: FoundingPlan, tick: number): FoundingResult {
  const type = getBusinessType(plan.businessTypeId);
  if (!type) return { ok: false, reason: `unknown business type "${plan.businessTypeId}"` };
  if (plan.positions < 1 || plan.positions > type.startingMaxPositions) {
    return { ok: false, reason: `${plan.positions} positions is outside 1-${type.startingMaxPositions}` };
  }
  const outlay = estimateStartupOutlay(db, type, plan.siteId, plan.tenureKind, plan.initialInputUnits);
  if (!outlay) return { ok: false, reason: 'the site or the equipment is not available' };
  const payerBalance = getBalance(db, plan.payerId);
  if (plan.investment > payerBalance) {
    return { ok: false, reason: `needs ${plan.investment} coin, has ${payerBalance}` };
  }
  if (plan.investment < outlay.total) {
    return { ok: false, reason: `${plan.investment} coin doesn't cover the ${outlay.total} coin outlay` };
  }

  try {
    const companyId = withSavepoint(db, () =>
      executeFounding(db, bus, plan, type, outlay, payerBalance, tick),
    );
    return { ok: true, companyId, outlay };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    bus.emit({
      tick,
      scope: 'settlement',
      actorId: plan.founderId,
      type: 'business.founding_failed',
      message: `${getEntityName(db, plan.founderId)}'s plans for ${plan.companyName} fall through.`,
      data: { businessType: type.id, siteId: plan.siteId, reason },
    });
    return { ok: false, reason };
  }
}

function executeFounding(
  db: Database,
  bus: EventBus,
  plan: FoundingPlan,
  type: BusinessType,
  outlay: StartupOutlay,
  payerBalance: number,
  tick: number,
): string {
  const site = getSite(db, plan.siteId);
  if (!site) throw new Error(`unknown site "${plan.siteId}"`);
  const founderName = getEntityName(db, plan.founderId);
  const companyId = newCompanyId(db, plan.founderId, tick);

  // 1. The company exists, owned (and, for now, managed) by its founder.
  createEntity(db, companyId, plan.companyName);
  createCompany(db, {
    id: companyId,
    name: plan.companyName,
    kind: type.id,
    siteId: plan.siteId,
    foundedAtTick: tick,
  });
  ensureWallet(db, companyId);
  setCompanyOwner(db, companyId, plan.founderId);

  // 2. The founder's capital — real coin from a real purse.
  transferCoin(
    db,
    bus,
    plan.payerId,
    companyId,
    plan.investment,
    tick,
    `${founderName} puts ${plan.investment} coin into ${plan.companyName}.`,
    'business',
  );
  recordLedgerEntry(db, companyId, tick, 'owner_contribution', plan.investment, 'Founding capital.');

  // 3. Its land.
  const terms = acquireSiteTenure(db, bus, {
    siteId: plan.siteId,
    holderId: companyId,
    payerId: companyId,
    kind: plan.tenureKind,
    tick,
  });
  if (terms.upfront > 0) {
    recordLedgerEntry(
      db,
      companyId,
      tick,
      'capital',
      terms.upfront,
      plan.tenureKind === 'freehold' ? `Bought ${site.name}.` : `Entry fine on the lease of ${site.name}.`,
    );
  }
  bus.emit({
    tick,
    scope: 'business',
    actorId: companyId,
    type: 'business.site_acquired',
    message:
      plan.tenureKind === 'freehold'
        ? `${plan.companyName} buys ${site.name} for ${terms.upfront} coin.`
        : `${plan.companyName} takes a lease on ${site.name}: ${terms.upfront} coin down, ${terms.weeklyRent} a week.`,
    data: {
      siteId: site.id,
      tenureKind: plan.tenureKind,
      upfront: terms.upfront,
      weeklyRent: terms.weeklyRent,
    },
  });

  // 4. Its working tool, bought at market like any other — a used one off
  // the auction pile if there is one (market.ts sells oldest stock first).
  if (type.toolGoodType) {
    const listing = getListing(db, MARKET_SITE_ID, type.toolGoodType);
    if (!listing || listing.quantity <= 0 || getBalance(db, companyId) < listing.price) {
      throw new Error(`no ${type.toolGoodType} to be had`);
    }
    const purchase = buyFromMarket(db, bus, companyId, MARKET_SITE_ID, type.toolGoodType, 1, tick, {
      note: `${plan.companyName} buys its first ${type.toolGoodType}.`,
      scope: 'business',
    });
    if (purchase.itemIds.length === 0) throw new Error(`no ${type.toolGoodType} to be had`);
    recordLedgerEntry(db, companyId, tick, 'capital', purchase.totalCost, `First ${type.toolGoodType}.`, 1);
  }

  // 5. Opening stock of input, if it transforms something — whatever the
  // market has today, up to the plan.
  const recipe = getRecipeForSkill(type.skill);
  if (recipe?.inputGood && plan.initialInputUnits > 0) {
    companyBuyFromMarket(db, bus, companyId, MARKET_SITE_ID, recipe.inputGood, plan.initialInputUnits, tick);
  }

  // 6. Its positions, up to what a new business of this kind can run.
  const slotId = `${companyId}-${type.id}`;
  createJobSlot(db, {
    id: slotId,
    companyId,
    title: type.jobTitle,
    skill: type.skill,
    wageMin: plan.postedWage,
    wageMax: Math.max(plan.postedWage, type.wageMax),
    shiftDurationTicks: type.shiftDurationTicks,
    ...(type.toolGoodType ? { toolGoodType: type.toolGoodType } : {}),
    capacity: plan.positions,
  });
  setJobSlotMaxCapacity(db, slotId, type.startingMaxPositions);

  // 7. An owner-operator leaves whatever job they had and works their own.
  if (plan.founderWorks) {
    const current = getActiveEmployment(db, plan.founderId);
    if (current) {
      quitJob(db, bus, plan.founderId, tick, {
        scope: 'settlement',
        message: `${founderName} leaves ${getCompany(db, current.companyId)?.name ?? 'their job'} to start ${plan.companyName}.`,
      });
    }
    applyForJob(db, bus, plan.founderId, slotId, tick, { haggle: false, scope: 'settlement' }, () => 0);
  }

  db.run(
    `INSERT INTO company_foundings (company_id, founder_id, payer_id, tick, business_type, site_id, tenure_kind,
       investment, payer_balance_before, planned_positions, details)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      companyId,
      plan.founderId,
      plan.payerId,
      tick,
      type.id,
      plan.siteId,
      plan.tenureKind,
      plan.investment,
      payerBalance,
      plan.positions,
      plan.details ? JSON.stringify(plan.details) : null,
    ],
  );

  const workingCapital = getBalance(db, companyId);
  bus.emit({
    tick,
    scope: 'settlement',
    actorId: companyId,
    type: 'business.founded',
    message:
      `${founderName} founds ${plan.companyName} at ${site.name}, putting in ${plan.investment} coin ` +
      `and posting ${plan.positions} ${type.jobTitle.toLowerCase()} position${plan.positions === 1 ? '' : 's'} at ${plan.postedWage} coin a shift.`,
    data: {
      founderId: plan.founderId,
      businessType: type.id,
      siteId: plan.siteId,
      investment: plan.investment,
      outlay: outlay.total,
      workingCapital,
      positions: plan.positions,
      ...plan.details,
    },
  });
  return companyId;
}

export interface FoundingRecord {
  companyId: string;
  founderId: string;
  payerId: string;
  tick: number;
  businessType: string;
  siteId: string;
  tenureKind: TenureKind;
  investment: number;
  payerBalanceBefore: number;
  plannedPositions: number;
  details: Record<string, unknown> | null;
}

const FOUNDING_COLUMNS =
  'company_id, founder_id, payer_id, tick, business_type, site_id, tenure_kind, investment, payer_balance_before, planned_positions, details';

function rowToFounding(row: unknown[]): FoundingRecord {
  return {
    companyId: String(row[0]),
    founderId: String(row[1]),
    payerId: String(row[2]),
    tick: Number(row[3]),
    businessType: String(row[4]),
    siteId: String(row[5]),
    tenureKind: row[6] as TenureKind,
    investment: Number(row[7]),
    payerBalanceBefore: Number(row[8]),
    plannedPositions: Number(row[9]),
    details: typeof row[10] === 'string' ? (JSON.parse(row[10]) as Record<string, unknown>) : null,
  };
}

export function getFoundingRecord(db: Database, companyId: string): FoundingRecord | null {
  const row = queryRow(db, `SELECT ${FOUNDING_COLUMNS} FROM company_foundings WHERE company_id = ?`, [
    companyId,
  ]);
  return row ? rowToFounding(row) : null;
}

export function listFoundingRecords(db: Database): FoundingRecord[] {
  return queryRows(db, `SELECT ${FOUNDING_COLUMNS} FROM company_foundings ORDER BY tick, company_id`).map(
    rowToFounding,
  );
}
