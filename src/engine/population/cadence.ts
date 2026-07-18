import { getCompany } from '../companies/companies';
import { getGoodDefinition } from '../goods/catalog';
import { destroyItem, findFirstActiveItem, produceItem, transferItem } from '../inventory/items';
import { getBalance, faucetCoin, sinkCoin, transferCoin } from '../inventory/wallet';
import { listActiveEmploymentsForSlot, listJobOpenings } from '../jobs/jobs';
import { decrementStock, getListing, marketStockContainerId, seedListing } from '../market/market';
import { clamp, getNeeds, type NeedKey } from '../needs/needs';
import { addXp, getLevel } from '../skills/skills';
import { listHouseholdMembers, listHouseholds, type Household } from './households';
import type { EventBus } from '../eventBus';
import type { Database } from 'sql.js';

// §Stage 4's "regional LOD" (MASTERPLAN.md §18 risk table: "background
// aggregation"). Confirmed empirically before any of this was built: ~40
// entities each taking the player's per-tick, per-entity needs path
// (individual SELECT/SELECT/UPDATE every tick — needs.ts's tickNeeds)
// exhausts sql.js's WASM heap in under 3,000 ticks, nowhere near a 90-day
// (129,600-tick) run. NPCs therefore never run tickNeeds or the action-queue
// system at all — they're "background actors": their needs, wages, skill
// gain, and consumption are all resolved in coarse daily/weekly passes
// (§4.2's own cadence table already has these tiers), a handful of DB calls
// per household/employment rather than per entity per tick. The player (and
// any other entity that isn't a household member) is unaffected — see
// Engine.applyNeedsCadence's household-membership exclusion.
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
const RESERVE_HEALTHY_THRESHOLD = 30; // coin — above this, a household isn't under strain
const CHARITY_STIPEND = 5; // §8.2 "church charity/poorhouse" stabilizer
const CHARITY_THRESHOLD = 5; // coin — below this, sell belongings/take charity

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

// Feeds every member of a household for one day: consumes existing bread
// stock first, then buys the shortfall from the market if the household can
// afford it. Returns true if every member was properly fed (used by the
// caller to decide whether the adaptation ladder's "went hungry" rung fires
// — §10's "cheaper food → smaller meals").
function feedHousehold(
  db: Database,
  bus: EventBus,
  household: Household,
  members: string[],
  tick: number,
): boolean {
  // Water is free and effectively unlimited at the well (§6/§8.2) — no
  // scarcity axis worth modeling for background NPCs; food is the real
  // budget line.
  for (const entityId of members) directSetNeed(db, entityId, 'thirst', 100);

  let fedCount = 0;
  while (fedCount < members.length) {
    const bread = findFirstActiveItem(db, household.id, 'bread');
    if (!bread) break;
    destroyItem(db, bus, bread.id, 'consumed', tick, { note: `${household.name} eats.`, scope: 'business' });
    fedCount++;
  }

  if (fedCount < members.length) {
    const price = getGoodDefinition('bread').basePrice;
    const listing = getListing(db, MARKET_SITE_ID, 'bread');
    const affordableByCoin = price > 0 ? Math.floor(getBalance(db, household.id) / price) : Infinity;
    const buyCount = Math.max(
      0,
      Math.min(members.length - fedCount, listing?.quantity ?? 0, affordableByCoin),
    );

    for (let i = 0; i < buyCount; i++) {
      sinkCoin(db, bus, household.id, price, tick, `${household.name} buys bread at the market.`, 'business');
      decrementStock(db, MARKET_SITE_ID, 'bread', 1);
      const itemId = `${household.id}-bread-${tick}-${i}`;
      produceItem(db, bus, {
        id: itemId,
        type: 'bread',
        containerId: household.id,
        tick,
        note: `Bought by ${household.name}.`,
        scope: 'business',
      });
      destroyItem(db, bus, itemId, 'consumed', tick, { note: `${household.name} eats.`, scope: 'business' });
      fedCount++;
    }
  }

  members.forEach((entityId, i) => {
    directSetNeed(db, entityId, 'hunger', i < fedCount ? WELL_FED_HUNGER : SUBSISTENCE_HUNGER);
  });

  return fedCount >= members.length;
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
function evaluateHouseholdBudget(db: Database, bus: EventBus, household: Household, tick: number): void {
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
      faucetCoin(db, bus, household.id, price, tick, note, 'settlement');
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

    const charityNote = `${household.name} takes charity from the parish to get by.`;
    faucetCoin(db, bus, household.id, CHARITY_STIPEND, tick, charityNote, 'settlement');
    bus.emit({
      tick,
      scope: 'settlement',
      actorId: household.id,
      type: 'household.hardship.charity',
      message: charityNote,
      data: { amount: CHARITY_STIPEND },
    });
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
    const members = listHouseholdMembers(db, household.id);
    if (members.length === 0) continue;

    const wellFed = feedHousehold(db, bus, household, members, tick);
    for (const entityId of members) applyDailyRestAndWarmth(db, entityId, exposedToCold);
    if (!wellFed) {
      bus.emit({
        tick,
        scope: 'settlement',
        actorId: household.id,
        type: 'household.hardship.reduced_food',
        message: `${household.name} goes without a proper meal tonight.`,
        data: {},
      });
    }

    evaluateHouseholdBudget(db, bus, household, tick);
  }
}

const WEEKLY_SHIFTS = 5; // 5 working days/week — same wage unit as the player's per-shift wage, batched
const WEEKLY_XP = 200;
const WEEKLY_YIELD_PER_SHIFT = 3;

// Skill → output good. Stage 3/4 only have two job types; a real data-driven
// recipe system (§16) is Stage 5+, so this small lookup is the honest
// stand-in until then, same precedent as the goods catalog itself.
const SKILL_OUTPUT_GOOD: Record<string, string> = {
  farming: 'grain',
  woodcutting: 'firewood',
};

// §4.2 cadence: "weekly (hiring/wages ...)." Pays every NPC's active
// employment as one lump sum (§9.8: "presence = labor-ticks = production" —
// a labor-time wage, same principle as the player's per-shift wage, just
// batched to a week instead of queued per shift) and grants the matching
// skill XP/output. The player is excluded — their wages come from real
// work_shift actions triggered through the interface (§Stage 3), not this
// cadence; household membership is what distinguishes "NPC" from "player"
// here (see households.ts's isHouseholdMember).
export function applyNpcLaborWeeklyCadence(db: Database, bus: EventBus, tick: number): void {
  for (const jobSlot of listJobOpenings(db)) {
    for (const employment of listActiveEmploymentsForSlot(db, jobSlot.id)) {
      const company = getCompany(db, employment.companyId);
      if (!company) continue;

      const weeklyWage = employment.wage * WEEKLY_SHIFTS;
      const affordable = Math.max(0, Math.min(weeklyWage, getBalance(db, employment.companyId)));
      if (affordable > 0) {
        transferCoin(
          db,
          bus,
          employment.companyId,
          employment.entityId,
          affordable,
          tick,
          `${company.name} pays ${affordable} coin in wages.`,
          'business',
        );
      }

      addXp(db, employment.entityId, jobSlot.skill, WEEKLY_XP);

      const outputGood = SKILL_OUTPUT_GOOD[jobSlot.skill];
      if (!outputGood) continue;
      const level = getLevel(db, employment.entityId, jobSlot.skill);
      const qualityTier = 1 + Math.floor(level / 2);
      const quantity = WEEKLY_SHIFTS * WEEKLY_YIELD_PER_SHIFT;
      for (let i = 0; i < quantity; i++) {
        produceItem(db, bus, {
          id: `${employment.companyId}-${outputGood}-${tick}-${employment.entityId}-${i}`,
          type: outputGood,
          qualityTier,
          containerId: employment.companyId,
          tick,
          actorId: employment.entityId,
          note: `${outputGood} produced at ${company.name}.`,
          scope: 'business',
        });
      }
    }
  }
}
