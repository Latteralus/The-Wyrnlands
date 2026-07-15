import { getGoodDefinition } from '../goods/catalog';
import { findFirstActiveItem } from '../inventory/items';
import { createBuyActionDefinition, createSellActionDefinition } from '../market/market';
import { LABOR_SKILL } from '../skills/skills';
import type { Engine } from '../engine';

// No jobs/production yet (those are Stage 3+) — this seeds just enough world
// for every screen to have real data and, from Stage 2 on, a real survival
// loop: gather firewood on common land, sell it, buy bread, drink for free
// at the well, rest, replace gear as it wears out. Replaced by real rolled
// starting conditions in Stage 5 (§5.4).
export const PLAYER_ID = 'player';

export const REST_BUNK_PRICE = 3;
const REST_BUNK_ENERGY = 50;
const REST_ROUGH_ENERGY = 20;
const SHOE_WEAR_PER_CHOP = 10; // maxDurability 200 → wears out roughly every 20 chops

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

  engine.seedMarketListing('market', 'bread', 2, 500);
  engine.seedMarketListing('market', 'shoes', 15, 20);
  engine.seedMarketListing('market', 'cloak', 25, 10);
  engine.seedMarketListing('market', 'firewood', 3, 0);
}
