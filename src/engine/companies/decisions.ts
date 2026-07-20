import { getGoodDefinition } from '../goods/catalog';
import { countActiveItemsOfType } from '../inventory/items';
import { getBalance, sinkCoin } from '../inventory/wallet';
import {
  countActiveEmploymentsForSlot,
  listJobSlotsForCompany,
  setJobSlotCapacity,
  type JobSlot,
} from '../jobs/jobs';
import { companyBuyFromMarket, getListing, sellSurplusToMarket } from '../market/market';
import { getRecipeForSkill, hasKnownDemand, type Recipe } from '../production/recipes';
import { getLevel, MANAGEMENT_SKILL } from '../skills/skills';
import { MINUTES_PER_DAY } from '../time/clock';
import {
  bumpCompanyTier,
  listCompanies,
  recordLedgerEntry,
  setCompanyInsolvency,
  summarizeLedger,
  type Company,
} from './companies';
import type { EventBus } from '../eventBus';
import type { Database } from 'sql.js';

// §9's own settlement, hardcoded like population/cadence.ts's MARKET_SITE_ID
// — no second settlement exists before Stage 7's region model.
const MARKET_SITE_ID = 'market';

// §9.2 "every business has an owner whose Management skill... modifies
// purchasing timing... price responsiveness... decision quality." A
// company with no owner assigned yet falls back to this flat, unremarkable
// level rather than crashing or acting maximally sloppy/keen by accident.
const NEUTRAL_MANAGEMENT_LEVEL = 2;

// How many days between restock attempts, by Management level (0-5) — a
// well-run business (§11.5: "the well-managed woodcutter thrives") checks
// its input stock daily; a sloppy one only gets around to it once a week.
// This is deliberately deterministic (not a per-day dice roll) so a given
// seed's economic story stays reproducible run to run, same requirement
// (§4.2 "same DB + same seed = same result") as everything else here.
function restockIntervalDays(managementLevel: number): number {
  return Math.max(1, 5 - managementLevel);
}

const BASE_TARGET_INPUT_BUFFER = 15; // units of input good a business tries to keep on hand
const BUFFER_PER_MANAGEMENT_LEVEL = 5;
const BASE_RESTOCK_QUANTITY = 10; // units bought per restock attempt, when it happens
const RESTOCK_QUANTITY_PER_MANAGEMENT_LEVEL = 6;
const OUTPUT_RESERVE = 10; // keep this many of its own output on hand before selling the rest
// Sells at most this many units of surplus per day, even if the surplus is
// larger — real found reason, not a guess: without a cap, a week's whole
// batch of production could dump into the market in a single day right
// after the weekly cadence runs, and (before hasKnownDemand existed) an
// unwanted good's surplus would spike the same way every day forever.
// Bounding daily volume keeps both each cadence call and the market's own
// item churn predictable regardless of how large a week's production run.
const MAX_DAILY_SALE_QUANTITY = 15;

function managementLevelFor(db: Database, company: Company): number {
  return company.ownerId ? getLevel(db, company.ownerId, MANAGEMENT_SKILL) : NEUTRAL_MANAGEMENT_LEVEL;
}

// §9.4 "Companies buy tools and equipment for their workers when viable...
// bought from toolmakers (or the merchant faucet early on)." No toolmaker
// company exists yet, so this is a plain market purchase — same honest
// "merchant faucet" simplification as shoes/cloaks (§7.2). Checked every
// day, unconditionally (not Management-gated like input restocking below):
// a job slot with zero tools is a hard stop on production entirely
// (jobs/shifts.ts's "no_tool" outcome) — even a sloppy owner eventually
// replaces a broken tool, they just don't manage input *buffers* well.
function restockEquipment(
  db: Database,
  bus: EventBus,
  company: Company,
  slots: JobSlot[],
  tick: number,
): void {
  for (const slot of slots) {
    if (!slot.toolGoodType) continue;
    if (countActiveItemsOfType(db, company.id, slot.toolGoodType) >= 1) continue;

    const bought = companyBuyFromMarket(db, bus, company.id, MARKET_SITE_ID, slot.toolGoodType, 1, tick);
    if (bought > 0) {
      bus.emit({
        tick,
        scope: 'business',
        actorId: company.id,
        type: 'company.equipment_purchased',
        message: `${company.name} buys a replacement ${slot.toolGoodType}.`,
        data: { goodType: slot.toolGoodType },
      });
    }
  }
}

// §9.5 "Growth & Upgrades": a profitable, well-managed, fully-staffed
// company invests in expanding — real capacity growth, not a cosmetic
// number. Gated on three real conditions, not a timer: every job slot is
// full (no room to hire into already), the company has been genuinely
// profitable over a real trailing window (not just solvent), and it can
// afford the cost outright. A sloppy owner (below MIN_MANAGEMENT_FOR_GROWTH)
// never recognizes the opportunity at all — same "Management... modifies
// decision quality" principle (§9.2) as the restock/sell logic above.
//
// Upgrade cost is modeled as a coin sink, not a real materials+builder-labor
// purchase (§9.5's "building work uses real materials and builder labor") —
// that needs the construction module (§Stage 6), which doesn't exist yet.
// Same honest simplification as every other "coin leaves for something not
// modeled yet" sink in this codebase (buying shoes/cloaks, resting at the
// tavern). Self-limiting by construction: once capacity grows, "every slot
// full" is false again until job-seeking (population/cadence.ts) catches
// up, so this can't fire twice in a row for the same company.
const CAPACITY_PER_TIER = 2;
const MAX_TOTAL_CAPACITY = 20; // §9.5's hard cap — assumes one job slot per company, true for every company that exists today
const BASE_UPGRADE_COST = 200;
const UPGRADE_COST_PER_TIER = 150; // "each tier's cost rises incrementally" (§9.5)
const UPGRADE_PROFIT_WINDOW_DAYS = 30;
const UPGRADE_PROFIT_THRESHOLD = 100;
const MIN_MANAGEMENT_FOR_GROWTH = 2;

function tryUpgrade(
  db: Database,
  bus: EventBus,
  company: Company,
  slots: JobSlot[],
  managementLevel: number,
  tick: number,
): void {
  if (slots.length === 0 || managementLevel < MIN_MANAGEMENT_FOR_GROWTH) return;

  const totalCapacity = slots.reduce((sum, slot) => sum + slot.capacity, 0);
  if (totalCapacity >= MAX_TOTAL_CAPACITY) return;

  const allSlotsFull = slots.every((slot) => countActiveEmploymentsForSlot(db, slot.id) >= slot.capacity);
  if (!allSlotsFull) return;

  const windowStart = Math.max(0, tick - UPGRADE_PROFIT_WINDOW_DAYS * MINUTES_PER_DAY);
  if (summarizeLedger(db, company.id, windowStart).net < UPGRADE_PROFIT_THRESHOLD) return;

  const cost = BASE_UPGRADE_COST + company.tier * UPGRADE_COST_PER_TIER;
  if (getBalance(db, company.id) < cost) return;

  sinkCoin(db, bus, company.id, cost, tick, `${company.name} invests in expanding.`, 'business');
  recordLedgerEntry(db, company.id, tick, 'material_cost', cost, 'Upgrade investment.');
  bumpCompanyTier(db, company.id);
  for (const slot of slots) {
    setJobSlotCapacity(db, slot.id, Math.min(slot.capacity + CAPACITY_PER_TIER, MAX_TOTAL_CAPACITY));
  }

  bus.emit({
    tick,
    scope: 'settlement',
    actorId: company.id,
    type: 'business.upgraded',
    message: `${company.name} expands, opening new positions (tier ${company.tier + 1}).`,
    data: { tier: company.tier + 1, cost },
  });
}

// §4.2 cadence: "daily (... business decisions ...)" and §9.6's own list —
// "production levels, prices, input orders... repairs, equipment
// purchases, upgrade investment, freight contracting." Builds input
// restocking, output selling, equipment replacement, and upgrade-tier
// growth, all Management-weighted, plus a minimal real insolvency signal.
// True standing B2B contracts with freight (§9.7 — needs the transport
// module, which doesn't exist yet) and closure->auction (§9.6's "permanent
// failure -> auction") are still not built — named gaps, not silent ones;
// see DECISIONS.md.
export function applyCompanyDailyCadence(db: Database, bus: EventBus, tick: number): void {
  const day = tick / MINUTES_PER_DAY;

  for (const company of listCompanies(db)) {
    const managementLevel = managementLevelFor(db, company);
    const slots = listJobSlotsForCompany(db, company.id);

    restockEquipment(db, bus, company, slots, tick);
    tryUpgrade(db, bus, company, slots, managementLevel, tick);

    const recipes = slots.map((slot) => getRecipeForSkill(slot.skill)).filter((r): r is Recipe => r !== null);

    for (const recipe of recipes) {
      if (recipe.inputGood && day % restockIntervalDays(managementLevel) === 0) {
        const stock = countActiveItemsOfType(db, company.id, recipe.inputGood);
        const targetBuffer = BASE_TARGET_INPUT_BUFFER + managementLevel * BUFFER_PER_MANAGEMENT_LEVEL;
        if (stock < targetBuffer) {
          const restockQty = BASE_RESTOCK_QUANTITY + managementLevel * RESTOCK_QUANTITY_PER_MANAGEMENT_LEVEL;
          companyBuyFromMarket(db, bus, company.id, MARKET_SITE_ID, recipe.inputGood, restockQty, tick);
        }
      }

      if (hasKnownDemand(recipe.outputGood)) {
        const stock = countActiveItemsOfType(db, company.id, recipe.outputGood);
        const surplus = Math.min(stock - OUTPUT_RESERVE, MAX_DAILY_SALE_QUANTITY);
        if (surplus > 0) {
          const price =
            getListing(db, MARKET_SITE_ID, recipe.outputGood)?.price ??
            getGoodDefinition(recipe.outputGood).basePrice;
          sellSurplusToMarket(db, bus, company.id, MARKET_SITE_ID, recipe.outputGood, surplus, price, tick);
        }
      }
    }

    // §9.6/§11.5 "insolvency": a real, minimal signal — first tick balance
    // hit zero, cleared the moment it recovers. Not closure/auction (see
    // this function's own header comment).
    const balance = getBalance(db, company.id);
    if (balance <= 0) {
      if (company.insolventSinceTick === null) {
        setCompanyInsolvency(db, company.id, tick);
        bus.emit({
          tick,
          scope: 'settlement',
          actorId: company.id,
          type: 'business.distressed',
          message: `${company.name} has run out of coin.`,
          data: {},
        });
      }
    } else if (company.insolventSinceTick !== null) {
      setCompanyInsolvency(db, company.id, null);
    }
  }
}
