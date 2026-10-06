import { BAKING_SKILL, FARMING_SKILL, MILLING_SKILL, WOODCUTTING_SKILL } from '../skills/skills';

// The kinds of business anyone can found (§9.1 "data-defined"), and what
// each needs: the parcel it works from, the trade it practises (which picks
// its recipe — production/recipes.ts), the tool a worker needs, and the job
// it posts. One catalog for every founder — an NPC weighing an opportunity
// (companies/opportunity.ts) and, from Stage 6, the player — so the rules
// for starting a farm can't differ by who starts it.
//
// `id` is the company's `kind`. Wage bands match the seeded companies of the
// same kind (seed/demoWorld.ts) so a newcomer competes on the same labor
// terms. Goods-as-data (§16) properly means DB records; this is the same
// code-catalog stand-in as goods/catalog.ts and production/recipes.ts.
export interface BusinessType {
  id: string;
  // Parcel kind it must hold (world/tenure.ts) — §5.2: a logging company
  // needs forest, a mill needs a mill race.
  siteKind: string;
  skill: string;
  jobTitle: string;
  toolGoodType: string | null;
  wageMin: number;
  wageMax: number;
  shiftDurationTicks: number;
  // Positions a new business of this kind can post before its first
  // upgrade (§9.5: growth beyond this goes through tryUpgrade like anyone's).
  startingMaxPositions: number;
  // "<Founder surname> <suffix>" — e.g. "Hale Timber".
  nameSuffix: string;
}

const SHIFT = 360; // a six-hour shift (§14.4), as every seeded job

const BUSINESS_TYPES: BusinessType[] = [
  {
    id: 'farm',
    siteKind: 'farm',
    skill: FARMING_SKILL,
    jobTitle: 'Farmhand',
    toolGoodType: 'hoe',
    wageMin: 20,
    wageMax: 35,
    shiftDurationTicks: SHIFT,
    startingMaxPositions: 4,
    nameSuffix: 'Farm',
  },
  {
    id: 'logging',
    siteKind: 'forest',
    skill: WOODCUTTING_SKILL,
    jobTitle: 'Woodcutter',
    toolGoodType: 'axe',
    wageMin: 15,
    wageMax: 30,
    shiftDurationTicks: SHIFT,
    startingMaxPositions: 4,
    nameSuffix: 'Timber',
  },
  {
    id: 'mill',
    siteKind: 'mill',
    skill: MILLING_SKILL,
    jobTitle: 'Miller',
    toolGoodType: null,
    wageMin: 20,
    wageMax: 35,
    shiftDurationTicks: SHIFT,
    startingMaxPositions: 2,
    nameSuffix: 'Mill',
  },
  {
    id: 'bakery',
    siteKind: 'bakery',
    skill: BAKING_SKILL,
    jobTitle: 'Baker',
    toolGoodType: null,
    wageMin: 20,
    wageMax: 35,
    shiftDurationTicks: SHIFT,
    startingMaxPositions: 2,
    nameSuffix: 'Bakehouse',
  },
];

export function listBusinessTypes(): BusinessType[] {
  return BUSINESS_TYPES;
}

export function getBusinessType(id: string): BusinessType | null {
  return BUSINESS_TYPES.find((type) => type.id === id) ?? null;
}
