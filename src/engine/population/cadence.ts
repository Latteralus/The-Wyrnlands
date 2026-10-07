import { getCompany, recordLedgerEntry } from '../companies/companies';
import { wearCompanyTool } from '../companies/tools';
import { queryRow, queryRows } from '../db/sqlite';
import { isBackgroundActor, createEntity, getEntityName } from '../entities';
import { getGoodDefinition } from '../goods/catalog';
import {
  countActiveItemsOfType,
  destroyItem,
  findFirstActiveItem,
  listActiveItemsInContainer,
  transferItem,
} from '../inventory/items';
import { ensureWallet, faucetCoin, getBalance, sinkCoin, transferCoin } from '../inventory/wallet';
import {
  applyForJob,
  countActiveEmploymentsForSlot,
  getActiveEmployment,
  listActiveEmploymentsForSlot,
  listJobOpenings,
  quitJob,
} from '../jobs/jobs';
import { SHIFT_XP, TOOL_WEAR_PER_SHIFT } from '../jobs/shifts';
import { recordMarketActivity } from '../market/activity';
import { buyFromMarket, getListing, marketStockContainerId, seedListing } from '../market/market';
import { clamp, ensureNeeds, getNeeds, type NeedKey } from '../needs/needs';
import { getRecipeForSkill } from '../production/recipes';
import { runProductionShift } from '../production/shift';
import { addXp, getLevel, getSuccessChance, MANAGEMENT_SKILL } from '../skills/skills';
import { MINUTES_PER_DAY } from '../time/clock';
import {
  addHouseholdMember,
  createHousehold,
  departHousehold,
  getHouseholdIdForMember,
  listHouseholdMembers,
  listHouseholds,
  setHouseholdDestitution,
  recordHouseholdFedDay,
  type Household,
} from './households';
import { FIRST_NAMES, SURNAMES, pick } from './npcGen';
import { provisionHousehold } from './provisions';
import type { Database } from '../db/sqlite';
import type { EventBus } from '../eventBus';

// Background aggregation (§4.2): NPC needs, wages, skill gain, and consumption
// resolve in daily/weekly passes rather than through per-tick action queues.
// This keeps the cost proportional to households/employments per day.
// Explicit simulation_mode selects the cadence independently of household
// membership: the named player can live in a household and remain foreground.
// The historical WASM-stack failure is fixed (PERFORMANCE_AUDIT.md); coarse
// NPC simulation remains the intended scale/performance architecture.
//
// Routine NPC transactions (buying bread, paying wages) go through the same
// produceItem/destroyItem/faucetCoin/etc. functions as the player's — that's
// what keeps the conservation audit correct — but pass scope: 'business',
// which nothing currently renders in any UI panel. That keeps the player's
// own personal log free of ~20 households' worth of daily grocery noise.
// scope: 'settlement' is reserved for genuine life events (hired, dismissed,
// a household's adaptation-ladder rung) — matching §14.3's settlement log
// content list ("hirings, evictions...") exactly.

const MARKET_SITE_ID = 'market';
const SUBSISTENCE_HUNGER = 35; // §8.2 "common land gathering" floor — hardship, not starvation
const WELL_FED_HUNGER = 100;
export const RESERVE_HEALTHY_THRESHOLD = 150; // coin — above this, a household isn't under strain
const CHARITY_STIPEND = 25; // §8.2 "church charity/poorhouse" stabilizer
export const CHARITY_THRESHOLD = 25; // coin — below this, sell belongings/take charity

// §8.2 "church charity/poorhouse": the parish is a real entity with a real
// purse. Households above a comfortable reserve tithe part of the excess
// weekly (applyParishTitheWeeklyCadence); charity is paid out of that fund.
// Only when the fund is empty does charity fall back to outside relief (a
// faucet, as all charity was before 2026-10-06). This turns the poor-relief
// floor into redistribution — coin pooling in a prosperous owner's purse
// flows back to the destitute — instead of a pure money printer.
export const PARISH_ID = 'parish';
export const TITHE_THRESHOLD = 300; // coin a household keeps before tithing anything
const TITHE_RATE = 0.1; // of the balance above the threshold, weekly
// Below this the parish can't keep carrying its destitute (see the daily
// destitution check) — about ten days of alms for a household.
const PARISH_HARDSHIP_RESERVE = 10 * CHARITY_STIPEND;

// A household's food bill for a week at today's bread price — the unit any
// "how much of a cushion does this household keep" rule is measured in
// (an owner propping up their business, an entrepreneur deciding how much
// to risk). A purse with no household (a lone foreground actor) counts as one.
export function weeklyFoodCost(db: Database, householdId: string): number {
  const members = Math.max(1, listHouseholdMembers(db, householdId).length);
  const price = getListing(db, MARKET_SITE_ID, 'bread')?.price ?? getGoodDefinition('bread').basePrice;
  return members * 7 * price;
}

export function ensureParish(db: Database): void {
  createEntity(db, PARISH_ID, 'The Parish');
  ensureWallet(db, PARISH_ID);
}

function directSetNeed(db: Database, entityId: string, need: NeedKey, value: number): void {
  const needs = getNeeds(db, entityId);
  if (!needs) return;
  db.run(`UPDATE needs SET ${need} = ? WHERE entity_id = ?`, [clamp(value), entityId]);
}

function directAdjustNeed(db: Database, entityId: string, need: NeedKey, delta: number): void {
  const needs = getNeeds(db, entityId);
  if (!needs) return;
  db.run(`UPDATE needs SET ${need} = ? WHERE entity_id = ?`, [clamp(needs[need] + delta), entityId]);
}

// A household's day of food and drink (population/provisions.ts): fetch
// water and stock up on bread toward a supply of several days, then drink
// and eat from that store. Members who ate are well fed; the rest scrape by
// on the commons (§8.2's floor) — the adaptation ladder (the caller) reacts
// to anyone going without, and the hunger tally feeds migration (§11.4).
function feedHousehold(
  db: Database,
  bus: EventBus,
  household: Household,
  members: string[],
  tick: number,
): number {
  const { fed, watered } = provisionHousehold(db, bus, household, members.length, tick);
  members.forEach((entityId, i) => {
    directSetNeed(db, entityId, 'thirst', watered ? 100 : 50);
    directSetNeed(db, entityId, 'hunger', i < fed ? WELL_FED_HUNGER : SUBSISTENCE_HUNGER);
  });
  return fed;
}

// §10's budget order is "food → housing → fuel → ...": after eating, a
// household exposed to winter cold buys and burns a day's firewood if it
// can still afford one — the logging camp's real domestic market. Without
// fuel, its members lose warmth through the day. Returns whether it burned
// a fire.
function heatHousehold(db: Database, bus: EventBus, household: Household, tick: number): boolean {
  const own = findFirstActiveItem(db, household.id, 'firewood');
  let firewoodId = own?.id ?? null;
  if (!firewoodId) {
    const listing = getListing(db, MARKET_SITE_ID, 'firewood');
    if (!listing || listing.quantity <= 0 || getBalance(db, household.id) < listing.price) return false;
    const purchase = buyFromMarket(db, bus, household.id, MARKET_SITE_ID, 'firewood', 1, tick, {
      note: `${household.name} buys firewood for the hearth.`,
      scope: 'business',
    });
    firewoodId = purchase.itemIds[0] ?? null;
  }
  if (!firewoodId) return false;
  destroyItem(db, bus, firewoodId, 'consumed', tick, {
    note: `${household.name} keeps a fire.`,
    scope: 'business',
  });
  return true;
}

const DAILY_WARMTH_SHIFT = 10;
const DAILY_ENERGY_REST = 25;

function applyDailyRestAndWarmth(db: Database, entityId: string, exposedToCold: boolean): void {
  directAdjustNeed(db, entityId, 'energy', DAILY_ENERGY_REST);
  directAdjustNeed(db, entityId, 'warmth', exposedToCold ? -DAILY_WARMTH_SHIFT : DAILY_WARMTH_SHIFT);
}

// A household with nothing to sell and no reserve just goes without —
// there's no belonging to find, so the search returning null is itself the
// correct, harsh answer; §10's "sell belongings" rung only fires when
// there's genuinely something to sell.
function findSellableBelonging(db: Database, householdId: string) {
  for (const type of ['cloak', 'firewood']) {
    const item = findFirstActiveItem(db, householdId, type);
    if (item) return item;
  }
  return null;
}

// §10's adaptation ladder, the rungs Stage 4 actually builds: sell a
// belonging, then charity — both real, logged settlement events. "Another
// member works" and "migrate" are named in §10 but not modeled yet (no NPC
// job-seeking behavior exists this stage — see DECISIONS.md); flagged, not
// silently dropped.
function evaluateHouseholdBudget(
  db: Database,
  bus: EventBus,
  household: Household,
  memberCount: number,
  tick: number,
): void {
  const balance = getBalance(db, household.id);
  if (balance >= RESERVE_HEALTHY_THRESHOLD) return;

  if (balance < CHARITY_THRESHOLD) {
    const sellable = findSellableBelonging(db, household.id);
    if (sellable) {
      const price = getGoodDefinition(sellable.type).basePrice;
      const note = `${household.name} sells a ${sellable.type} to make ends meet.`;
      transferItem(db, bus, sellable.id, marketStockContainerId(MARKET_SITE_ID), tick, {
        note,
        scope: 'settlement',
      });
      const listing = getListing(db, MARKET_SITE_ID, sellable.type);
      if (listing) {
        db.run('UPDATE market_listings SET quantity = quantity + 1 WHERE id = ?', [listing.id]);
      } else {
        seedListing(db, MARKET_SITE_ID, sellable.type, price, 1);
      }
      faucetCoin(db, bus, household.id, price, tick, note, 'settlement', 'sold_to_merchant');
      recordMarketActivity(db, {
        siteId: MARKET_SITE_ID,
        tick,
        kind: 'sold_to_stall',
        goodType: sellable.type,
        quantity: 1,
        unitPrice: price,
        sellerId: household.id,
        buyerId: null,
      });
      bus.emit({
        tick,
        scope: 'settlement',
        actorId: household.id,
        type: 'household.hardship.sold_belongings',
        message: note,
        data: { itemType: sellable.type, price },
      });
      return;
    }

    // Alms sized to feed the household — a loaf a head at today's price —
    // not a flat sum: a flat 25 coin bought a family of three two loaves, so
    // someone went without every single day (measured: the largest single
    // source of hunger in the 2026-10-06 balancing runs).
    const breadPrice = getListing(db, MARKET_SITE_ID, 'bread')?.price ?? getGoodDefinition('bread').basePrice;
    const alms = Math.max(CHARITY_STIPEND, memberCount * breadPrice);
    // Alms come only from the parish's own fund (tithes, §8.2). When it's
    // empty, there's nothing to give: the household falls back on the
    // commons (feedHousehold's subsistence floor), and sustained hunger
    // eventually pushes it to leave (§11.4). Before 2026-10-06 an empty
    // parish fell back to "outside relief" — coin from nowhere — and the
    // balancing runs showed that faucet quietly carrying two-thirds of the
    // town: 100,000-290,000 coin over two years, spent straight back out
    // on imported bread.
    ensureParish(db);
    if (getBalance(db, PARISH_ID) < alms) return;
    const charityNote = `${household.name} takes charity from the parish to get by.`;
    transferCoin(db, bus, PARISH_ID, household.id, alms, tick, charityNote, 'settlement');
    bus.emit({
      tick,
      scope: 'settlement',
      actorId: household.id,
      type: 'household.hardship.charity',
      message: charityNote,
      data: { amount: alms },
    });
  }
}

// §10: "The household is the central economic unit: ... shared money." Any
// coin sitting in a member's own wallet joins the household purse before
// the day's budget runs. NPC wages are paid straight to the household (see
// applyNpcLaborDailyCadence), so in a current world this is normally a
// no-op — it exists because they weren't, before 2026-10-06: wages landed
// in each worker's personal wallet, which nothing ever spent, while the
// household wallet that buys food drained to nothing (measured: by day 90
// of a 730-day run, 2,645 coin stranded across 14 workers' wallets vs. 184
// left across all 24 household purses). This sweep also recovers exactly
// that stranded coin in older saves. A transfer, not a faucet — conserved.
function poolMemberCoin(
  db: Database,
  bus: EventBus,
  household: Household,
  members: string[],
  tick: number,
): void {
  for (const memberId of members) {
    const balance = getBalance(db, memberId);
    if (balance > 0) {
      transferCoin(
        db,
        bus,
        memberId,
        household.id,
        balance,
        tick,
        `${getEntityName(db, memberId)} hands over their earnings.`,
        'business',
      );
    }
  }
}

// §4.2 cadence: "daily (... household budgets ...)." Runs once per in-game
// day for every household — feeding, needs upkeep, and the adaptation
// ladder, all in coarse per-household passes rather than per-tick.
export function applyHouseholdDailyCadence(
  db: Database,
  bus: EventBus,
  tick: number,
  exposedToCold: boolean,
): void {
  for (const household of listHouseholds(db)) {
    if (household.departedAtTick !== null) continue; // §11.4 — gone, nothing left to simulate
    const members = listHouseholdMembers(db, household.id).filter((id) => isBackgroundActor(db, id));
    if (members.length === 0) continue;

    poolMemberCoin(db, bus, household, members, tick);
    const fedCount = feedHousehold(db, bus, household, members, tick);
    const warm = exposedToCold ? heatHousehold(db, bus, household, tick) : true;
    for (const entityId of members) applyDailyRestAndWarmth(db, entityId, !warm);
    if (fedCount < members.length) {
      bus.emit({
        tick,
        scope: 'settlement',
        actorId: household.id,
        type: 'household.hardship.reduced_food',
        message: `${household.name} goes without a proper meal tonight.`,
        data: {},
      });
    }

    evaluateHouseholdBudget(db, bus, household, members.length, tick);

    // §11.4/§10's "migrate" rung: destitute = no employed member and living
    // hand to mouth (under twice the charity threshold) after this day's
    // adaptation-ladder attempts. Until the 2026-10-06 balancing pass the
    // bar was "below the charity threshold" itself, which a household on
    // charity crossed back over every day it was topped up — so the clock
    // reset daily and nobody ever emigrated, however long they lived on
    // alms.
    // Set/cleared daily, same shape as companies' insolvent_since_tick
    // (companies/decisions.ts) — applyHouseholdMigrationWeeklyCadence reads
    // this weekly to decide whether the grace period has run out.
    // ...and only once the parish can no longer carry it: a community
    // supports its poor while it can (§8.2), and people leave when it can't.
    // (Without this, every jobless household left within ~3 months even
    // with a well-funded parish, and the town spiraled down to a handful of
    // people.)
    const stillDestitute =
      getBalance(db, household.id) < 2 * CHARITY_THRESHOLD &&
      getBalance(db, PARISH_ID) < PARISH_HARDSHIP_RESERVE &&
      members.every((memberId) => getActiveEmployment(db, memberId) === null);
    if (stillDestitute) {
      if (household.destituteSinceTick === null) setHouseholdDestitution(db, household.id, tick);
    } else if (household.destituteSinceTick !== null) {
      setHouseholdDestitution(db, household.id, null);
    }

    // §11.4 push: "hunger" — tallied on every day the household couldn't
    // put a real meal in front of everyone (see households.ts's hungerDays).
    recordHouseholdFedDay(db, household.id, fedCount >= members.length);
  }
}

// §8.2: the weekly tithe that funds the parish's charity (see PARISH_ID).
export function applyParishTitheWeeklyCadence(db: Database, bus: EventBus, tick: number): void {
  ensureParish(db);
  for (const household of listHouseholds(db)) {
    if (household.departedAtTick !== null) continue;
    const tithe = Math.floor((getBalance(db, household.id) - TITHE_THRESHOLD) * TITHE_RATE);
    if (tithe <= 0) continue;
    transferCoin(
      db,
      bus,
      household.id,
      PARISH_ID,
      tithe,
      tick,
      `${household.name} tithes ${tithe} coin to the parish.`,
      'business',
    );
  }
}

// Six working days and a day of rest (day 7 of each week, when the weekly
// cadence runs). Five-day weeks left the bakery's shelf empty every
// weekend, so a sixth of every week's bread was a merchant import.
export const WORKDAYS_PER_WEEK = 6;
export function isWorkday(tick: number): boolean {
  return Math.floor(tick / MINUTES_PER_DAY) % 7 !== 0;
}

// §9.8 "workers commit timed shifts; presence = labor-ticks = production."
// On each workday, every NPC employment works one shift under the SAME
// rules the player's own work_shift action applies (jobs/shifts.ts —
// pillar 2, "NPCs live by the same rules as the player"):
//   - no company tool on hand → no shift at all: no wage, XP or output;
//   - the shift's wage is paid (capped at what the employer can afford)
//     into the worker's household purse (§10 "shared money");
//   - a skill roll decides the shift's yield (§13.2), and production runs
//     through production/shift.ts exactly as the player's does;
//   - the tool wears (TOOL_WEAR_PER_SHIFT) and the worker gains SHIFT_XP.
// Background simulation mode selects this NPC path; foreground household
// members work real timed shifts instead.
//
// History: this was a weekly lump (five shifts' wages/output at once) until
// the 2026-10-06 balancing pass. Daily shifts keep goods flowing through
// the markets every day instead of one weekly flood-then-drought, which
// the stock-based pricing (market/pricing.ts) needs to mean anything. The
// same day's pass also fixed wages landing in personal wallets nothing
// spends, the player being paid twice, and NPCs ignoring tools/skill.
export function applyNpcLaborDailyCadence(
  db: Database,
  bus: EventBus,
  tick: number,
  rng: () => number,
): void {
  if (!isWorkday(tick)) return;
  // One line per business for the day's work in its log, not one per hand.
  const day = new Map<string, { name: string; hands: number; wages: number; made: Map<string, number> }>();
  for (const jobSlot of listJobOpenings(db)) {
    for (const employment of listActiveEmploymentsForSlot(db, jobSlot.id)) {
      const householdId = getHouseholdIdForMember(db, employment.entityId);
      if (!householdId || !isBackgroundActor(db, employment.entityId)) continue; // the player (or any foreground actor) works real shifts instead
      const company = getCompany(db, employment.companyId);
      if (!company) continue;

      if (jobSlot.toolGoodType && countActiveItemsOfType(db, company.id, jobSlot.toolGoodType) === 0) {
        bus.emit({
          tick,
          scope: 'business',
          actorId: company.id,
          type: 'company.idle_no_tool',
          message: `${getEntityName(db, employment.entityId)} can't work at ${company.name} today — there's no ${jobSlot.toolGoodType}.`,
          data: { entityId: employment.entityId, toolGoodType: jobSlot.toolGoodType },
        });
        continue;
      }

      const summary = day.get(company.id) ?? { name: company.name, hands: 0, wages: 0, made: new Map() };
      day.set(company.id, summary);
      summary.hands++;
      const wage = Math.max(0, Math.min(employment.wage, getBalance(db, company.id)));
      summary.wages += wage;
      if (wage > 0) {
        transferCoin(
          db,
          bus,
          company.id,
          householdId,
          wage,
          tick,
          `${company.name} pays ${getEntityName(db, employment.entityId)} ${wage} coin for a shift.`,
          'business',
        );
        recordLedgerEntry(db, company.id, tick, 'wage', wage, 'Shift wage.');
      }

      const succeeded = rng() < getSuccessChance(db, employment.entityId, jobSlot.skill);
      const recipe = getRecipeForSkill(jobSlot.skill);
      if (recipe) {
        const made = runProductionShift(db, bus, {
          companyId: company.id,
          companyName: company.name,
          workerId: employment.entityId,
          recipe,
          succeeded,
          qualityTier: 1 + Math.floor(getLevel(db, employment.entityId, jobSlot.skill) / 2),
          tick,
          scope: 'business',
        });
        summary.made.set(recipe.outputGood, (summary.made.get(recipe.outputGood) ?? 0) + made);
      }
      if (jobSlot.toolGoodType) {
        wearCompanyTool(db, bus, company.id, jobSlot.toolGoodType, TOOL_WEAR_PER_SHIFT, tick);
      }
      addXp(db, employment.entityId, jobSlot.skill, SHIFT_XP);
    }
  }
  for (const [companyId, summary] of day) {
    const made = [...summary.made].map(([good, n]) => `${n} ${good}`).join(', ') || 'nothing';
    bus.emit({
      tick,
      scope: 'business',
      actorId: companyId,
      type: 'business.workday',
      message: `${summary.hands} ${summary.hands === 1 ? 'hand works' : 'hands work'} a shift, turning out ${made}; ${summary.wages} coin paid in wages.`,
      data: { hands: summary.hands, wages: summary.wages, made: Object.fromEntries(summary.made) },
    });
  }
}

// §9.2/§13.2 "NPC Management skill grows with tenure": a worker who has been
// with the same employer for a year (120 days) has seen how the place is run
// — ordering, hiring, the bad weeks — and picks up a little Management, the
// way a long-serving hand becomes a foreman. Slow by design (about a level
// every hundred weeks at skills.ts's 200 XP/level), but it's the path from
// worker to someone who could run a business (population/
// entrepreneurship.ts). The owner and manager learn by running it instead
// (companies/decisions.ts).
const FOREMAN_TENURE_DAYS = 120;
const FOREMAN_MANAGEMENT_XP_PER_WEEK = 2;

export function applyWorkplaceExperienceWeeklyCadence(db: Database, tick: number): void {
  const rows = queryRows(
    db,
    `SELECT employment.entity_id FROM employment
     JOIN companies ON companies.id = employment.company_id
     JOIN household_members ON household_members.entity_id = employment.entity_id
     WHERE employment.status = 'active' AND employment.hired_at_tick <= ?
       AND employment.entity_id IS NOT COALESCE(companies.manager_id, companies.owner_id)`,
    [tick - FOREMAN_TENURE_DAYS * MINUTES_PER_DAY],
  );
  for (const row of rows) addXp(db, String(row[0]), MANAGEMENT_SKILL, FOREMAN_MANAGEMENT_XP_PER_WEEK);
}

// §10 "the adaptation ladder... more work / another member works" — named
// in §10 since Stage 4 but explicitly not modeled then (no NPC job-seeking
// behavior existed yet, see DECISIONS.md's Stage 4 entry). §Stage 5's real
// company growth (companies/decisions.ts's tryUpgrade) also needs *someone*
// to actually fill a newly-opened job slot, or "hires" is just a number
// going up with nobody behind it — this is that someone.
//
// Deliberately minimal, not §11.3's full utility-scored decision model
// (urgency + benefit - cost - risk + personality): every unemployed
// household member is a candidate for every open slot, no skill-matching,
// no travel/distance weighting (this settlement has no second location's
// worth of jobs to weigh against yet). Households currently under
// financial strain get first pick of scarce openings — the one piece of
// prioritization that makes this a real adaptation-ladder rung rather than
// incidental background hiring, and lets it log as one.
export function applyNpcJobSeekingWeeklyCadence(
  db: Database,
  bus: EventBus,
  tick: number,
  rng: () => number,
): void {
  // Best-paying openings first (ties in listing order): with more openings
  // than people looking, the employer offering more gets the hands — the
  // one way wage competition works before anyone switches jobs mid-tenure.
  const remainingCapacity = new Map<string, number>();
  const openings = listJobOpenings(db).sort((a, b) => b.wageMin - a.wageMin);
  for (const slot of openings) {
    const remaining = slot.capacity - countActiveEmploymentsForSlot(db, slot.id);
    if (remaining > 0) remainingCapacity.set(slot.id, remaining);
  }
  if (remainingCapacity.size === 0) return;

  const households = listHouseholds(db)
    .filter((household) => household.departedAtTick === null)
    .map((household) => ({
      household,
      strained: getBalance(db, household.id) < RESERVE_HEALTHY_THRESHOLD,
    }))
    .sort((a, b) => Number(b.strained) - Number(a.strained));

  for (const { household, strained } of households) {
    for (const memberId of listHouseholdMembers(db, household.id).filter((id) => isBackgroundActor(db, id))) {
      if (remainingCapacity.size === 0) return;
      if (getActiveEmployment(db, memberId)) continue;

      const [slotId] = remainingCapacity.entries().next().value ?? [];
      if (!slotId) return;

      applyForJob(db, bus, memberId, slotId, tick, { haggle: rng() < 0.5, scope: 'settlement' }, rng);
      if (strained) {
        bus.emit({
          tick,
          scope: 'settlement',
          actorId: household.id,
          type: 'household.hardship.member_works',
          message: `${getEntityName(db, memberId)} takes on work to help ${household.name} through a hard stretch.`,
          data: { entityId: memberId, jobSlotId: slotId },
        });
      }

      const remaining = (remainingCapacity.get(slotId) ?? 1) - 1;
      if (remaining <= 0) remainingCapacity.delete(slotId);
      else remainingCapacity.set(slotId, remaining);
    }
  }
}

// §10's own last, previously-unmodeled adaptation-ladder rung, and §11.4
// Migration: "push (unemployment, hunger, rent, fire, debt) vs. pull (jobs,
// wages...)." A household that stays destitute (no employed member, still
// charity-reliant — see applyHouseholdDailyCadence's destitution tracking)
// past this grace period has exhausted every earlier rung (sell belongings,
// charity, another member works — there was no open slot for one) and
// leaves for good. Deterministic day-count threshold, same reproducibility
// reasoning as companies/decisions.ts's closure grace period.
export const EMIGRATION_GRACE_DAYS = 60;
// §11.4 lists hunger first among push factors. A household that hasn't
// been able to feed everyone for this long leaves even with coin in its
// purse — before
// 2026-10-06 only destitution (no money AND no job) counted, so a starving
// town with a little money never emptied at all.
export const HUNGER_EMIGRATION_DAYS = 45;

function ownsOpenCompany(db: Database, members: string[]): boolean {
  if (members.length === 0) return false;
  const placeholders = members.map(() => '?').join(', ');
  return (
    queryRow(
      db,
      `SELECT 1 FROM companies WHERE closed_at_tick IS NULL AND owner_id IN (${placeholders}) LIMIT 1`,
      members,
    ) !== undefined
  );
}

function tryEmigrateHousehold(
  db: Database,
  bus: EventBus,
  household: Household,
  members: string[],
  tick: number,
): void {
  const daysDestitute =
    household.destituteSinceTick === null ? 0 : (tick - household.destituteSinceTick) / MINUTES_PER_DAY;
  const daysHungry = household.hungerDays;
  const pushedByPoverty = daysDestitute >= EMIGRATION_GRACE_DAYS;
  const pushedByHunger = daysHungry >= HUNGER_EMIGRATION_DAYS;
  if (!pushedByPoverty && !pushedByHunger) return;
  // An owner doesn't walk away from a business that's still open — it
  // fails first (companies/decisions.ts), and then they're free to go.
  if (ownsOpenCompany(db, members)) return;

  // Defensive, not load-bearing: destitution already requires zero employed
  // members, but a departing household shouldn't leave a dangling job behind
  // it regardless.
  for (const memberId of members) {
    quitJob(db, bus, memberId, tick, {
      scope: 'settlement',
      message: `${household.name} leaves the settlement.`,
    });
  }

  // §8.1 rule 1: "spoilage and wear are the only destruction" — a household
  // this poor has already sold anything worth selling via the adaptation
  // ladder's earlier rungs; whatever little remains has no buyer once its
  // owner is gone, same reasoning as companies/decisions.ts's liquidateCompany
  // for unsellable leftover stock.
  for (const item of listActiveItemsInContainer(db, household.id)) {
    destroyItem(db, bus, item.id, 'spoiled', tick, {
      note: `Left behind when ${household.name} left, spoils.`,
      scope: 'settlement',
    });
  }

  // §8.1 rule 2: "money conservation: ...sinks (taxes, imports, emigrants)."
  const balance = getBalance(db, household.id);
  if (balance > 0) {
    sinkCoin(
      db,
      bus,
      household.id,
      balance,
      tick,
      `${household.name} takes its savings and leaves.`,
      'settlement',
      'emigration',
    );
  }

  departHousehold(db, household.id, tick);
  bus.emit({
    tick,
    scope: 'settlement',
    actorId: household.id,
    type: 'household.migration.emigrated',
    message: pushedByHunger
      ? `${household.name} packs up and leaves after weeks of going hungry.`
      : `${household.name} packs up and leaves, unable to make ends meet after a hard stretch.`,
    data: {
      memberCount: members.length,
      daysDestitute: Math.floor(daysDestitute),
      daysHungry: Math.floor(daysHungry),
      reason: pushedByHunger ? 'hunger' : 'poverty',
    },
  });
}

// §11.4's "pull (jobs, wages...) against known alternatives": unfilled job
// openings are the one pull signal this stage can honestly compute — no
// wage/price comparison against another settlement exists before Stage 7's
// region model. A new household arriving unemployed (not placed directly
// into a slot) keeps this simple and lets the very next weekly job-seeking
// pass (applyNpcJobSeekingWeeklyCadence, called just before this in
// engine.ts) do the actual hiring, rather than duplicating its logic here.
const IMMIGRATION_CHANCE_PER_WEEK = 0.25;
const IMMIGRATION_MAX_BREAD_PRICE_FACTOR = 2;
const IMMIGRANT_MIN_MEMBERS = 1;
const IMMIGRANT_MAX_MEMBERS = 2;
const IMMIGRANT_STARTING_COIN_MIN = 50;
const IMMIGRANT_STARTING_COIN_MAX = 125;
// No dedicated housing sites exist yet (§12 Housing is a later module) — same
// "tavern stands in as town center" stand-in seed/demoWorld.ts already uses
// for every other household's home site.
const IMMIGRANT_HOME_SITE_ID = 'tavern';

function tryImmigrateHousehold(db: Database, bus: EventBus, tick: number, rng: () => number): void {
  const totalVacancies = listJobOpenings(db).reduce(
    (sum, slot) => sum + Math.max(0, slot.capacity - countActiveEmploymentsForSlot(db, slot.id)),
    0,
  );
  if (totalVacancies === 0) return;
  // Pull needs food as well as work (§11.4 "pull (jobs, wages, housing,
  // food...)"): nobody moves to a town in famine, however many jobs it posts.
  const bread = getListing(db, MARKET_SITE_ID, 'bread');
  const breadBase = getGoodDefinition('bread').basePrice;
  if (!bread || bread.quantity <= 0 || bread.price > breadBase * IMMIGRATION_MAX_BREAD_PRICE_FACTOR) return;
  if (rng() >= IMMIGRATION_CHANCE_PER_WEEK) return;

  const surname = pick(rng, SURNAMES);
  const householdId = `household-immigrant-${tick}`;
  const householdName = `The ${surname} Household`;

  createEntity(db, householdId, householdName);
  createHousehold(db, { id: householdId, name: householdName, homeSiteId: IMMIGRANT_HOME_SITE_ID });

  const startingCoin =
    IMMIGRANT_STARTING_COIN_MIN +
    Math.floor(rng() * (IMMIGRANT_STARTING_COIN_MAX - IMMIGRANT_STARTING_COIN_MIN + 1));
  faucetCoin(
    db,
    bus,
    householdId,
    startingCoin,
    tick,
    `${householdName} arrives with modest travel savings.`,
    'settlement',
    'immigration',
  );

  const memberCount =
    IMMIGRANT_MIN_MEMBERS + Math.floor(rng() * (IMMIGRANT_MAX_MEMBERS - IMMIGRANT_MIN_MEMBERS + 1));
  for (let i = 0; i < memberCount; i++) {
    const entityId = `${householdId}-member-${i}`;
    createEntity(db, entityId, `${pick(rng, FIRST_NAMES)} ${surname}`);
    ensureNeeds(db, entityId, tick);
    addHouseholdMember(db, householdId, entityId);
  }

  bus.emit({
    tick,
    scope: 'settlement',
    actorId: householdId,
    type: 'household.migration.arrived',
    message: `${householdName} arrives in town, drawn by word of steady work.`,
    data: { memberCount },
  });
}

// §4.2 cadence: "weekly (... migration ...)." §11.4 Migration in full: push
// (emigration, for households the ladder's every earlier rung has failed)
// and pull (immigration, drawn by unfilled work) — Stage 5's own exit test
// names "a migration wave" as one of the emergent outcomes a 2-year run must
// produce.
export function applyHouseholdMigrationWeeklyCadence(
  db: Database,
  bus: EventBus,
  tick: number,
  rng: () => number,
): void {
  for (const household of listHouseholds(db)) {
    if (household.departedAtTick !== null) continue;
    const members = listHouseholdMembers(db, household.id).filter((id) => isBackgroundActor(db, id));
    if (members.length === 0 || members.length !== listHouseholdMembers(db, household.id).length) continue;
    tryEmigrateHousehold(db, bus, household, members, tick);
  }

  tryImmigrateHousehold(db, bus, tick, rng);
}
