import { queryRow } from '../db/sqlite';
import { getEntityName } from '../entities';
import { getGoodDefinition } from '../goods/catalog';
import {
  countActiveItemsOfType,
  destroyItem,
  listActiveItemsInContainer,
  transferItem,
} from '../inventory/items';
import { getBalance, sinkCoin, transferCoin } from '../inventory/wallet';
import {
  countActiveEmploymentsForSlot,
  listActiveEmploymentsForSlot,
  listJobSlotsForCompany,
  quitJob,
  setJobSlotCapacity,
  setJobSlotMaxCapacity,
  terminateAllEmploymentsForCompany,
  type JobSlot,
} from '../jobs/jobs';
import { recordMarketActivity } from '../market/activity';
import {
  companyBuyFromMarket,
  getListing,
  marketStockContainerId,
  seedListing,
  sellSurplusToMarket,
} from '../market/market';
import { WORKDAYS_PER_WEEK, weeklyFoodCost } from '../population/cadence';
import { getHouseholdIdForMember } from '../population/households';
import { getTrait } from '../population/traits';
import { getRecipeForSkill, inputPerShift, type Recipe } from '../production/recipes';
import { addXp, getLevel, MANAGEMENT_SKILL } from '../skills/skills';
import { MINUTES_PER_DAY } from '../time/clock';
import { payWeeklyRent } from '../world/tenure';
import {
  bumpCompanyTier,
  closeCompany,
  getCompanyManagerId,
  listCompanies,
  recentDailySalesUnits,
  recordLedgerEntry,
  setCompanyInsolvency,
  setCompanyMilestone,
  summarizeLedger,
  type Company,
} from './companies';
import { getFoundingRecord } from './founding';
import { buyFromLocalSuppliers, tradePrice } from './trade';
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
const MANAGEMENT_XP_PER_WEEK = 4;

// How many days between restock attempts, by Management level (0-5) — a
// well-run business (§11.5: "the well-managed woodcutter thrives") checks
// its input stock daily; a sloppy one only gets around to it once a week.
// This is deliberately deterministic (not a per-day dice roll) so a given
// seed's economic story stays reproducible run to run, same requirement
// (§4.2 "same DB + same seed = same result") as everything else here.
function restockIntervalDays(managementLevel: number): number {
  return Math.max(1, 5 - managementLevel);
}

// §9.6 "input orders", Management-weighted (§9.2). Every owner forecasts
// next days' input need from its staffing (inputPerShift × workers) and
// buys up to that plus a buffer — but what they pay attention to scales
// with Management:
//   - level >= DEMAND_AWARE_LEVEL: holds off buying while its own output
//     sits unsold (in its stock or consigned at market) beyond a few days'
//     worth — it produces to demand instead of into a glut;
//   - level >= MARGIN_AWARE_LEVEL: won't buy input that costs more than
//     the output it makes would fetch (a negative margin);
//   - level >= CASH_AWARE_LEVEL: keeps a week's wages in hand rather than
//     spending its last coin on stock.
// A sloppy owner ignores all three: over-buys into gluts and price spikes,
// and can starve its own payroll. Restock timing still scales too
// (restockIntervalDays). Deterministic thresholds, not dice.
const INPUT_BUFFER_DAYS = 2;
// A demand-aware owner plans input from the last fortnight's actual sales
// (plus headroom to grow into rising demand), not from what its workers
// could process flat out — never below a floor fraction of capacity, so a
// business with no sales history yet (or a dip) still produces something
// to sell.
const SALES_WINDOW_DAYS = 14;
const DEMAND_HEADROOM = 1.25;
const MIN_PLANNED_FRACTION_OF_CAPACITY = 0.25;
const DEMAND_AWARE_LEVEL = 2;
const MARGIN_AWARE_LEVEL = 3;
const CASH_AWARE_LEVEL = 3;

// The skill of whoever actually runs the place (§9.2) — its manager when
// one is appointed, otherwise its owner (companies.ts's getCompanyManagerId).
function managementLevelFor(db: Database, company: Company): number {
  const managerId = getCompanyManagerId(company);
  return managerId ? getLevel(db, managerId, MANAGEMENT_SKILL) : NEUTRAL_MANAGEMENT_LEVEL;
}

// How long this company has been operating — its own track record, not the
// world's age (a business founded in year two has no year-one history).
function ageTicks(company: Company, tick: number): number {
  return tick - company.foundedAtTick;
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

function weeklyWageBill(db: Database, slots: JobSlot[]): number {
  let total = 0;
  for (const slot of slots) {
    for (const employment of listActiveEmploymentsForSlot(db, slot.id))
      total += employment.wage * WORKDAYS_PER_WEEK;
  }
  return total;
}

// Output this company still hasn't sold: its own stock plus units it has
// consigned to the market that nobody has bought yet.
//
// "Too much unsold" is judged against the MARKET, not the producer's own
// capacity: more than the good's healthy market stock (its catalog
// marketReferenceStock, ~two days of the town's demand) is a glut. An
// earlier version compared against the producer's daily output, so a
// high-capacity mill considered ~170 unsold sacks normal and kept buying.
function isGlutted(db: Database, companyId: string, goodType: string): boolean {
  const reference = getGoodDefinition(goodType).marketReferenceStock ?? Infinity;
  return unsoldOutput(db, companyId, goodType) > reference;
}

function unsoldOutput(db: Database, companyId: string, goodType: string): number {
  const own = countActiveItemsOfType(db, companyId, goodType);
  const consigned = Number(
    queryRow(
      db,
      `SELECT COUNT(*) FROM market_consignments
       JOIN items ON items.id = market_consignments.item_id
       WHERE market_consignments.consignor_id = ? AND items.type = ? AND items.status = 'active'`,
      [companyId, goodType],
    )?.[0] ?? 0,
  );
  return own + consigned;
}

// The floor under all of that, whatever the Management: nobody hires hands
// and then gives them nothing to work. Any day the business doesn't hold a
// day's input for its current workers, it tops up to that much — even on
// a day its owner's restocking habit wouldn't otherwise bring them to the
// stall. (Before 2026-10-06 a Management-0 bakery opened with two bakers and
// no flour, and bought none until its fifth-day restock.) The skilled
// judgements still apply on top: a demand-aware owner deliberately idles
// while its own goods sit unsold, a margin-aware one won't buy at a loss.
//
// Where it buys: straight from local producers first (companies/trade.ts —
// cheaper, and the producer is glad of the sale), then the market stall.
// If the input has never been sold here at all, the business puts in an
// order with the merchant (an empty listing the merchant then stocks,
// market/merchant.ts) rather than waiting forever for a stall that
// doesn't exist.
function restockInputs(
  db: Database,
  bus: EventBus,
  company: Company,
  slot: JobSlot,
  recipe: Recipe,
  managementLevel: number,
  tick: number,
): void {
  if (!recipe.inputGood) return;
  const workers = countActiveEmploymentsForSlot(db, slot.id);
  if (workers === 0) return;
  const onHand = countActiveItemsOfType(db, company.id, recipe.inputGood);
  const dayOfWork = Math.ceil(inputPerShift(recipe) * workers);
  const habitualRestockDay = (tick / MINUTES_PER_DAY) % restockIntervalDays(managementLevel) === 0;
  if (!habitualRestockDay && onHand >= dayOfWork) return;

  const capacityDailyInput = (inputPerShift(recipe) * workers * WORKDAYS_PER_WEEK) / 7;
  let dailyInput = capacityDailyInput;
  if (
    managementLevel >= DEMAND_AWARE_LEVEL &&
    ageTicks(company, tick) > SALES_WINDOW_DAYS * MINUTES_PER_DAY
  ) {
    const sales = recentDailySalesUnits(
      db,
      company.id,
      tick - SALES_WINDOW_DAYS * MINUTES_PER_DAY,
      SALES_WINDOW_DAYS,
    );
    const demandInput = ((sales * recipe.inputUnits) / recipe.outputUnits) * DEMAND_HEADROOM;
    dailyInput = Math.min(
      capacityDailyInput,
      Math.max(demandInput, capacityDailyInput * MIN_PLANNED_FRACTION_OF_CAPACITY),
    );
  }
  if (managementLevel >= DEMAND_AWARE_LEVEL && isGlutted(db, company.id, recipe.outputGood)) return;

  const inputDef = getGoodDefinition(recipe.inputGood);
  if (!getListing(db, MARKET_SITE_ID, recipe.inputGood) && inputDef.merchantImports) {
    seedListing(db, MARKET_SITE_ID, recipe.inputGood, Math.ceil(inputDef.basePrice * MERCHANT_ASK_FACTOR), 0);
  }
  const price = tradePrice(db, recipe.inputGood);
  if (managementLevel >= MARGIN_AWARE_LEVEL) {
    const outputPrice =
      getListing(db, MARKET_SITE_ID, recipe.outputGood)?.price ??
      getGoodDefinition(recipe.outputGood).basePrice;
    if (price * recipe.inputUnits >= outputPrice * recipe.outputUnits) return;
  }

  const target = habitualRestockDay
    ? Math.max(dayOfWork, Math.ceil(dailyInput * (restockIntervalDays(managementLevel) + INPUT_BUFFER_DAYS)))
    : dayOfWork;
  let quantity = target - onHand;
  if (managementLevel >= CASH_AWARE_LEVEL) {
    // A couple of days' wages kept back, not a week's: input is what
    // generates the revenue that pays wages, and an earlier version that
    // held a full week back starved a cash-poor mill of grain until it
    // closed.
    const spendable = getBalance(db, company.id) - (2 * weeklyWageBill(db, [slot])) / WORKDAYS_PER_WEEK;
    quantity = Math.min(quantity, Math.floor(spendable / price));
  }
  if (quantity <= 0) return;
  const direct = buyFromLocalSuppliers(db, bus, company, recipe.inputGood, quantity, tick);
  if (quantity - direct > 0) {
    companyBuyFromMarket(db, bus, company.id, MARKET_SITE_ID, recipe.inputGood, quantity - direct, tick);
  }
}

// The merchant's asking price for something he has to fetch (market/
// merchant.ts imports at no less than 1.5× base) — what an order for a good
// nobody sells here is opened at.
const MERCHANT_ASK_FACTOR = 1.5;

// §9.3: a profitable business pays its owner. Weekly, half of the trailing
// four weeks' operating profit not already drawn is paid to the owner's
// household — never digging into a cash reserve of two weeks' wages plus a
// working-capital floor. Before the 2026-10-06 balancing pass profit had
// nowhere to go but the company's own wallet, so money pooled in firms
// while households drained.
const DRAW_WINDOW_DAYS = 28;
const DRAW_SHARE = 0.5;
const DRAW_RESERVE_FLOOR = 500;
// Beyond this much idle cash (six weeks' wages plus the next upgrade's
// cost) an owner draws the excess too: the first balancing iterations showed
// profitable firms hoarding thousands while households scraped by.
const DRAW_CASH_CEILING_WEEKS = 6;

function payOwnerDraw(db: Database, bus: EventBus, company: Company, slots: JobSlot[], tick: number): void {
  if (!company.ownerId) return;
  const ownerHousehold = getHouseholdIdForMember(db, company.ownerId) ?? company.ownerId;
  const ledger = summarizeLedger(db, company.id, Math.max(0, tick - DRAW_WINDOW_DAYS * MINUTES_PER_DAY));
  const undrawnProfit = Math.floor(ledger.net * DRAW_SHARE) - ledger.ownerDraws;
  const wages = weeklyWageBill(db, slots);
  const cash = getBalance(db, company.id);
  const reserve = DRAW_RESERVE_FLOOR + 2 * wages;
  const ceiling =
    DRAW_RESERVE_FLOOR +
    DRAW_CASH_CEILING_WEEKS * wages +
    BASE_UPGRADE_COST +
    company.tier * UPGRADE_COST_PER_TIER;
  const draw = Math.min(Math.max(undrawnProfit, cash - ceiling), cash - reserve);
  if (draw <= 0) return;
  transferCoin(
    db,
    bus,
    company.id,
    ownerHousehold,
    draw,
    tick,
    `${company.name} pays its owner ${draw} coin.`,
    'business',
  );
  recordLedgerEntry(db, company.id, tick, 'owner_draw', draw, 'Owner draw.');
  bus.emit({
    tick,
    scope: 'business',
    actorId: company.id,
    type: 'business.owner_draw',
    message: `Pays its owner, ${getEntityName(db, company.ownerId)}, ${draw} coin from its profits.`,
    data: { ownerId: company.ownerId, amount: draw },
  });
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
const BASE_UPGRADE_COST = 1000;
const UPGRADE_COST_PER_TIER = 750; // "each tier's cost rises incrementally" (§9.5)
const UPGRADE_PROFIT_WINDOW_DAYS = 30;
const UPGRADE_PROFIT_THRESHOLD = 500;
const MIN_MANAGEMENT_FOR_GROWTH = 2;
// 2026-10-06 balancing pass: the first iteration let a full roster plus one
// profitable month trigger an upgrade every few days — the logging camp
// went 4 -> 14 workers in two months and then bled wages exporting a
// firewood glut. An upgrade is now an occasional investment that needs
// evidence of demand (output selling through), not just a full roster.
const UPGRADE_COOLDOWN_DAYS = 90;
const UPGRADE_CASH_RESERVE_WEEKS = 4;

function tryUpgrade(
  db: Database,
  bus: EventBus,
  company: Company,
  slots: JobSlot[],
  managementLevel: number,
  tick: number,
): void {
  if (slots.length === 0 || managementLevel < MIN_MANAGEMENT_FOR_GROWTH) return;
  // A new business waits the same cooldown from its founding as from an
  // upgrade: a quarter's evidence before it invests in growing.
  if ((tick - (company.lastUpgradedTick ?? company.foundedAtTick)) / MINUTES_PER_DAY < UPGRADE_COOLDOWN_DAYS)
    return;

  const totalMax = slots.reduce((sum, slot) => sum + slot.maxCapacity, 0);
  if (totalMax >= MAX_TOTAL_CAPACITY) return;

  // Every position the current tier supports is posted and filled...
  const atCapacity = slots.every(
    (slot) =>
      slot.capacity >= slot.maxCapacity && countActiveEmploymentsForSlot(db, slot.id) >= slot.capacity,
  );
  if (!atCapacity) return;

  // ...the business is genuinely profitable...
  const windowStart = Math.max(0, tick - UPGRADE_PROFIT_WINDOW_DAYS * MINUTES_PER_DAY);
  if (summarizeLedger(db, company.id, windowStart).net < UPGRADE_PROFIT_THRESHOLD) return;

  // ...and everything it makes is selling, so more hands means more sales.
  for (const slot of slots) {
    const recipe = getRecipeForSkill(slot.skill);
    if (recipe && isGlutted(db, company.id, recipe.outputGood)) return;
  }

  const cost = BASE_UPGRADE_COST + company.tier * UPGRADE_COST_PER_TIER;
  if (getBalance(db, company.id) < cost + UPGRADE_CASH_RESERVE_WEEKS * weeklyWageBill(db, slots)) return;

  sinkCoin(db, bus, company.id, cost, tick, `${company.name} invests in expanding.`, 'business', 'upgrade');
  recordLedgerEntry(db, company.id, tick, 'material_cost', cost, 'Upgrade investment.');
  bumpCompanyTier(db, company.id, tick);
  for (const slot of slots) {
    const maxCapacity = Math.min(slot.maxCapacity + CAPACITY_PER_TIER, MAX_TOTAL_CAPACITY);
    setJobSlotMaxCapacity(db, slot.id, maxCapacity);
    setJobSlotCapacity(db, slot.id, maxCapacity);
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

// §9.6 "hiring/dismissal", weekly and Management-weighted. A company losing
// money over the last four weeks, or sitting on a glut of its own unsold
// output, lets its most recent hire go and stops posting that position. A
// profitable one whose output is selling through re-posts a position, up
// to what its tier supports (re-posting is free; only an upgrade raises the
// ceiling). The owner is never dismissed from their own business. A
// Management-0 owner never adjusts at all — it just carries whatever
// roster it has, for better or worse. Before 2026-10-06 companies could
// only ever hire, so a business with no use for its workers paid them
// until it went under.
const STAFFING_MIN_MANAGEMENT = 1;
const STAFFING_WINDOW_DAYS = 28;

function adjustStaffing(
  db: Database,
  bus: EventBus,
  company: Company,
  slots: JobSlot[],
  managementLevel: number,
  tick: number,
): void {
  if (managementLevel < STAFFING_MIN_MANAGEMENT) return;
  if (ageTicks(company, tick) < STAFFING_WINDOW_DAYS * MINUTES_PER_DAY) return; // no track record yet
  const net = summarizeLedger(db, company.id, tick - STAFFING_WINDOW_DAYS * MINUTES_PER_DAY).net;

  for (const slot of slots) {
    const recipe = getRecipeForSkill(slot.skill);
    if (!recipe) continue;
    const employments = listActiveEmploymentsForSlot(db, slot.id);
    const glutted = isGlutted(db, company.id, recipe.outputGood);

    if (net < 0 || glutted) {
      const dismissable = employments.filter((e) => e.entityId !== company.ownerId);
      const latest = dismissable[dismissable.length - 1];
      if (!latest) continue;
      quitJob(db, bus, latest.entityId, tick, {
        scope: 'settlement',
        message: `${company.name} lets ${getEntityName(db, latest.entityId)} go — ${glutted ? 'its goods are piling up unsold' : 'the business is losing money'}.`,
      });
      setJobSlotCapacity(db, slot.id, Math.max(1, employments.length - 1));
    } else if (net > 0 && slot.capacity < slot.maxCapacity && !glutted) {
      setJobSlotCapacity(db, slot.id, slot.capacity + 1);
      bus.emit({
        tick,
        scope: 'business',
        actorId: company.id,
        type: 'company.hiring',
        message: `${company.name} posts another ${slot.title} position.`,
        data: { jobSlotId: slot.id },
      });
    }
  }
}

// §9.6 "permanent failure -> auction": everything a closing company still
// holds gets liquidated in one pass. Tools/equipment go to real auction —
// transferred into the market's own stock (§7.1 provenance: a real
// transfer, not conjured away) so any company or the player can genuinely
// buy a used hoe or axe afterward, same mechanism as an ordinary sale
// (market.ts's sellSurplusToMarket precedent) but explicitly unbacked (no
// producerCompanyId — the seller no longer exists to be paid; whoever buys
// it just pays into the void, the same "merchant faucet" simplification as
// shoes/cloaks). A fresh auction listing starts at a discount off base
// price; merging into an already-existing listing leaves that listing's
// live (smoothed-pricing-managed) price alone rather than fighting it.
// Anything else — raw materials, unsold output — has no buyer once its
// producer is gone, so it spoils rather than joining a market listing that
// would otherwise incorrectly imply a real product moving through.
const AUCTION_STARTING_PRICE_FACTOR = 0.5;
const AUCTION_REFERENCE_STOCK = 5;

function liquidateCompany(
  db: Database,
  bus: EventBus,
  company: Company,
  slots: JobSlot[],
  tick: number,
): void {
  const toolTypes = new Set(slots.map((slot) => slot.toolGoodType).filter((t): t is string => t !== null));

  for (const item of listActiveItemsInContainer(db, company.id)) {
    if (toolTypes.has(item.type)) {
      transferItem(db, bus, item.id, marketStockContainerId(MARKET_SITE_ID), tick, {
        note: `${company.name}'s closure sends a ${item.type} to auction.`,
        scope: 'settlement',
      });
      const listing = getListing(db, MARKET_SITE_ID, item.type);
      if (listing) {
        db.run('UPDATE market_listings SET quantity = quantity + 1 WHERE id = ?', [listing.id]);
      } else {
        const startingPrice = Math.max(
          1,
          Math.round(getGoodDefinition(item.type).basePrice * AUCTION_STARTING_PRICE_FACTOR),
        );
        db.run(
          `INSERT INTO market_listings (site_id, good_type, price, quantity, reference_stock)
           VALUES (?, ?, ?, 1, ?)`,
          [MARKET_SITE_ID, item.type, startingPrice, AUCTION_REFERENCE_STOCK],
        );
      }
      recordMarketActivity(db, {
        siteId: MARKET_SITE_ID,
        tick,
        kind: 'listed',
        goodType: item.type,
        quantity: 1,
        unitPrice: getListing(db, MARKET_SITE_ID, item.type)?.price ?? 0,
        sellerId: company.id,
        buyerId: null,
      });
    } else {
      destroyItem(db, bus, item.id, 'spoiled', tick, {
        note: `${company.name}'s remaining stock spoils after closure.`,
        scope: 'settlement',
      });
    }
  }
}

// A company that stays insolvent past its own Management-weighted grace
// period closes for good — badly-managed businesses "fail for real
// reasons" (§8.1 rule 3), but a well-managed owner works harder to avoid
// outright failure first, hence the grace period scaling with Management
// the same way restocking reliability does (§9.2). Deterministic (day-count
// threshold, not a dice roll) for the same reproducibility reason as
// restockIntervalDays above.
const CLOSURE_BASE_GRACE_DAYS = 10;
const CLOSURE_GRACE_DAYS_PER_MANAGEMENT_LEVEL = 4;

function tryCloseCompany(
  db: Database,
  bus: EventBus,
  company: Company,
  managementLevel: number,
  tick: number,
): boolean {
  if (company.insolventSinceTick === null) return false;

  const daysInsolvent = (tick - company.insolventSinceTick) / MINUTES_PER_DAY;
  const graceDays = CLOSURE_BASE_GRACE_DAYS + managementLevel * CLOSURE_GRACE_DAYS_PER_MANAGEMENT_LEVEL;
  if (daysInsolvent < graceDays) return false;

  shutDownCompany(db, bus, company, tick, {
    message: `${company.name} closes its doors for good, unable to recover from its debts.`,
    reason: 'insolvency',
    data: { daysInsolvent: Math.floor(daysInsolvent) },
  });
  return true;
}

// The one closure path (§9.6), whatever the reason — insolvency, an owner
// winding a hopeless business down, or seed content describing a business
// that failed before the game began: every worker is let go, tools go to
// auction and leftover stock spoils (liquidateCompany), any cash left after
// that is the owner's equity and returns to their household, and the
// company closes, giving up its land (companies.ts's closeCompany).
export function shutDownCompany(
  db: Database,
  bus: EventBus,
  company: Company,
  tick: number,
  params: {
    message: string;
    reason: 'insolvency' | 'wound_down' | 'failed_before_start';
    data?: Record<string, unknown>;
  },
): void {
  const slots = listJobSlotsForCompany(db, company.id);
  terminateAllEmploymentsForCompany(db, bus, company.id, tick, params.message);
  liquidateCompany(db, bus, company, slots, tick);

  const remaining = getBalance(db, company.id);
  if (remaining > 0 && company.ownerId) {
    const ownerPurse = getHouseholdIdForMember(db, company.ownerId) ?? company.ownerId;
    transferCoin(
      db,
      bus,
      company.id,
      ownerPurse,
      remaining,
      tick,
      `${company.name}'s remaining ${remaining} coin goes back to its owner.`,
      'settlement',
    );
    recordLedgerEntry(db, company.id, tick, 'owner_draw', remaining, 'Remaining cash returned on closure.');
  }

  const lifetime = summarizeLedger(db, company.id, 0);
  closeCompany(db, company.id, tick);
  bus.emit({
    tick,
    scope: 'settlement',
    actorId: company.id,
    type: 'business.closed',
    message: params.message,
    data: {
      ...params.data,
      reason: params.reason,
      ownerId: company.ownerId,
      ageDays: Math.floor((tick - company.foundedAtTick) / MINUTES_PER_DAY),
      lifetimeRevenue: lifetime.revenue,
      lifetimeNet: lifetime.net,
      returnedToOwner: Math.max(0, remaining),
    },
  });
}

// §9.3: an owner propping up a business that has run short of cash, out of
// their own household's savings — real money moving between real purses,
// never created. Whether they do, and how much they'll risk:
//   - only when the business is down to less than a week's wages, at most
//     once every four weeks, topping it up toward two weeks' wages;
//   - never out of the household's own cushion (a month's food), and only
//     part of what's above it, more the more risk-tolerant the owner;
//   - a competent manager (DEMAND_AWARE_LEVEL+) only rescues a business
//     that's still earning more than its materials cost over the last four
//     weeks (or is in its first month) — a cash crunch, not a hopeless
//     case. A poor one throws good money after bad: it injects regardless,
//     which is exactly how a sloppy owner drains the family purse holding
//     onto a failing business too long.
const INJECTION_TRIGGER_WEEKS = 1;
const INJECTION_TARGET_WEEKS = 2;
const INJECTION_COOLDOWN_DAYS = 28;
const OWNER_CUSHION_FOOD_WEEKS = 4;
const INJECTION_VIABILITY_WINDOW_DAYS = 28;

function considerOwnerInjection(
  db: Database,
  bus: EventBus,
  company: Company,
  slots: JobSlot[],
  managementLevel: number,
  tick: number,
): void {
  if (!company.ownerId) return;
  const wages = weeklyWageBill(db, slots);
  if (wages <= 0) return;
  const cash = getBalance(db, company.id);
  if (cash >= wages * INJECTION_TRIGGER_WEEKS) return;

  const lastInjection = queryRow(
    db,
    "SELECT MAX(tick) FROM company_ledger_entries WHERE company_id = ? AND kind = 'owner_contribution'",
    [company.id],
  )?.[0];
  if (typeof lastInjection === 'number' && tick - lastInjection < INJECTION_COOLDOWN_DAYS * MINUTES_PER_DAY)
    return;

  if (
    managementLevel >= DEMAND_AWARE_LEVEL &&
    ageTicks(company, tick) >= INJECTION_VIABILITY_WINDOW_DAYS * MINUTES_PER_DAY
  ) {
    const recent = summarizeLedger(db, company.id, tick - INJECTION_VIABILITY_WINDOW_DAYS * MINUTES_PER_DAY);
    if (recent.revenue - recent.materialCost <= 0) return;
  }

  const purse = getHouseholdIdForMember(db, company.ownerId) ?? company.ownerId;
  const spare = getBalance(db, purse) - OWNER_CUSHION_FOOD_WEEKS * weeklyFoodCost(db, purse);
  const willingShare = 0.25 + 0.75 * getTrait(db, company.ownerId, 'risk_tolerance');
  const amount = Math.floor(Math.min(wages * INJECTION_TARGET_WEEKS - cash, spare * willingShare));
  if (amount <= 0) return;

  const ownerName = getEntityName(db, company.ownerId);
  transferCoin(
    db,
    bus,
    purse,
    company.id,
    amount,
    tick,
    `${ownerName} puts ${amount} coin into ${company.name}.`,
    'business',
  );
  recordLedgerEntry(db, company.id, tick, 'owner_contribution', amount, 'Owner injects savings.');
  bus.emit({
    tick,
    scope: 'settlement',
    actorId: company.id,
    type: 'business.owner_injection',
    message: `${ownerName} puts ${amount} coin of the family's savings into ${company.name} to keep it going.`,
    data: { ownerId: company.ownerId, amount, companyCashBefore: cash },
  });
}

// §9.6 "temporary closure ... permanent failure", the competent version: an
// owner who can read their own books closes a business that keeps losing
// money before it runs dry, and keeps what's left (shutDownCompany returns
// remaining cash to the owner). Needs MARGIN_AWARE_LEVEL Management — a
// poor manager doesn't see it coming and rides the business into
// insolvency instead (tryCloseCompany). Judged on runway: losing money over
// the last twelve weeks AND the last four, with cash for fewer than
// WIND_DOWN_RUNWAY_WEEKS more weeks of those losses. A business with deep
// reserves rides out a bad stretch; a new one gets a season first.
const WIND_DOWN_MIN_AGE_DAYS = 120;
const WIND_DOWN_LONG_WINDOW_DAYS = 84;
const WIND_DOWN_SHORT_WINDOW_DAYS = 28;
const WIND_DOWN_RUNWAY_WEEKS = 8;

function tryWindDown(
  db: Database,
  bus: EventBus,
  company: Company,
  managementLevel: number,
  tick: number,
): boolean {
  if (managementLevel < MARGIN_AWARE_LEVEL) return false;
  if (ageTicks(company, tick) < WIND_DOWN_MIN_AGE_DAYS * MINUTES_PER_DAY) return false;
  const longNet = summarizeLedger(db, company.id, tick - WIND_DOWN_LONG_WINDOW_DAYS * MINUTES_PER_DAY).net;
  if (longNet >= 0) return false;
  if (summarizeLedger(db, company.id, tick - WIND_DOWN_SHORT_WINDOW_DAYS * MINUTES_PER_DAY).net >= 0)
    return false;
  const weeklyLoss = -longNet / (WIND_DOWN_LONG_WINDOW_DAYS / 7);
  if (getBalance(db, company.id) >= weeklyLoss * WIND_DOWN_RUNWAY_WEEKS) return false;

  shutDownCompany(db, bus, company, tick, {
    message: `${company.name} winds down while it still can — its owner won't pour more into a business losing money week after week.`,
    reason: 'wound_down',
    data: { weeklyLoss: Math.round(weeklyLoss) },
  });
  return true;
}

// Lifecycle milestones for the business log of a business founded during
// play (one with a founding record — companies/founding.ts): its first
// hired hand, and its first profitable four weeks. Seeded businesses
// predate the game and have neither story to tell.
const MILESTONE_PROFIT_WINDOW_DAYS = 28;

function recordMilestones(
  db: Database,
  bus: EventBus,
  company: Company,
  slots: JobSlot[],
  tick: number,
): void {
  if (company.firstHireTick !== null && company.firstProfitTick !== null) return;
  if (!getFoundingRecord(db, company.id)) return;

  if (company.firstHireTick === null) {
    const hired = slots
      .flatMap((slot) => listActiveEmploymentsForSlot(db, slot.id))
      .find((e) => e.entityId !== company.ownerId);
    if (hired) {
      setCompanyMilestone(db, company.id, 'first_hire_tick', tick);
      bus.emit({
        tick,
        scope: 'settlement',
        actorId: company.id,
        type: 'business.first_hire',
        message: `${company.name} takes on its first hired hand, ${getEntityName(db, hired.entityId)}.`,
        data: { entityId: hired.entityId },
      });
    }
  }
  if (
    company.firstProfitTick === null &&
    ageTicks(company, tick) >= MILESTONE_PROFIT_WINDOW_DAYS * MINUTES_PER_DAY
  ) {
    const net = summarizeLedger(db, company.id, tick - MILESTONE_PROFIT_WINDOW_DAYS * MINUTES_PER_DAY).net;
    if (net > 0) {
      setCompanyMilestone(db, company.id, 'first_profit_tick', tick);
      bus.emit({
        tick,
        scope: 'settlement',
        actorId: company.id,
        type: 'business.first_profit',
        message: `${company.name} turns its first profit: ${net} coin over the last four weeks.`,
        data: { net },
      });
    }
  }
}

// §4.2 cadence: "daily (... business decisions ...)" and §9.6's own list —
// "production levels, prices, input orders... repairs, equipment
// purchases, upgrade investment, freight contracting... permanent failure
// -> auction." Builds input restocking, output selling, equipment
// replacement, upgrade-tier growth, and closure->auction, all Management-
// weighted. True standing B2B contracts with freight (§9.7 — needs the
// transport module, which doesn't exist yet) are still not built — a named
// gap, not a silent one; see DECISIONS.md.
export function applyCompanyDailyCadence(db: Database, bus: EventBus, tick: number): void {
  const day = tick / MINUTES_PER_DAY;

  // Two passes. First every business decides and buys — so a mill shopping
  // for grain finds the farm's fresh harvest still in the farm's barn and
  // can buy it direct (companies/trade.ts). Then every business takes what
  // it has left to market and settles its week.
  const operating: { company: Company; slots: JobSlot[] }[] = [];
  for (const company of listCompanies(db)) {
    if (company.closedAtTick !== null) continue; // already closed — nothing left to decide

    const managementLevel = managementLevelFor(db, company);
    const slots = listJobSlotsForCompany(db, company.id);

    if (tryCloseCompany(db, bus, company, managementLevel, tick)) continue;
    if (day % 7 === 0 && tryWindDown(db, bus, company, managementLevel, tick)) continue;

    considerOwnerInjection(db, bus, company, slots, managementLevel, tick);
    restockEquipment(db, bus, company, slots, tick);
    tryUpgrade(db, bus, company, slots, managementLevel, tick);
    if (day % 7 === 0) adjustStaffing(db, bus, company, slots, managementLevel, tick);
    for (const slot of slots) {
      const recipe = getRecipeForSkill(slot.skill);
      if (recipe?.inputGood) restockInputs(db, bus, company, slot, recipe, managementLevel, tick);
    }
    operating.push({ company, slots });
  }

  for (const { company, slots } of operating) {
    for (const slot of slots) {
      const recipe = getRecipeForSkill(slot.skill);
      if (!recipe) continue;
      // Whatever no local business bought goes to market the same day — the
      // stall (and its stock-based price, market/pricing.ts) is where the
      // rest of demand is discovered. Unwanted surplus depresses the price,
      // the merchant exports a glut of exportable goods (market/
      // merchant.ts), and perishables spoil.
      const surplus = countActiveItemsOfType(db, company.id, recipe.outputGood);
      if (surplus > 0) {
        const price =
          getListing(db, MARKET_SITE_ID, recipe.outputGood)?.price ??
          getGoodDefinition(recipe.outputGood).basePrice;
        sellSurplusToMarket(db, bus, company.id, MARKET_SITE_ID, recipe.outputGood, surplus, price, tick);
      }
    }

    if (day % 7 === 0) {
      // Rent on leased land (world/tenure.ts) — an operating cost.
      const rent = payWeeklyRent(db, bus, company.id, tick);
      if (rent > 0) {
        recordLedgerEntry(db, company.id, tick, 'rent', rent, 'Weekly rent.');
        bus.emit({
          tick,
          scope: 'business',
          actorId: company.id,
          type: 'business.rent',
          message: `Pays ${rent} coin rent for its land.`,
          data: { amount: rent },
        });
      }
      payOwnerDraw(db, bus, company, slots, tick);
      recordMilestones(db, bus, company, slots, tick);
      // §9.2: "NPC Management skill grows with tenure like any other skill"
      // — never implemented before 2026-10-06, so a sloppy owner stayed
      // sloppy forever. Running a business for a week is the labor that
      // teaches it (about one level per in-game year at skills.ts's 200
      // XP/level — §13.1's "skill takes years"). It's whoever runs the
      // place who learns: the manager, when one is appointed.
      const managerId = getCompanyManagerId(company);
      if (managerId) addXp(db, managerId, MANAGEMENT_SKILL, MANAGEMENT_XP_PER_WEEK);
    }

    // §9.6/§11.5 "insolvency": first tick balance hit zero, cleared the
    // moment it recovers — tryCloseCompany above reads this to decide
    // whether a company's grace period has run out.
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
