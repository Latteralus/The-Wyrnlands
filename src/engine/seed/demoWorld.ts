import { getGoodDefinition } from '../goods/catalog';
import { PERSONAL_CARRY_CAPACITY_KG } from '../inventory/capacity';
import { consumeActiveItems, countActiveItemsOfType, findFirstActiveItem } from '../inventory/items';
import { createWorkShiftActionDefinition } from '../jobs/shifts';
import { createBuyActionDefinition, createSellActionDefinition, describeSources } from '../market/market';
import { withOptional } from '../optional';
import { ensureParish, PARISH_ID, isWorkday } from '../population/cadence';
import { generateNpcPopulation } from '../population/npcGen';
import {
  drawWater,
  stockUpOnBread,
  supplyDays,
  WATER_PAILS_PER_PERSON_PER_DAY,
} from '../population/provisions';
import {
  BAKING_SKILL,
  FARMING_SKILL,
  LABOR_SKILL,
  MANAGEMENT_SKILL,
  MILLING_SKILL,
  WOODCUTTING_SKILL,
} from '../skills/skills';
import { MINUTES_PER_DAY } from '../time/clock';
import type { Engine, RoutineChoice } from '../engine';

// This seeds just enough world for every screen to have real data: a real
// survival loop (gather firewood on common land, sell it, buy bread, drink
// for free at the well, rest, replace gear as it wears out — Stage 2), a
// real first job (the farm as employer — §Stage 3), and, from Stage 4, a
// living settlement of ~40 NPCs in households. Replaced by real rolled
// starting conditions in Stage 5 (§5.4).
export const PLAYER_ID = 'player';

export const REST_BUNK_PRICE = 15;
const REST_BUNK_ENERGY = 50;
const REST_ROUGH_ENERGY = 20;
const SHOE_WEAR_PER_CHOP = 10; // maxDurability 200 → wears out roughly every 20 chops
const SLEEP_DURATION_TICKS = 8 * 60;
// What a night's sleep gives back, spread across the night (an action's
// restoresPerTick, needs.ts): a bunk all of it, rough ground most.
const SLEEP_ROUGH_ENERGY = 70;

export const FARM_SITE_ID = 'farm';
export const FARM_COMPANY_ID = 'oster_farm';
export const FARM_JOB_SLOT_ID = 'oster_farm_farmhand';
export const FARM_SHIFT_DURATION_TICKS = 360; // a six-hour shift (§14.4)
const FARM_WAGE_MIN = 20;
const FARM_WAGE_MAX = 35;
// Sized for up to FARM_JOB_CAPACITY workers' wages over a full 90-day season
// even before §Stage 5's grain-selling revenue ramps up — generous headroom
// rather than a tightly-balanced number (§17's balance harness is the place
// for real tuning); a company that would eventually go insolvent over a
// long enough run with badly-managed selling is a realistic outcome
// (§11.5), not a bug — see shifts.ts's affordableWage cap for what happens
// when it does, and companies/decisions.ts's insolvency signal.
const FARM_STARTING_CAPITAL = 12500;
const FARM_JOB_CAPACITY = 10; // the farm is the village's main employer (§3): most hands work the land

export const LOGGING_SITE_ID = 'forest'; // the camp works out of the existing forest site, no new location needed
export const LOGGING_COMPANY_ID = 'hollows_edge_logging';
export const LOGGING_JOB_SLOT_ID = 'hollows_edge_logging_woodcutter';
const LOGGING_SHIFT_DURATION_TICKS = 360;
const LOGGING_WAGE_MIN = 15;
const LOGGING_WAGE_MAX = 30;
const LOGGING_STARTING_CAPITAL = 12500;
const LOGGING_JOB_CAPACITY = 4; // the owner-operator plus the same 3 NPC woodcutters as before (still none open for the player)

// §Stage 5's first real transformation chain: grain (farm) -> flour (mill)
// -> bread (bakery), closing the loop that used to be a one-way merchant
// import (see market.ts's producerCompanyId). Modest starting capital —
// unlike the farm/logging camp above, these two are meant to actually earn
// their keep from day one via companies/decisions.ts's daily selling.
export const MILL_SITE_ID = 'mill';
export const MILL_COMPANY_ID = 'riverside_mill';
export const MILL_JOB_SLOT_ID = 'riverside_mill_miller';
const MILL_SHIFT_DURATION_TICKS = 360;
const MILL_WAGE_MIN = 20;
const MILL_WAGE_MAX = 35;
const MILL_STARTING_CAPITAL = 2500;
const MILL_JOB_CAPACITY = 2;

export const BAKERY_SITE_ID = 'bakery';
export const BAKERY_COMPANY_ID = 'village_bakery';
export const BAKERY_JOB_SLOT_ID = 'village_bakery_baker';
const BAKERY_SHIFT_DURATION_TICKS = 360;
const BAKERY_WAGE_MIN = 20;
const BAKERY_WAGE_MAX = 35;
const BAKERY_STARTING_CAPITAL = 2500;
const BAKERY_JOB_CAPACITY = 2;

// §9.2 "some NPC companies are simply better run than others." Each
// company gets a dedicated owner-operator NPC whose starting Management XP
// (skills.ts: 200 XP/level, level 5 max) is deliberately spread across the
// whole range rather than uniform — a real, observable divergence in
// companies/decisions.ts's restocking reliability (higher management =
// checks stock more often, buys bigger batches), not just a flavor label.
// Management currently weights *buying* only, not selling efficiency or
// purchase restraint relative to actual throughput — a real 90-day headless
// run (2026-07-19, see DECISIONS.md) showed the level-5-managed mill buying
// grain faster than it could resell flour, leaving it balance-fragile
// (briefly insolvent), while the level-0-managed bakery — benefiting from
// guaranteed high-volume consumer demand for bread — was the run's clear
// profit leader. Not the "well-managed thrives / sloppy struggles" story
// this was seeded expecting; left as an honest, real finding and a named
// follow-up (§11.5's emergence target isn't disproven, just not yet
// delivered by this mechanism alone) rather than silently rewritten to fit.
// Placeholder spread either way — revisit with the balance harness (§17).
const FARM_OWNER_MANAGEMENT_XP = 650; // level 3
const LOGGING_OWNER_MANAGEMENT_XP = 450; // level 2
const MILL_OWNER_MANAGEMENT_XP = 1100; // level 5
const BAKERY_OWNER_MANAGEMENT_XP = 50; // level 0
const OWNER_STARTING_RESERVE = 400; // same placeholder "modest family savings" as generated NPC households

// §5.4 "Starting Conditions Are Rolled... the recent harvest quality, each
// business's health... current season, price levels, and job availability.
// Two new games in the same village play differently." The starting season
// itself is rolled by Engine.ensureWorldMeta (a core calendar concept, not
// seed-content); everything else rolled here is genuinely this seed's own
// content decision. "Job availability" is the one named factor *not*
// separately rolled this slice — the existing NPC-generation randomness
// already gives some natural variance in who's hired where, but nothing
// here deliberately widens or narrows it further; a flagged, honest scope
// cut, not a silent omission.
const PRICE_LEVEL_MIN = 0.85;
const PRICE_LEVEL_RANGE = 0.4; // rolls a market-wide price level in [0.85, 1.25)
const MAX_STARTING_GRAIN = 40; // a bountiful recent harvest leaves the farm with up to this much grain already in store
const FAILED_BUSINESS_CHANCE = 0.2; // §5.4's own example: "one may be freshly failed — the shuttered mill opening"
const PARISH_ENDOWMENT = 500;

// What each parcel is worth (world/tenure.ts prices leases and purchases
// from it). The seeded companies hold theirs freehold, as they always
// implicitly did; when one closes its land is free for the next taker.
const FARM_LAND_VALUE = 800;
const FOREST_LAND_VALUE = 500;
const MILL_LAND_VALUE = 1000;
const BAKERY_LAND_VALUE = 700;
const VACANT_PARCELS = [
  { id: 'eastfield', name: 'Eastfield', kind: 'farm', x: 6, y: -4, landValue: 600 },
  { id: 'brook_meadow', name: 'Brook Meadow', kind: 'farm', x: -5, y: 4, landValue: 600 },
  { id: 'northwood', name: 'Northwood Lot', kind: 'forest', x: 8, y: 6, landValue: 400 },
  { id: 'old_bakehouse', name: 'The Old Bakehouse', kind: 'bakery', x: 1, y: 4, landValue: 600 },
];

function rolledPrice(basePrice: number, priceLevel: number): number {
  return Math.max(1, Math.round(basePrice * priceLevel));
}

export const NPC_HOUSEHOLD_COUNT = 20;
// §9.2: one single-person household per company owner-operator (farm,
// logging, mill, bakery — seedCompanyOwner) — real households, not test
// fixtures, so anything counting engine.listHouseholds() needs to account
// for them alongside the generated NPC ones.
export const COMPANY_OWNER_HOUSEHOLD_COUNT = 4;

// Action *definitions* are code, held only in the ActionRegistry in memory
// (§Stage 0 decision) — they never persist to the DB. A reloaded save (or,
// as it turns out, a rehydrated Engine — see the Stage 2 scenario test) gets
// a brand-new, empty registry, so this must run on *every* fresh Engine
// instance regardless of whether the world was already seeded. Discovered
// as a real latent bug via that rehydration experiment, not hypothetical:
// seedDemoWorld's old single-guard-clause shape returned early on an
// already-seeded DB, silently skipping registration entirely.
export function registerDemoActionTypes(engine: Engine): void {
  engine.registerActionType({
    type: 'draw_water',
    durationTicks: 10,
    // Several times a day, and the thirst bar shows it — not worth a log line.
    resolve: () => ({
      success: true,
      message: 'You draw a bucket of cold, clean water and drink.',
      quiet: true,
    }),
    applyOutcome: (ctx) => engine.restoreNeed(ctx.actorId, 'thirst', 55, 'The water leaves you refreshed.'),
  });

  engine.registerActionType({
    type: 'rest_bunk',
    durationTicks: 60,
    // Energy comes back during the rest, not all at once at the end (and
    // isn't draining meanwhile) — needs.ts's restoresPerTick.
    restoresPerTick: { energy: REST_BUNK_ENERGY / 60 },
    resolve: (_rng, ctx) =>
      engine.getBalance(ctx.actorId) >= REST_BUNK_PRICE
        ? { success: true, message: `You pay ${REST_BUNK_PRICE} coin for a bunk and sleep well.` }
        : { success: false, message: "You can't afford a bunk tonight." },
    applyOutcome: (ctx, outcome) => {
      if (!outcome.success) return;
      engine.sinkCoin(ctx.actorId, REST_BUNK_PRICE, 'Paid for a tavern bunk.');
      engine.restoreNeed(ctx.actorId, 'warmth', 30, 'The hearth kept you warm all night.');
    },
  });

  // A full night's sleep (§6 shelter ladder): one eight-hour rest — at the
  // tavern if you can pay, rough if not — instead of a string of hour-long
  // naps. What the daily routine (playerRoutine below) uses at bedtime.
  engine.registerActionType({
    type: 'sleep_bunk',
    durationTicks: SLEEP_DURATION_TICKS,
    restoresPerTick: { energy: 100 / SLEEP_DURATION_TICKS },
    resolve: (_rng, ctx) =>
      engine.getBalance(ctx.actorId) >= REST_BUNK_PRICE
        ? {
            success: true,
            message: `You sleep the night in a bunk at the Sleeping Ox (${REST_BUNK_PRICE} coin) and wake rested.`,
          }
        : {
            success: false,
            message: "You can't afford a bunk, and spend a cold night in the doorway instead.",
          },
    applyOutcome: (ctx, outcome) => {
      // Energy came back through the night (restoresPerTick); the bunk's
      // price and the hearth's warmth are settled in the morning. Turned
      // away for want of coin, the night in the doorway rested you less.
      if (!outcome.success) {
        engine.restoreNeed(ctx.actorId, 'energy', -100 + SLEEP_ROUGH_ENERGY);
        return;
      }
      engine.sinkCoin(ctx.actorId, REST_BUNK_PRICE, 'Paid for a tavern bunk.');
      engine.restoreNeed(ctx.actorId, 'warmth', 60);
    },
  });
  engine.registerActionType({
    type: 'sleep_rough',
    durationTicks: SLEEP_DURATION_TICKS,
    restoresPerTick: { energy: SLEEP_ROUGH_ENERGY / SLEEP_DURATION_TICKS },
    resolve: () => ({
      success: true,
      message: 'You sleep rough under the eaves and wake stiff, but rested enough.',
    }),
  });

  // Provisions (population/provisions.ts) — what the player keeps in their
  // pack: pails from the well, and bread bought ahead.
  engine.registerActionType({
    type: 'fetch_water',
    durationTicks: 20,
    resolve: (_rng, ctx) => {
      const have = countActiveItemsOfType(ctx.db, ctx.actorId, 'water');
      const want = Math.max(0, PACK_WATER_PAILS - have);
      const fits = Math.floor(
        Math.max(0, PERSONAL_CARRY_CAPACITY_KG - engine.getCarriedWeightKg(ctx.actorId)) /
          getGoodDefinition('water').weightKg,
      );
      const pails = Math.min(want, fits);
      return pails > 0
        ? {
            success: true,
            message: `You fill ${pails} pails at the well and carry them back.`,
            data: { pails },
          }
        : { success: false, message: "You can't carry any more water.", quiet: true };
    },
    applyOutcome: (ctx, outcome) => {
      if (!outcome.success) return;
      drawWater(
        ctx.db,
        ctx.bus,
        ctx.actorId,
        countActiveItemsOfType(ctx.db, ctx.actorId, 'water') + Number(outcome.data?.pails),
        ctx.tick,
        ctx.actorId,
      );
    },
  });
  engine.registerActionType({
    type: 'drink',
    durationTicks: 5,
    resolve: (_rng, ctx) =>
      findFirstActiveItem(ctx.db, ctx.actorId, 'water')
        ? { success: true, message: 'You drink from a pail.', quiet: true }
        : { success: false, message: 'You have no water with you.' },
    applyOutcome: (ctx, outcome) => {
      if (!outcome.success) return;
      consumeActiveItems(ctx.db, ctx.bus, ctx.actorId, 'water', 1, ctx.tick, {
        actorId: ctx.actorId,
        note: 'Drunk.',
      });
      engine.restoreNeed(ctx.actorId, 'thirst', getGoodDefinition('water').thirstRestored ?? 0);
    },
  });
  engine.registerActionType({
    type: 'stock_up_bread',
    durationTicks: 20,
    resolve: () => {
      const listing = engine.getMarketListing('market', 'bread');
      return listing && listing.quantity > 0
        ? { success: true, message: 'You stock up on bread.', quiet: true }
        : { success: false, message: "There's no bread to be had at the stall." };
    },
    applyOutcome: (ctx, outcome) => {
      if (!outcome.success) return;
      const purchase = stockUpOnBread(
        ctx.db,
        ctx.bus,
        ctx.actorId,
        PACK_BREAD_LOAVES,
        0, // food before a bed: nothing held back for a bunk
        ctx.tick,
        'Bought bread at the market.',
      );
      if (!purchase || purchase.itemIds.length === 0) return;
      ctx.bus.emit({
        tick: ctx.tick,
        scope: 'personal',
        actorId: ctx.actorId,
        type: 'market.purchase',
        message:
          `You buy ${purchase.itemIds.length === 1 ? 'a loaf' : `${purchase.itemIds.length} loaves`} of bread at the market stall for ${purchase.totalCost} coin ` +
          `(${purchase.unitPrice} each) to keep in your pack — ${describeSources(ctx.db, purchase.sources)}.`,
        data: {
          goodType: 'bread',
          units: purchase.itemIds.length,
          unitPrice: purchase.unitPrice,
          cost: purchase.totalCost,
          sources: purchase.sources,
        },
      });
    },
  });

  engine.setRoutinePolicy(playerRoutine);

  // Free, lower-quality rest available anywhere (§6 shelter ladder's bottom
  // rung — "rough") so a coinless actor is never locked out of recovering.
  engine.registerActionType({
    type: 'rest_rough',
    durationTicks: 90,
    restoresPerTick: { energy: REST_ROUGH_ENERGY / 90 },
    resolve: () => ({ success: true, message: 'You rest as best you can, rough as it is.' }),
  });

  engine.registerActionType({
    type: 'read_notices',
    durationTicks: 5,
    resolve: () => ({ success: true, message: 'You read the notices pinned to the board.' }),
  });

  // Consuming food is a distinct step from buying it (§8.1 rule 1: "every
  // transfer transactional and logged" — the bread's provenance chain runs
  // produced → transferred (if hauled) → consumed). Available anywhere, like
  // rest_rough — eating doesn't require a specific location.
  engine.registerActionType({
    type: 'eat',
    durationTicks: 10,
    resolve: (_rng, ctx) => {
      const bread = findFirstActiveItem(ctx.db, ctx.actorId, 'bread');
      return bread
        ? {
            success: true,
            message: 'You sit down and eat a loaf of bread, slowly, to make it last.',
            data: { itemId: bread.id },
          }
        : { success: false, message: 'You have nothing to eat.' };
    },
    applyOutcome: (ctx, outcome) => {
      if (!outcome.success) return;
      engine.destroyItem(String(outcome.data?.itemId), 'consumed', {
        actorId: ctx.actorId,
        note: 'Eaten.',
      });
      engine.restoreNeed(
        ctx.actorId,
        'hunger',
        getGoodDefinition('bread').hungerRestored ?? 0,
        'A filling meal.',
      );
    },
  });

  engine.registerActionType({
    type: 'chop_wood',
    durationTicks: 30,
    // Skill-gated failure (§13.2): unskilled work is allowed but wastes the
    // attempt more often. Labor is the only skill that exists pre-Stage 3.
    resolve: (rng, ctx) => {
      const chance = engine.getSkillSuccessChance(ctx.actorId, LABOR_SKILL);
      return rng() < chance
        ? { success: true, message: 'You fell a length of good timber.' }
        : { success: false, message: 'You misjudge the swing and ruin the cut. The timber splits wrong.' };
    },
    applyOutcome: (ctx, outcome) => {
      // §13.2: "each labor-tick grants XP" regardless of the attempt's
      // outcome — time spent working is what teaches the skill.
      engine.addSkillXp(ctx.actorId, LABOR_SKILL, 30);
      engine.wearGear(ctx.actorId, 'feet', SHOE_WEAR_PER_CHOP);

      if (!outcome.success) return;
      if (!engine.canCarry(ctx.actorId, getGoodDefinition('firewood').weightKg)) return;
      engine.produceItem({
        id: `${ctx.actorId}-firewood-${ctx.tick}`,
        type: 'firewood',
        containerId: ctx.actorId,
        actorId: ctx.actorId,
        note: 'Firewood, freshly cut.',
      });
    },
  });

  engine.registerActionType(createBuyActionDefinition('market', 'bread'));
  engine.registerActionType(createBuyActionDefinition('market', 'shoes'));
  engine.registerActionType(createBuyActionDefinition('market', 'cloak'));
  engine.registerActionType(createSellActionDefinition('market', 'firewood'));

  engine.registerActionType(
    createWorkShiftActionDefinition(FARM_JOB_SLOT_ID, { durationTicks: FARM_SHIFT_DURATION_TICKS }),
  );
  engine.registerActionType(
    createWorkShiftActionDefinition(LOGGING_JOB_SLOT_ID, { durationTicks: LOGGING_SHIFT_DURATION_TICKS }),
  );
  engine.registerActionType(
    createWorkShiftActionDefinition(MILL_JOB_SLOT_ID, { durationTicks: MILL_SHIFT_DURATION_TICKS }),
  );
  engine.registerActionType(
    createWorkShiftActionDefinition(BAKERY_JOB_SLOT_ID, { durationTicks: BAKERY_SHIFT_DURATION_TICKS }),
  );
}

// The daily routine of an autonomous character (Engine.setAutonomous — the
// player, in the interactive game): what they do whenever they're idle.
// They keep their pack provisioned like a household keeps its larder
// (population/provisions.ts): pails from the well, a few days' bread bought
// at the stall (never anything else — shoes, cloaks and tools stay your
// decision), and a bunk only if that leaves bread money.
//   - Before anything long (a shift, a night's sleep) they drink their fill
//     and eat if peckish: thirst empties in ten hours (needs.ts), so a
//     shift or a night started thirsty ends in a collapse.
//   - On a workday, between 6 in the morning and 2 in the afternoon, they go
//     to work if they haven't already today.
//   - From 8 at night (until 2 in the morning) they turn in for the night —
//     a bunk if they can spare the coin.
//   - Otherwise they drink when thirsty, eat when hungry, and rest if
//     exhausted; and in a winter chill a bunk warms them up.
const WORK_START_HOUR = 6;
const WORK_LAST_START_HOUR = 14;
// What the player keeps in their pack: two days of water (the well is
// free and close, and there's no home to keep a barrel in yet), and bread
// for as many days as a household would hold (provisions.ts — bread spoils,
// so about three, plus today) at the loaf and a bit a day hunger costs
// (needs.ts: empty in 20 hours; a loaf fills you).
const PACK_WATER_PAILS = Math.ceil(2 * WATER_PAILS_PER_PERSON_PER_DAY);
const PACK_BREAD_LOAVES = Math.ceil(1.2 * (supplyDays('bread', false) + 1));
const BEDTIME_HOUR = 20;
// Too late in the night to start a full night's sleep after this — an
// exhausted character naps instead.
const LAST_BEDTIME_HOUR = 2;
// Exhausted enough to rest whatever the hour: a collapse is close.
const EXHAUSTED_ENERGY = 8;

export function playerRoutine(
  engine: Engine,
  actorId: string,
  lastShiftDay: number | null,
): RoutineChoice | null {
  const needs = engine.getNeeds(actorId);
  if (!needs) return null;
  const tick = engine.tick;
  const calendar = engine.calendarAt(tick);
  const hour = Math.floor(calendar.minuteOfDay / 60);
  const today = Math.floor(tick / MINUTES_PER_DAY);
  const employment = engine.getEmployment(actorId);
  const hasBread = findFirstActiveItem(engine.db, actorId, 'bread') !== null;
  const breadPrice =
    engine.getMarketListing('market', 'bread')?.price ?? getGoodDefinition('bread').basePrice;
  // Food comes before a bed: a bunk only if a day's bread is still covered.
  const canAffordBunk = engine.getBalance(actorId) >= REST_BUNK_PRICE + breadPrice;

  const shiftDue =
    employment !== null &&
    isWorkday(tick) &&
    lastShiftDay !== today &&
    hour >= WORK_START_HOUR &&
    hour < WORK_LAST_START_HOUR;
  const bedtime = hour >= BEDTIME_HOUR || hour < LAST_BEDTIME_HOUR;
  const settingOff = shiftDue || (bedtime && needs.energy < 90);

  const pails = countActiveItemsOfType(engine.db, actorId, 'water');
  const loaves = countActiveItemsOfType(engine.db, actorId, 'bread');
  if (needs.thirst < (settingOff ? 90 : 50)) return { type: pails > 0 ? 'drink' : 'fetch_water' };
  if (hasBread && needs.hunger < (settingOff ? 50 : 30)) return { type: 'eat' };
  // Keep the pack provisioned: water when it's down to a day's worth, bread
  // when there's less than a day's left and a loaf to be had.
  if (pails < Math.ceil(WATER_PAILS_PER_PERSON_PER_DAY) && !bedtime) return { type: 'fetch_water' };
  if (loaves < 2 && !bedtime && engine.getBalance(actorId) >= breadPrice) {
    const listing = engine.getMarketListing('market', 'bread');
    if (listing && listing.quantity > 0) return { type: 'stock_up_bread' };
  }
  if (needs.energy < EXHAUSTED_ENERGY) return { type: canAffordBunk ? 'rest_bunk' : 'rest_rough' };
  if (shiftDue && employment) return { workShiftJobSlotId: employment.jobSlotId };
  if (bedtime && needs.energy < 90) return { type: canAffordBunk ? 'sleep_bunk' : 'sleep_rough' };
  if (calendar.season === 'winter' && needs.warmth < 30 && canAffordBunk) return { type: 'rest_bunk' };
  return null;
}

// §9.2: creates a single-person household for a company's owner-operator —
// reuses the household machinery wholesale (needs, feeding, the adaptation
// ladder) rather than inventing a needs-free "abstract owner" concept, and
// keeps them off the player's expensive per-tick needs path the same way
// every other NPC is (household membership is Engine's own exclusion
// signal — see population/cadence.ts's header comment). Returns the new
// owner's entity id.
function seedCompanyOwner(
  engine: Engine,
  householdId: string,
  name: string,
  managementXp: number,
  jobSlotId: string,
): string {
  const entityId = `${householdId}-owner`;
  engine.createHousehold({ id: householdId, name: `The ${name} Household`, homeSiteId: 'tavern' });
  engine.faucetCoin(householdId, OWNER_STARTING_RESERVE, 'Modest family savings.', 'business');
  engine.createEntity(entityId, name);
  engine.ensureNeeds(entityId);
  engine.addHouseholdMember(householdId, entityId);
  engine.ensureSkill(entityId, MANAGEMENT_SKILL);
  engine.addSkillXp(entityId, MANAGEMENT_SKILL, managementXp);
  engine.applyForJob(entityId, jobSlotId, { haggle: false, scope: 'settlement' });
  return entityId;
}

export function seedDemoWorld(engine: Engine): void {
  registerDemoActionTypes(engine);
  if (engine.getSite('well')) return; // world content already seeded (e.g. a reloaded save)

  // §5.4: rolled once, in a fixed order regardless of outcome, so the RNG
  // draw sequence a given seed produces never depends on an earlier roll's
  // result (same "same DB + same seed = same result" discipline as the
  // rest of this codebase — see rng.ts). Must happen before anything reads
  // engine.calendar (setStartSeasonIndex's own header comment explains why).
  engine.setStartSeasonIndex(Math.floor(engine.nextRandom() * 4));
  const priceLevel = PRICE_LEVEL_MIN + engine.nextRandom() * PRICE_LEVEL_RANGE;
  const harvestQuality = engine.nextRandom();
  const failedBusinessRoll = engine.nextRandom();
  const failedBusinessIndex = Math.floor(engine.nextRandom() * 4);
  // Known up front (it draws nothing new) so a business that has already
  // failed isn't handed starting capital first: before 2026-10-06 the
  // failed company kept its whole starting purse — 12,500 coin for a failed
  // farm — frozen in a closed company's wallet for the rest of the game.
  const rollableCompanies = [FARM_COMPANY_ID, LOGGING_COMPANY_ID, MILL_COMPANY_ID, BAKERY_COMPANY_ID];
  const failedCompanyId =
    failedBusinessRoll < FAILED_BUSINESS_CHANCE ? (rollableCompanies[failedBusinessIndex] ?? null) : null;
  const startingCapital = (companyId: string, amount: number, note: string) => {
    if (companyId !== failedCompanyId) engine.faucetCoin(companyId, amount, note);
  };

  engine.createEntity(PLAYER_ID, 'You');
  engine.ensureWallet(PLAYER_ID);
  engine.faucetCoin(PLAYER_ID, 100, 'Started with 100 coin scraped together before leaving home.');
  engine.ensureNeeds(PLAYER_ID);
  engine.ensureSkill(PLAYER_ID, LABOR_SKILL);

  engine.createSite({ id: 'well', name: 'The Village Well', kind: 'well', x: 0, y: 0 });
  engine.createSite({ id: 'tavern', name: 'The Sleeping Ox', kind: 'tavern', x: 2, y: 1 });
  engine.createSite({ id: 'notice_board', name: 'The Notice Board', kind: 'notice_board', x: 1, y: -1 });
  engine.createSite({
    id: 'forest',
    name: "Hollow's Edge Forest",
    kind: 'forest',
    x: 5,
    y: 3,
    landValue: FOREST_LAND_VALUE,
  });
  engine.createSite({ id: 'market', name: 'The Market Stall', kind: 'market', x: -1, y: 2 });

  // §5.3 "3-5 farmsteads + forest": land nobody works yet, for whoever
  // decides to (world/tenure.ts; population/entrepreneurship.ts). No second
  // mill race — the river has one good fall, so a second mill can only open
  // where the first one closed.
  for (const parcel of VACANT_PARCELS) engine.createSite(parcel);

  // Starting gear (§6: "the early game's shopping list... eventually your
  // own tools" starts with what you leave home wearing).
  // §8.2 stabilizer: the parish's charity fund starts with a modest
  // endowment and is topped up by tithes (population/cadence.ts).
  ensureParish(engine.db);
  engine.faucetCoin(PARISH_ID, PARISH_ENDOWMENT, 'The parish poor-box, as you find it.', 'business');

  engine.produceItem({
    id: 'player-starting-shoes',
    type: 'shoes',
    containerId: PLAYER_ID,
    durability: 200,
    note: 'The shoes you left home in.',
  });
  engine.equipItem(PLAYER_ID, 'player-starting-shoes');

  // A rolled winter start (§5.4) used to be unwinnable for a new player:
  // an uncloaked 6-hour shift burns 75 warmth, a 3-coin bunk restores 30,
  // the wage is a few coin and a cloak costs ~30 against 20 starting coin
  // (STAGE5_AUDIT.md). Nobody sets out in midwinter without one — a winter
  // start begins wearing an old, half-worn cloak.
  if (engine.calendar.season === 'winter') {
    engine.produceItem({
      id: 'player-starting-cloak',
      type: 'cloak',
      containerId: PLAYER_ID,
      durability: Math.floor((getGoodDefinition('cloak').maxDurability ?? 300) / 2),
      note: 'An old cloak, patched at the elbows — nobody sets out in midwinter without one.',
    });
    engine.equipItem(PLAYER_ID, 'player-starting-cloak');
  }

  // Bread stock is a bridging safety buffer, not the settlement's whole
  // supply anymore — §Stage 5's bakery (below) is meant to take over real
  // production within its first few weeks (companies/decisions.ts's daily
  // selling). 1000 is generous enough to cover the ramp-up (the chain needs
  // a farm sale -> mill purchase -> mill sale -> bakery purchase -> bakery
  // sale before any of its own bread reaches the market) without masking
  // whether the chain is actually working, the way the old 6000 would.
  // §5.4 "price levels": every starting listing scales with this world's
  // own rolled priceLevel — two new games can open with genuinely different
  // costs of living, not just different names.
  // 2026-10-06 balancing pass: 1000 → 150. The merchant now restocks bread
  // whenever the town runs short and the price climbs (market/merchant.ts),
  // so the seeded stock only has to bridge the chain's first week or two,
  // not stand in for it.
  engine.seedMarketListing(
    'market',
    'bread',
    rolledPrice(getGoodDefinition('bread').basePrice, priceLevel),
    150,
  );
  engine.seedMarketListing(
    'market',
    'shoes',
    rolledPrice(getGoodDefinition('shoes').basePrice, priceLevel),
    20,
  );
  engine.seedMarketListing(
    'market',
    'cloak',
    rolledPrice(getGoodDefinition('cloak').basePrice, priceLevel),
    10,
  );
  engine.seedMarketListing(
    'market',
    'firewood',
    rolledPrice(getGoodDefinition('firewood').basePrice, priceLevel),
    0,
  );
  // §Stage 5 §9.4: "bought from toolmakers (or the merchant faucet early
  // on)" — no toolmaker company exists yet, so company equipment purchasing
  // (companies/decisions.ts's restockEquipment) buys replacements from here,
  // the same merchant-faucet precedent as shoes/cloaks above.
  engine.seedMarketListing('market', 'hoe', rolledPrice(getGoodDefinition('hoe').basePrice, priceLevel), 5);
  engine.seedMarketListing('market', 'axe', rolledPrice(getGoodDefinition('axe').basePrice, priceLevel), 5);

  // §Stage 3: the farm as employer.
  engine.createSite({
    id: FARM_SITE_ID,
    name: 'Oster Farm',
    kind: 'farm',
    x: 3,
    y: -3,
    landValue: FARM_LAND_VALUE,
  });
  engine.createCompany({ id: FARM_COMPANY_ID, name: 'Oster Farm', kind: 'farm', siteId: FARM_SITE_ID });
  engine.grantSiteTenure(FARM_SITE_ID, FARM_COMPANY_ID);
  startingCapital(
    FARM_COMPANY_ID,
    FARM_STARTING_CAPITAL,
    "The farm's existing capital, built up over past seasons.",
  );
  engine.produceItem(
    withOptional(
      {
        id: `${FARM_COMPANY_ID}-hoe-1`,
        type: 'hoe',
        containerId: FARM_COMPANY_ID,
        note: "The farm's own hoe, handed to whoever's on shift.",
      },
      { durability: getGoodDefinition('hoe').maxDurability },
    ),
  );
  // §5.4 "the recent harvest quality": a bountiful harvest leaves the farm
  // already holding some grain when the game begins; a poor one leaves it
  // starting from nothing — the mill's own restocking (companies/
  // decisions.ts) has real starting stock to draw on sooner or later
  // depending on this roll.
  const startingGrain = Math.round(harvestQuality * MAX_STARTING_GRAIN);
  for (let i = 0; i < startingGrain; i++) {
    engine.produceItem({
      id: `${FARM_COMPANY_ID}-starting-grain-${i}`,
      type: 'grain',
      containerId: FARM_COMPANY_ID,
      note: "Grain left over from last season's harvest.",
      scope: 'business',
    });
  }
  engine.createJobSlot({
    id: FARM_JOB_SLOT_ID,
    companyId: FARM_COMPANY_ID,
    title: 'Farmhand',
    skill: FARMING_SKILL,
    wageMin: FARM_WAGE_MIN,
    wageMax: FARM_WAGE_MAX,
    shiftDurationTicks: FARM_SHIFT_DURATION_TICKS,
    toolGoodType: 'hoe',
    capacity: FARM_JOB_CAPACITY,
  });
  engine.setCompanyOwner(
    FARM_COMPANY_ID,
    seedCompanyOwner(
      engine,
      'household-farm-owner',
      'Aldric Oster',
      FARM_OWNER_MANAGEMENT_XP,
      FARM_JOB_SLOT_ID,
    ),
  );

  // §Stage 4: a second employer — variety in the labor market, and gives
  // households somewhere else to find work if the farm is full. Works out
  // of the existing forest site (created above) rather than a new location.
  engine.createCompany({
    id: LOGGING_COMPANY_ID,
    name: "Hollow's Edge Logging Camp",
    kind: 'logging',
    siteId: LOGGING_SITE_ID,
  });
  engine.grantSiteTenure(LOGGING_SITE_ID, LOGGING_COMPANY_ID);
  startingCapital(
    LOGGING_COMPANY_ID,
    LOGGING_STARTING_CAPITAL,
    "The camp's existing capital, built up over past seasons.",
  );
  engine.produceItem(
    withOptional(
      {
        id: `${LOGGING_COMPANY_ID}-axe-1`,
        type: 'axe',
        containerId: LOGGING_COMPANY_ID,
        note: "The camp's own axe, handed to whoever's on shift.",
      },
      { durability: getGoodDefinition('axe').maxDurability },
    ),
  );
  engine.createJobSlot({
    id: LOGGING_JOB_SLOT_ID,
    companyId: LOGGING_COMPANY_ID,
    title: 'Woodcutter',
    skill: WOODCUTTING_SKILL,
    wageMin: LOGGING_WAGE_MIN,
    wageMax: LOGGING_WAGE_MAX,
    shiftDurationTicks: LOGGING_SHIFT_DURATION_TICKS,
    toolGoodType: 'axe',
    capacity: LOGGING_JOB_CAPACITY,
  });
  engine.setCompanyOwner(
    LOGGING_COMPANY_ID,
    seedCompanyOwner(
      engine,
      'household-logging-owner',
      'Bram Hollow',
      LOGGING_OWNER_MANAGEMENT_XP,
      LOGGING_JOB_SLOT_ID,
    ),
  );

  // §Stage 5: the mill (grain -> flour). No tool requirement yet — company
  // equipment purchasing/upgrade tiers (§9.4/§9.5) are a later slice.
  engine.createSite({
    id: MILL_SITE_ID,
    name: 'Riverside Mill',
    kind: 'mill',
    x: -3,
    y: -1,
    landValue: MILL_LAND_VALUE,
  });
  engine.createCompany({ id: MILL_COMPANY_ID, name: 'Riverside Mill', kind: 'mill', siteId: MILL_SITE_ID });
  engine.grantSiteTenure(MILL_SITE_ID, MILL_COMPANY_ID);
  startingCapital(MILL_COMPANY_ID, MILL_STARTING_CAPITAL, "The mill's modest starting capital.");
  engine.createJobSlot({
    id: MILL_JOB_SLOT_ID,
    companyId: MILL_COMPANY_ID,
    title: 'Miller',
    skill: MILLING_SKILL,
    wageMin: MILL_WAGE_MIN,
    wageMax: MILL_WAGE_MAX,
    shiftDurationTicks: MILL_SHIFT_DURATION_TICKS,
    capacity: MILL_JOB_CAPACITY,
  });
  engine.setCompanyOwner(
    MILL_COMPANY_ID,
    seedCompanyOwner(
      engine,
      'household-mill-owner',
      'Edda Millwright',
      MILL_OWNER_MANAGEMENT_XP,
      MILL_JOB_SLOT_ID,
    ),
  );

  // §Stage 5: the bakery (flour -> bread) — closes the chain the market's
  // bread listing used to be a pure merchant import for.
  engine.createSite({
    id: BAKERY_SITE_ID,
    name: 'The Village Bakery',
    kind: 'bakery',
    x: 0,
    y: 3,
    landValue: BAKERY_LAND_VALUE,
  });
  engine.createCompany({
    id: BAKERY_COMPANY_ID,
    name: 'The Village Bakery',
    kind: 'bakery',
    siteId: BAKERY_SITE_ID,
  });
  engine.grantSiteTenure(BAKERY_SITE_ID, BAKERY_COMPANY_ID);
  startingCapital(BAKERY_COMPANY_ID, BAKERY_STARTING_CAPITAL, "The bakery's modest starting capital.");
  engine.createJobSlot({
    id: BAKERY_JOB_SLOT_ID,
    companyId: BAKERY_COMPANY_ID,
    title: 'Baker',
    skill: BAKING_SKILL,
    wageMin: BAKERY_WAGE_MIN,
    wageMax: BAKERY_WAGE_MAX,
    shiftDurationTicks: BAKERY_SHIFT_DURATION_TICKS,
    capacity: BAKERY_JOB_CAPACITY,
  });
  engine.setCompanyOwner(
    BAKERY_COMPANY_ID,
    seedCompanyOwner(
      engine,
      'household-bakery-owner',
      'Osla Pryce',
      BAKERY_OWNER_MANAGEMENT_XP,
      BAKERY_JOB_SLOT_ID,
    ),
  );

  // §5.4's own example: "one may be freshly failed — the shuttered mill
  // opening." Goes through the one real closure path (companies/
  // decisions.ts's shutDownCompany — the same one insolvency takes) rather
  // than a seed-only shortcut: its owner was really hired above, and the
  // failure really lets them go, sends its tools to auction, spoils its
  // stock and frees its land — just before tick 0 instead of during play.
  let failedCompanyName: string | null = null;
  if (failedCompanyId) {
    failedCompanyName = engine.getCompany(failedCompanyId)?.name ?? null;
    engine.shutDownCompany(
      failedCompanyId,
      `${failedCompanyName ?? 'The business'} had already closed its doors before you arrived.`,
    );
  }

  // §5.4: "this village, this season, this situation" — a short record of
  // what this particular seed rolled, for anything that wants to narrate it
  // later (§14.4's First Hour); not surfaced in any screen yet.
  engine.setScenarioRoll(
    JSON.stringify({
      startSeason: engine.calendar.season,
      priceLevel: Math.round(priceLevel * 100) / 100,
      harvestQuality: Math.round(harvestQuality * 100) / 100,
      failedCompany: failedCompanyName,
    }),
  );

  // §Stage 4: ~40 NPCs in households (§5.3's "one town, ~40-80 persistent
  // NPCs"). Leaves one farmhand slot open for the player to compete for
  // (§14.4's "crowded labor market" is a feature, not an oversight). A
  // closed company (the roll above) doesn't hire — applyForJob enforces
  // that itself now, but filtering here too avoids generateNpcPopulation
  // ever attempting (and throwing on) a hire that can't succeed.
  const candidateJobSlotIds = [
    FARM_JOB_SLOT_ID,
    FARM_JOB_SLOT_ID,
    LOGGING_JOB_SLOT_ID,
    LOGGING_JOB_SLOT_ID,
    LOGGING_JOB_SLOT_ID,
  ].filter((jobSlotId) => {
    if (failedCompanyId === FARM_COMPANY_ID) return jobSlotId !== FARM_JOB_SLOT_ID;
    if (failedCompanyId === LOGGING_COMPANY_ID) return jobSlotId !== LOGGING_JOB_SLOT_ID;
    return true;
  });

  generateNpcPopulation(engine, {
    householdCount: NPC_HOUSEHOLD_COUNT,
    minMembersPerHousehold: 1,
    maxMembersPerHousehold: 3,
    homeSiteId: 'tavern', // no dedicated housing sites yet (§12 Housing is a later module) — the tavern stands in as "town center"
    jobSlotIdsToFill: candidateJobSlotIds,
  });
}
