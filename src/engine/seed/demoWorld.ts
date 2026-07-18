import { getGoodDefinition } from '../goods/catalog';
import { findFirstActiveItem } from '../inventory/items';
import { createWorkShiftActionDefinition } from '../jobs/shifts';
import { createBuyActionDefinition, createSellActionDefinition } from '../market/market';
import { withOptional } from '../optional';
import { generateNpcPopulation } from '../population/npcGen';
import { FARMING_SKILL, LABOR_SKILL, WOODCUTTING_SKILL } from '../skills/skills';
import type { Engine } from '../engine';

// This seeds just enough world for every screen to have real data: a real
// survival loop (gather firewood on common land, sell it, buy bread, drink
// for free at the well, rest, replace gear as it wears out — Stage 2), a
// real first job (the farm as employer — §Stage 3), and, from Stage 4, a
// living settlement of ~40 NPCs in households. Replaced by real rolled
// starting conditions in Stage 5 (§5.4).
export const PLAYER_ID = 'player';

export const REST_BUNK_PRICE = 3;
const REST_BUNK_ENERGY = 50;
const REST_ROUGH_ENERGY = 20;
const SHOE_WEAR_PER_CHOP = 10; // maxDurability 200 → wears out roughly every 20 chops

export const FARM_SITE_ID = 'farm';
export const FARM_COMPANY_ID = 'oster_farm';
export const FARM_JOB_SLOT_ID = 'oster_farm_farmhand';
export const FARM_SHIFT_DURATION_TICKS = 360; // a six-hour shift (§14.4)
const FARM_WAGE_MIN = 3;
const FARM_WAGE_MAX = 6;
// Sized for up to FARM_JOB_CAPACITY workers' wages over a full 90-day season
// with zero revenue — companies don't sell their output yet (no mill/bakery
// chain until Stage 5), so this is a one-way drain by design. Generous
// headroom rather than a tightly-balanced number (§17's balance harness is
// the place for real tuning); a company that outlives Stage 4's exit test
// but would eventually go insolvent over a longer run is a realistic
// outcome (§11.5), not a bug — see shifts.ts's affordableWage cap for what
// happens when it does.
const FARM_STARTING_CAPITAL = 2500;
const FARM_JOB_CAPACITY = 3; // room for the player plus a couple of NPC farmhands

export const LOGGING_SITE_ID = 'forest'; // the camp works out of the existing forest site, no new location needed
export const LOGGING_COMPANY_ID = 'hollows_edge_logging';
export const LOGGING_JOB_SLOT_ID = 'hollows_edge_logging_woodcutter';
const LOGGING_SHIFT_DURATION_TICKS = 360;
const LOGGING_WAGE_MIN = 3;
const LOGGING_WAGE_MAX = 6;
const LOGGING_STARTING_CAPITAL = 2500;
const LOGGING_JOB_CAPACITY = 3;

export const NPC_HOUSEHOLD_COUNT = 20;

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
    resolve: () => ({ success: true, message: 'You draw a bucket of cold, clean water and drink.' }),
    applyOutcome: (ctx) => engine.restoreNeed(ctx.actorId, 'thirst', 55, 'The water leaves you refreshed.'),
  });

  engine.registerActionType({
    type: 'rest_bunk',
    durationTicks: 60,
    resolve: (_rng, ctx) =>
      engine.getBalance(ctx.actorId) >= REST_BUNK_PRICE
        ? { success: true, message: `You pay ${REST_BUNK_PRICE} coin for a bunk and sleep well.` }
        : { success: false, message: "You can't afford a bunk tonight." },
    applyOutcome: (ctx, outcome) => {
      if (!outcome.success) return;
      engine.sinkCoin(ctx.actorId, REST_BUNK_PRICE, 'Paid for a tavern bunk.');
      engine.restoreNeed(ctx.actorId, 'energy', REST_BUNK_ENERGY, 'A proper bed does wonders.');
      engine.restoreNeed(ctx.actorId, 'warmth', 30, 'The hearth kept you warm all night.');
    },
  });

  // Free, lower-quality rest available anywhere (§6 shelter ladder's bottom
  // rung — "rough") so a coinless actor is never locked out of recovering.
  engine.registerActionType({
    type: 'rest_rough',
    durationTicks: 90,
    resolve: () => ({ success: true, message: 'You rest as best you can, rough as it is.' }),
    applyOutcome: (ctx) =>
      engine.restoreNeed(ctx.actorId, 'energy', REST_ROUGH_ENERGY, 'Not restful, but something.'),
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
        ? { success: true, message: 'You eat a loaf of bread.', data: { itemId: bread.id } }
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
}

export function seedDemoWorld(engine: Engine): void {
  registerDemoActionTypes(engine);
  if (engine.getSite('well')) return; // world content already seeded (e.g. a reloaded save)

  engine.createEntity(PLAYER_ID, 'You');
  engine.ensureWallet(PLAYER_ID);
  engine.faucetCoin(PLAYER_ID, 20, 'Started with 20 coin scraped together before leaving home.');
  engine.ensureNeeds(PLAYER_ID);
  engine.ensureSkill(PLAYER_ID, LABOR_SKILL);

  engine.createSite({ id: 'well', name: 'The Village Well', kind: 'well', x: 0, y: 0 });
  engine.createSite({ id: 'tavern', name: 'The Sleeping Ox', kind: 'tavern', x: 2, y: 1 });
  engine.createSite({ id: 'notice_board', name: 'The Notice Board', kind: 'notice_board', x: 1, y: -1 });
  engine.createSite({ id: 'forest', name: "Hollow's Edge Forest", kind: 'forest', x: 5, y: 3 });
  engine.createSite({ id: 'market', name: 'The Market Stall', kind: 'market', x: -1, y: 2 });

  // Starting gear (§6: "the early game's shopping list... eventually your
  // own tools" starts with what you leave home wearing).
  engine.produceItem({
    id: 'player-starting-shoes',
    type: 'shoes',
    containerId: PLAYER_ID,
    durability: 200,
    note: 'The shoes you left home in.',
  });
  engine.equipItem(PLAYER_ID, 'player-starting-shoes');

  // Bread stock is sized for the whole settlement (§Stage 4's ~40 NPCs plus
  // the player), not just one person — 500 (Stage 2's number) was tuned
  // for a single actor and would run the market dry well inside a 90-day
  // run at this population scale.
  engine.seedMarketListing('market', 'bread', 2, 6000);
  engine.seedMarketListing('market', 'shoes', 15, 20);
  engine.seedMarketListing('market', 'cloak', 25, 10);
  engine.seedMarketListing('market', 'firewood', 3, 0);

  // §Stage 3: the farm as employer.
  engine.createSite({ id: FARM_SITE_ID, name: 'Oster Farm', kind: 'farm', x: 3, y: -3 });
  engine.createCompany({ id: FARM_COMPANY_ID, name: 'Oster Farm', kind: 'farm', siteId: FARM_SITE_ID });
  engine.faucetCoin(
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

  // §Stage 4: a second employer — variety in the labor market, and gives
  // households somewhere else to find work if the farm is full. Works out
  // of the existing forest site (created above) rather than a new location.
  engine.createCompany({
    id: LOGGING_COMPANY_ID,
    name: "Hollow's Edge Logging Camp",
    kind: 'logging',
    siteId: LOGGING_SITE_ID,
  });
  engine.faucetCoin(
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

  // §Stage 4: ~40 NPCs in households (§5.3's "one town, ~40-80 persistent
  // NPCs"). Leaves one farmhand slot open for the player to compete for
  // (§14.4's "crowded labor market" is a feature, not an oversight).
  generateNpcPopulation(engine, {
    householdCount: NPC_HOUSEHOLD_COUNT,
    minMembersPerHousehold: 1,
    maxMembersPerHousehold: 3,
    homeSiteId: 'tavern', // no dedicated housing sites yet (§12 Housing is a later module) — the tavern stands in as "town center"
    jobSlotIdsToFill: [
      FARM_JOB_SLOT_ID,
      FARM_JOB_SLOT_ID,
      LOGGING_JOB_SLOT_ID,
      LOGGING_JOB_SLOT_ID,
      LOGGING_JOB_SLOT_ID,
    ],
  });
}
