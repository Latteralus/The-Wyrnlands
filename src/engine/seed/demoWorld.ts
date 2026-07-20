import { getGoodDefinition } from '../goods/catalog';
import { findFirstActiveItem } from '../inventory/items';
import { createWorkShiftActionDefinition } from '../jobs/shifts';
import { createBuyActionDefinition, createSellActionDefinition } from '../market/market';
import { withOptional } from '../optional';
import { generateNpcPopulation } from '../population/npcGen';
import {
  BAKING_SKILL,
  FARMING_SKILL,
  LABOR_SKILL,
  MANAGEMENT_SKILL,
  MILLING_SKILL,
  WOODCUTTING_SKILL,
} from '../skills/skills';
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
// even before §Stage 5's grain-selling revenue ramps up — generous headroom
// rather than a tightly-balanced number (§17's balance harness is the place
// for real tuning); a company that would eventually go insolvent over a
// long enough run with badly-managed selling is a realistic outcome
// (§11.5), not a bug — see shifts.ts's affordableWage cap for what happens
// when it does, and companies/decisions.ts's insolvency signal.
const FARM_STARTING_CAPITAL = 2500;
const FARM_JOB_CAPACITY = 4; // the owner-operator, a couple of NPC farmhands, and a slot left open for the player

export const LOGGING_SITE_ID = 'forest'; // the camp works out of the existing forest site, no new location needed
export const LOGGING_COMPANY_ID = 'hollows_edge_logging';
export const LOGGING_JOB_SLOT_ID = 'hollows_edge_logging_woodcutter';
const LOGGING_SHIFT_DURATION_TICKS = 360;
const LOGGING_WAGE_MIN = 3;
const LOGGING_WAGE_MAX = 6;
const LOGGING_STARTING_CAPITAL = 2500;
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
const MILL_WAGE_MIN = 3;
const MILL_WAGE_MAX = 6;
const MILL_STARTING_CAPITAL = 500;
const MILL_JOB_CAPACITY = 2;

export const BAKERY_SITE_ID = 'bakery';
export const BAKERY_COMPANY_ID = 'village_bakery';
export const BAKERY_JOB_SLOT_ID = 'village_bakery_baker';
const BAKERY_SHIFT_DURATION_TICKS = 360;
const BAKERY_WAGE_MIN = 3;
const BAKERY_WAGE_MAX = 6;
const BAKERY_STARTING_CAPITAL = 500;
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
const OWNER_STARTING_RESERVE = 80; // same placeholder "modest family savings" as generated NPC households

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
  engine.registerActionType(
    createWorkShiftActionDefinition(MILL_JOB_SLOT_ID, { durationTicks: MILL_SHIFT_DURATION_TICKS }),
  );
  engine.registerActionType(
    createWorkShiftActionDefinition(BAKERY_JOB_SLOT_ID, { durationTicks: BAKERY_SHIFT_DURATION_TICKS }),
  );
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
  engine.seedMarketListing('market', 'bread', rolledPrice(2, priceLevel), 1000);
  engine.seedMarketListing('market', 'shoes', rolledPrice(15, priceLevel), 20);
  engine.seedMarketListing('market', 'cloak', rolledPrice(25, priceLevel), 10);
  engine.seedMarketListing('market', 'firewood', rolledPrice(3, priceLevel), 0);
  // §Stage 5 §9.4: "bought from toolmakers (or the merchant faucet early
  // on)" — no toolmaker company exists yet, so company equipment purchasing
  // (companies/decisions.ts's restockEquipment) buys replacements from here,
  // the same merchant-faucet precedent as shoes/cloaks above.
  engine.seedMarketListing('market', 'hoe', rolledPrice(getGoodDefinition('hoe').basePrice, priceLevel), 5);
  engine.seedMarketListing('market', 'axe', rolledPrice(getGoodDefinition('axe').basePrice, priceLevel), 5);

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
  engine.createSite({ id: MILL_SITE_ID, name: 'Riverside Mill', kind: 'mill', x: -3, y: -1 });
  engine.createCompany({ id: MILL_COMPANY_ID, name: 'Riverside Mill', kind: 'mill', siteId: MILL_SITE_ID });
  engine.faucetCoin(MILL_COMPANY_ID, MILL_STARTING_CAPITAL, "The mill's modest starting capital.");
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
  engine.createSite({ id: BAKERY_SITE_ID, name: 'The Village Bakery', kind: 'bakery', x: 0, y: 3 });
  engine.createCompany({
    id: BAKERY_COMPANY_ID,
    name: 'The Village Bakery',
    kind: 'bakery',
    siteId: BAKERY_SITE_ID,
  });
  engine.faucetCoin(BAKERY_COMPANY_ID, BAKERY_STARTING_CAPITAL, "The bakery's modest starting capital.");
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
  // opening." Reuses the real closure path (companies/decisions.ts's
  // tryCloseCompany does the same two calls once a company's own insolvency
  // runs out its grace period) rather than a seed-only shortcut — this
  // business really did operate (its owner was really hired above) and
  // really did fail, just before tick 0 instead of during play.
  const rollableCompanies = [FARM_COMPANY_ID, LOGGING_COMPANY_ID, MILL_COMPANY_ID, BAKERY_COMPANY_ID];
  let failedCompanyId: string | null = null;
  let failedCompanyName: string | null = null;
  if (failedBusinessRoll < FAILED_BUSINESS_CHANCE) {
    failedCompanyId = rollableCompanies[failedBusinessIndex]!;
    const failedCompany = engine.getCompany(failedCompanyId)!;
    failedCompanyName = failedCompany.name;
    engine.terminateAllEmploymentsForCompany(
      failedCompanyId,
      `${failedCompany.name} had already closed its doors before you arrived.`,
    );
    engine.closeCompany(failedCompanyId);
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
