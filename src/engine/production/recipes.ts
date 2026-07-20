import { BAKING_SKILL, FARMING_SKILL, MILLING_SKILL, WOODCUTTING_SKILL } from '../skills/skills';

// §9.1 "Structure: inputs + labor + tools + time + building capacity ->
// outputs" and §7.2's goods roadmap ("imported via merchant faucet at
// first, produced locally as chains come online"). This is the single
// source of truth for both production paths this codebase has: the
// player's own timed work_shift action (jobs/shifts.ts) and NPCs' batched
// weekly cadence (population/cadence.ts) — before Stage 5 these read two
// separately hardcoded copies of the same "farming -> grain" fact (and
// shifts.ts silently mis-produced grain for the logging job slot too, a
// real latent bug this unification fixes, not something Stage 5 caused).
//
// Goods-as-data (§16) properly means a DB table (or JSON packs) modding can
// override; this is still the same honest code-catalog stand-in as the
// goods catalog itself (goods/catalog.ts) — a real simplification, flagged
// like every other one, not a silent shortcut.
export interface Recipe {
  skill: string;
  // null = extraction from an effectively infinite resource node (§5.2:
  // "resource nodes are infinite... scarcity comes from labor, logistics,
  // and demand, not depletion") — no input good is consumed.
  inputGood: string | null;
  inputUnitsPerOutputUnit: number; // ignored when inputGood is null
  outputGood: string;
  // Per single shift/labor-unit (§9.8's shift model) — the same number both
  // jobs/shifts.ts (one shift) and population/cadence.ts (batched
  // WEEKLY_SHIFTS-many shifts) scale from, so the player's and NPCs'
  // production math can never drift apart the way it did before Stage 5.
  yieldPerShiftSuccess: number;
  yieldPerShiftFailure: number; // §13.2: failure wastes time/materials, not the whole shift
}

const RECIPES: Record<string, Recipe> = {
  [FARMING_SKILL]: {
    skill: FARMING_SKILL,
    inputGood: null,
    inputUnitsPerOutputUnit: 0,
    outputGood: 'grain',
    yieldPerShiftSuccess: 4,
    yieldPerShiftFailure: 1,
  },
  [WOODCUTTING_SKILL]: {
    skill: WOODCUTTING_SKILL,
    inputGood: null,
    inputUnitsPerOutputUnit: 0,
    outputGood: 'firewood',
    yieldPerShiftSuccess: 4,
    yieldPerShiftFailure: 1,
  },
  // §Stage 5's first real transformation chain: grain -> flour -> bread.
  // 1:1 input ratios and placeholder yields (flagged like every other
  // unbalanced constant so far — revisit with the balance harness, §17).
  [MILLING_SKILL]: {
    skill: MILLING_SKILL,
    inputGood: 'grain',
    inputUnitsPerOutputUnit: 1,
    outputGood: 'flour',
    yieldPerShiftSuccess: 5,
    yieldPerShiftFailure: 1,
  },
  [BAKING_SKILL]: {
    skill: BAKING_SKILL,
    inputGood: 'flour',
    inputUnitsPerOutputUnit: 1,
    outputGood: 'bread',
    yieldPerShiftSuccess: 5,
    yieldPerShiftFailure: 1,
  },
};

export function getRecipeForSkill(skill: string): Recipe | null {
  return RECIPES[skill] ?? null;
}

// §9.6 "decide daily... prices": a company should only sell into the market
// what someone actually wants — bread (the only good with real consumer
// demand: households' feedHousehold, the player's buy_bread) or another
// recipe's input (grain -> mill, flour -> bakery). Firewood is a real,
// deliberate counter-example: no buy_firewood action and no recipe consumes
// it, so the logging camp's own surplus has *no* real buyer yet — selling
// it anyway would just pile literally-unwanted items into the market stall
// forever, real DB bloat for no economic reason (found the hard way: this
// was silently inflating checkpointed-run wall-clock time well past
// stage4.test.ts's regression guard before this gate was added). A future
// use for firewood (a hearth/fuel recipe, a buy action) removes this good
// from the gate automatically, since it'd then show up as a recipe input.
const KNOWN_DEMAND_GOODS = new Set<string>([
  'bread',
  ...Object.values(RECIPES)
    .map((r) => r.inputGood)
    .filter((g): g is string => g !== null),
]);

export function hasKnownDemand(good: string): boolean {
  return KNOWN_DEMAND_GOODS.has(good);
}
