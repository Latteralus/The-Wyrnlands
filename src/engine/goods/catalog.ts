export type GoodCategory = 'food' | 'drink' | 'material' | 'gear' | 'tool';
export type GearSlot = 'feet' | 'body';

export interface GoodDefinition {
  type: string;
  category: GoodCategory;
  weightKg: number;
  basePrice: number;
  hungerRestored?: number;
  thirstRestored?: number;
  warmth?: number; // clothing warmth rating (§6: "warm clothing is gear, not a stat")
  maxDurability?: number; // gear/tools only
  slot?: GearSlot;
  // §7.1 "perishability is first-class (grain keeps months; bread spoils in
  // days)": an item this many days old spoils wherever it is
  // (market/spoilage.ts). Absent = keeps indefinitely.
  shelfLifeDays?: number;
  // §8.1 rule 4's scarcity baseline: the market stock level at which this
  // good sells at its base price (market/pricing.ts). Roughly a couple of
  // days of the settlement's normal demand.
  marketReferenceStock?: number;
  // §8.2 "merchant imports responding to prices": the merchant restocks
  // this good when the local market runs short and the price has been bid
  // up (market/merchant.ts). The import is paid for out of the economy —
  // a sink.
  merchantImports?: boolean;
  // §8.1 rule 2 "export purchases": the merchant buys this good's glut off
  // the local market at a discount (market/merchant.ts) — a faucet, and the
  // price floor that keeps an over-supplied producer from simply dying.
  merchantExports?: boolean;
}

// Goods-as-data (§16) properly belongs in DB records/JSON packs; until then,
// this is the code-level catalog every module reads.
//
// Price and quantity units are balanced as a chain (2026-10-06 balancing
// pass, see DECISIONS.md): 1 grain mills into 1 flour; 1 flour bakes into
// 2 loaves. At base prices each step covers its labor — a farmer's ~2.4
// grain × 12 a shift, a miller's ~20 sacks × (16 − 12), a baker's ~28
// loaves × (12 − 8) against a ~25-coin wage — so the chain is viable
// before scarcity pricing does anything, which the old grain 1 / flour 2 /
// bread 2 with 1:1 baking was not (the bakery lost money at base prices).
//
// All money in the game was re-denominated ×5 in the same pass (bread 2 →
// 10, wages 3-6 → 15-35, ...). Nothing got cheaper or dearer relative to
// anything else; the old one-to-three-coin prices were simply too coarse
// for smoothed pricing to work — a "10% drift" step rounded to a whole
// coin is a 33-100% swing, and a 1-coin good could never signal a glut.
const GOODS: Record<string, GoodDefinition> = {
  bread: {
    type: 'bread',
    category: 'food',
    weightKg: 0.5,
    basePrice: 12,
    // A loaf is a day's bread: the same loaf a household member eats each day
    // (population/provisions.ts) fills the player, too (pillar 2). At 45 the
    // player needed ~2.7 loaves a day to their workmates' one — more than a
    // farmhand's wage could ever buy.
    hungerRestored: 100,
    shelfLifeDays: 6,
    marketReferenceStock: 80,
    merchantImports: true,
  },
  // A pail drawn at the well, carried home and drunk from — a long drink
  // that quenches thirst fully (population/provisions.ts). Free but for the
  // walk; goes stale left standing a fortnight.
  water: {
    type: 'water',
    category: 'drink',
    weightKg: 1,
    basePrice: 0,
    thirstRestored: 100,
    shelfLifeDays: 14,
  },
  firewood: {
    type: 'firewood',
    category: 'material',
    weightKg: 2,
    basePrice: 15,
    marketReferenceStock: 30,
    merchantExports: true,
  },
  shoes: {
    type: 'shoes',
    category: 'gear',
    weightKg: 1,
    basePrice: 75,
    maxDurability: 200,
    slot: 'feet',
    marketReferenceStock: 8,
    merchantImports: true,
  },
  cloak: {
    type: 'cloak',
    category: 'gear',
    weightKg: 2,
    basePrice: 125,
    maxDurability: 300,
    warmth: 40,
    slot: 'body',
    marketReferenceStock: 5,
    merchantImports: true,
  },
  // §7.2 v1 essential goods — harvested by farm labor, milled into flour.
  grain: {
    type: 'grain',
    category: 'material',
    weightKg: 1,
    basePrice: 12,
    shelfLifeDays: 240,
    marketReferenceStock: 40,
    merchantImports: true,
    merchantExports: true,
  },
  // The chain's middle good. Importable too: without it, the mill's
  // failure starved the bakery and took the whole bread chain down with it
  // (it did, in the first balancing iteration).
  flour: {
    type: 'flour',
    category: 'material',
    weightKg: 1,
    basePrice: 16,
    shelfLifeDays: 120,
    marketReferenceStock: 30,
    merchantImports: true,
    merchantExports: true,
  },
  // Company-owned tools (§9.4), not a person's worn gear — no `slot`.
  hoe: {
    type: 'hoe',
    category: 'tool',
    weightKg: 3,
    basePrice: 60,
    maxDurability: 3000,
    marketReferenceStock: 3,
    merchantImports: true,
  },
  axe: {
    type: 'axe',
    category: 'tool',
    weightKg: 4,
    basePrice: 70,
    maxDurability: 3000,
    marketReferenceStock: 3,
    merchantImports: true,
  },
};

export function getGoodDefinition(type: string): GoodDefinition {
  const def = GOODS[type];
  if (!def) throw new Error(`Unknown good type: "${type}"`);
  return def;
}

export function listGoodDefinitions(): GoodDefinition[] {
  return Object.values(GOODS);
}
