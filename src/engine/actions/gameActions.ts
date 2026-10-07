import { getGoodDefinition } from '../goods/catalog';
import { PERSONAL_CARRY_CAPACITY_KG } from '../inventory/capacity';
import { consumeActiveItems, countActiveItemsOfType, findFirstActiveItem } from '../inventory/items';
import { createWorkShiftActionDefinition } from '../jobs/shifts';
import { createBuyActionDefinition, createSellActionDefinition, describeSources } from '../market/market';
import { isWorkday } from '../population/cadence';
import {
  drawWater,
  stockUpOnBread,
  supplyDays,
  WATER_PAILS_PER_PERSON_PER_DAY,
} from '../population/provisions';
import {
  REST_BUNK_PRICE,
  REST_BUNK_ENERGY,
  REST_ROUGH_ENERGY,
  SHOE_WEAR_PER_CHOP,
  SLEEP_DURATION_TICKS,
  SLEEP_ROUGH_ENERGY,
  FARM_JOB_SLOT_ID,
  FARM_SHIFT_DURATION_TICKS,
  LOGGING_JOB_SLOT_ID,
  LOGGING_SHIFT_DURATION_TICKS,
  MILL_JOB_SLOT_ID,
  MILL_SHIFT_DURATION_TICKS,
  BAKERY_JOB_SLOT_ID,
  BAKERY_SHIFT_DURATION_TICKS,
} from '../seed/constants';
import { LABOR_SKILL } from '../skills/skills';
import { MINUTES_PER_DAY } from '../time/clock';
import type { Engine, RoutineChoice } from '../engine';

// Action *definitions* are code, held only in the ActionRegistry in memory
// (§Stage 0 decision) — they never persist to the DB. A reloaded save (or,
// as it turns out, a rehydrated Engine — see the Stage 2 scenario test) gets
// a brand-new, empty registry, so this must run on *every* fresh Engine
// instance regardless of whether the world was already seeded. Discovered
// as a real latent bug via that rehydration experiment, not hypothetical:
// seedDemoWorld's old single-guard-clause shape returned early on an
// already-seeded DB, silently skipping registration entirely.
export function registerGameActions(engine: Engine): void {
  for (const company of engine.listCompanies()) {
    for (const slot of engine.listJobSlotsForCompany(company.id)) engine.ensureWorkShiftAction(slot.id);
  }
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
        Math.min(
          PACK_BREAD_LOAVES,
          countActiveItemsOfType(ctx.db, ctx.actorId, 'bread') +
            Math.max(
              0,
              Math.floor(
                (PERSONAL_CARRY_CAPACITY_KG - engine.getCarriedWeightKg(ctx.actorId)) /
                  getGoodDefinition('bread').weightKg,
              ),
            ),
        ),
        engine.getRoutinePreferences(ctx.actorId).reserveCoin,
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
  const prefs = engine.getRoutinePreferences(actorId);
  const tick = engine.tick;
  const calendar = engine.calendarAt(tick);
  const hour = Math.floor(calendar.minuteOfDay / 60);
  const today = Math.floor(tick / MINUTES_PER_DAY);
  const employment = engine.getEmployment(actorId);
  const hasBread = findFirstActiveItem(engine.db, actorId, 'bread') !== null;
  const breadPrice =
    engine.getMarketListing('market', 'bread')?.price ?? getGoodDefinition('bread').basePrice;
  // Food comes before a bed: a bunk only if a day's bread is still covered.
  const canAffordBunk =
    prefs.lodging === 'tavern' &&
    engine.getBalance(actorId) >= REST_BUNK_PRICE + breadPrice + prefs.reserveCoin;

  const shiftDue =
    prefs.attendWork &&
    employment !== null &&
    isWorkday(tick) &&
    lastShiftDay !== today &&
    hour >= WORK_START_HOUR &&
    hour < WORK_LAST_START_HOUR;
  const bedtime = hour >= BEDTIME_HOUR || hour < LAST_BEDTIME_HOUR;
  const settingOff = shiftDue || (bedtime && needs.energy < 90);

  const pails = countActiveItemsOfType(engine.db, actorId, 'water');
  const loaves = countActiveItemsOfType(engine.db, actorId, 'bread');
  if (prefs.eatDrink && needs.thirst < (settingOff ? 90 : 50))
    return { type: pails > 0 ? 'drink' : 'fetch_water' };
  if (prefs.eatDrink && hasBread && needs.hunger < (settingOff ? 50 : 30)) return { type: 'eat' };
  // Keep the pack provisioned: water when it's down to a day's worth, bread
  // when there's less than a day's left and a loaf to be had.
  if (prefs.maintainProvisions && pails < Math.ceil(WATER_PAILS_PER_PERSON_PER_DAY) && !bedtime)
    return { type: 'fetch_water' };
  if (
    prefs.maintainProvisions &&
    loaves < 2 &&
    !bedtime &&
    engine.getBalance(actorId) >= breadPrice + prefs.reserveCoin
  ) {
    const listing = engine.getMarketListing('market', 'bread');
    if (listing && listing.quantity > 0) return { type: 'stock_up_bread' };
  }
  if (prefs.sleep && needs.energy < EXHAUSTED_ENERGY)
    return { type: canAffordBunk ? 'rest_bunk' : 'rest_rough' };
  if (shiftDue && employment) return { workShiftJobSlotId: employment.jobSlotId };
  if (prefs.sleep && bedtime && needs.energy < 90)
    return { type: canAffordBunk ? 'sleep_bunk' : 'sleep_rough' };
  if (prefs.sleep && calendar.season === 'winter' && needs.warmth < 30 && canAffordBunk)
    return { type: 'rest_bunk' };
  return null;
}
