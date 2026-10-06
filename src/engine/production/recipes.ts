import { BAKING_SKILL, FARMING_SKILL, MILLING_SKILL, WOODCUTTING_SKILL } from '../skills/skills';

// §9.1 "Structure: inputs + labor + tools + time + building capacity ->
// outputs." The single source of truth for both production paths: the
// player's timed work_shift action (jobs/shifts.ts) and NPCs' cadence
// shifts (population/cadence.ts), both through production/shift.ts's
// runProductionShift, so their math can't drift apart.
//
// Goods-as-data (§16) properly means DB records/JSON packs; this is the
// same code-catalog stand-in as goods/catalog.ts.
export interface Recipe {
  skill: string;
  // null = extraction from an effectively infinite resource node (§5.2 —
  // scarcity comes from labor, not depletion): no input consumed.
  inputGood: string | null;
  outputGood: string;
  // One batch turns `inputUnits` of the input into `outputUnits` of output
  // (e.g. 1 flour -> 2 loaves). Ignored for extraction.
  inputUnits: number;
  outputUnits: number;
  // What one 6-hour shift's labor can turn out, in OUTPUT units, on a
  // successful vs failed skill roll (§13.2: failure wastes time and
  // materials, not the whole shift). For a transformation this is a
  // ceiling — input on hand caps it.
  outputPerShiftSuccess: number;
  outputPerShiftFailure: number;
}

// Yields set in the 2026-10-06 balancing pass (DECISIONS.md), by
// measurement across several 2-year runs:
//  - The original 4-5 units a shift at every step meant feeding ~45 people
//    took ~40 workers; the seeded companies made a sixth of the town's
//    bread and every run starved within a year.
//  - A first rebalance (9 grain / 40 flour / 60 loaves) overshot: the whole
//    chain needed ~7 workers, ~75% of people could never find work, and
//    the town emptied as jobless households left — fewer people, less
//    demand, fewer jobs, a depopulation spiral.
//  - In a closed economy where food is the main thing people buy, a job
//    feeds its worker and about one dependent, so food production has to
//    need roughly half the population for the town to sustain itself — as
//    in a real medieval village, where most people worked the land. Hence
//    a farmer feeds ~4 people (≈2.4 grain a shift, half a sack of grain per
//    loaf), while milling and baking stay skilled, high-throughput trades.
const RECIPES: Record<string, Recipe> = {
  [FARMING_SKILL]: {
    skill: FARMING_SKILL,
    inputGood: null,
    outputGood: 'grain',
    inputUnits: 0,
    outputUnits: 1,
    outputPerShiftSuccess: 3,
    outputPerShiftFailure: 1,
  },
  [WOODCUTTING_SKILL]: {
    skill: WOODCUTTING_SKILL,
    inputGood: null,
    outputGood: 'firewood',
    inputUnits: 0,
    outputUnits: 1,
    outputPerShiftSuccess: 4,
    outputPerShiftFailure: 1,
  },
  [MILLING_SKILL]: {
    skill: MILLING_SKILL,
    inputGood: 'grain',
    outputGood: 'flour',
    inputUnits: 1,
    outputUnits: 1,
    outputPerShiftSuccess: 25,
    outputPerShiftFailure: 10,
  },
  // A sack of flour bakes into two loaves.
  [BAKING_SKILL]: {
    skill: BAKING_SKILL,
    inputGood: 'flour',
    outputGood: 'bread',
    inputUnits: 1,
    outputUnits: 2,
    outputPerShiftSuccess: 48,
    outputPerShiftFailure: 16,
  },
};

export function getRecipeForSkill(skill: string): Recipe | null {
  return RECIPES[skill] ?? null;
}

// How much one shift actually produces and consumes, given the labor's
// output ceiling and the input on hand. Whole batches only.
export function planShift(
  recipe: Recipe,
  laborOutput: number,
  inputAvailable: number,
): { consume: number; produce: number } {
  if (!recipe.inputGood) return { consume: 0, produce: laborOutput };
  const batches = Math.min(
    Math.floor(laborOutput / recipe.outputUnits),
    Math.floor(inputAvailable / recipe.inputUnits),
  );
  return { consume: batches * recipe.inputUnits, produce: batches * recipe.outputUnits };
}

// Expected input a worker processes per shift at full labor (for
// restocking forecasts) — 0 for extraction.
export function inputPerShift(recipe: Recipe): number {
  if (!recipe.inputGood) return 0;
  return (recipe.outputPerShiftSuccess / recipe.outputUnits) * recipe.inputUnits;
}
