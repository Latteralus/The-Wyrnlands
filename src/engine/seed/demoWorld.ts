import { registerGameActions } from '../actions/gameActions';
import { getGoodDefinition } from '../goods/catalog';
import { withOptional } from '../optional';
import { ensureParish, PARISH_ID } from '../population/cadence';
import { generateNpcPopulation } from '../population/npcGen';
import {
  BAKING_SKILL,
  FARMING_SKILL,
  LABOR_SKILL,
  MANAGEMENT_SKILL,
  MILLING_SKILL,
  WOODCUTTING_SKILL,
} from '../skills/skills';
import {
  PLAYER_ID,
  FARM_SITE_ID,
  FARM_COMPANY_ID,
  FARM_JOB_SLOT_ID,
  FARM_SHIFT_DURATION_TICKS,
  FARM_WAGE_MIN,
  FARM_WAGE_MAX,
  FARM_STARTING_CAPITAL,
  FARM_JOB_CAPACITY,
  LOGGING_SITE_ID,
  LOGGING_COMPANY_ID,
  LOGGING_JOB_SLOT_ID,
  LOGGING_SHIFT_DURATION_TICKS,
  LOGGING_WAGE_MIN,
  LOGGING_WAGE_MAX,
  LOGGING_STARTING_CAPITAL,
  LOGGING_JOB_CAPACITY,
  MILL_SITE_ID,
  MILL_COMPANY_ID,
  MILL_JOB_SLOT_ID,
  MILL_SHIFT_DURATION_TICKS,
  MILL_WAGE_MIN,
  MILL_WAGE_MAX,
  MILL_STARTING_CAPITAL,
  MILL_JOB_CAPACITY,
  BAKERY_SITE_ID,
  BAKERY_COMPANY_ID,
  BAKERY_JOB_SLOT_ID,
  BAKERY_SHIFT_DURATION_TICKS,
  BAKERY_WAGE_MIN,
  BAKERY_WAGE_MAX,
  BAKERY_STARTING_CAPITAL,
  BAKERY_JOB_CAPACITY,
  FARM_OWNER_MANAGEMENT_XP,
  LOGGING_OWNER_MANAGEMENT_XP,
  MILL_OWNER_MANAGEMENT_XP,
  BAKERY_OWNER_MANAGEMENT_XP,
  OWNER_STARTING_RESERVE,
  PRICE_LEVEL_MIN,
  PRICE_LEVEL_RANGE,
  MAX_STARTING_GRAIN,
  FAILED_BUSINESS_CHANCE,
  PARISH_ENDOWMENT,
  FARM_LAND_VALUE,
  FOREST_LAND_VALUE,
  MILL_LAND_VALUE,
  BAKERY_LAND_VALUE,
  VACANT_PARCELS,
  rolledPrice,
  NPC_HOUSEHOLD_COUNT,
} from './constants';
import type { Engine } from '../engine';
export {
  PLAYER_ID,
  REST_BUNK_PRICE,
  FARM_SITE_ID,
  FARM_COMPANY_ID,
  FARM_JOB_SLOT_ID,
  FARM_SHIFT_DURATION_TICKS,
  LOGGING_SITE_ID,
  LOGGING_COMPANY_ID,
  LOGGING_JOB_SLOT_ID,
  MILL_SITE_ID,
  MILL_COMPANY_ID,
  MILL_JOB_SLOT_ID,
  BAKERY_SITE_ID,
  BAKERY_COMPANY_ID,
  BAKERY_JOB_SLOT_ID,
  NPC_HOUSEHOLD_COUNT,
  COMPANY_OWNER_HOUSEHOLD_COUNT,
} from './constants';
export { registerGameActions, playerRoutine } from '../actions/gameActions';

// §9.2: creates a single-person household for a company's owner-operator —
// reuses the household machinery wholesale (needs, feeding, the adaptation
// ladder) rather than inventing a needs-free "abstract owner" concept, and
// keeps them off the player's expensive per-tick needs path the same way
// every other NPC is (explicit background simulation mode). Returns the new
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

export function createWorld(engine: Engine, config: { startSeasonIndex?: number } = {}): void {
  if (engine.getSite('well')) return; // world content already seeded (e.g. a reloaded save)

  // §5.4: rolled once, in a fixed order regardless of outcome, so the RNG
  // draw sequence a given seed produces never depends on an earlier roll's
  // result (same "same DB + same seed = same result" discipline as the
  // rest of this codebase — see rng.ts). Must happen before anything reads
  // engine.calendar (setStartSeasonIndex's own header comment explains why).
  const rolledSeason = Math.floor(engine.nextRandom() * 4);
  engine.setStartSeasonIndex(config.startSeasonIndex ?? rolledSeason);
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

// Legacy headless/scenario fixture. Production new games use the typed player creation boundary.
export const registerDemoActionTypes = registerGameActions;

export function seedDemoWorld(engine: Engine): void {
  registerGameActions(engine);
  if (engine.getSite('well')) return;
  createWorld(engine);
  engine.createEntity(PLAYER_ID, 'You');
  engine.ensureWallet(PLAYER_ID);
  engine.faucetCoin(PLAYER_ID, 100, 'Started with 100 coin scraped together before leaving home.');
  engine.ensureNeeds(PLAYER_ID);
  engine.ensureSkill(PLAYER_ID, LABOR_SKILL);

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
}
