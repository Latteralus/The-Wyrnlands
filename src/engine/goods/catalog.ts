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
}

// Goods-as-data (§16) properly belongs to the production/recipes module
// (Stage 5+); until that exists, this is the minimal code-level catalog
// Stage 2's needs/gear/market modules read from — same precedent as action
// definitions being code, not DB rows, until their data-driven module lands.
const GOODS: Record<string, GoodDefinition> = {
  bread: { type: 'bread', category: 'food', weightKg: 0.5, basePrice: 2, hungerRestored: 45 },
  water: { type: 'water', category: 'drink', weightKg: 1, basePrice: 0, thirstRestored: 55 },
  firewood: { type: 'firewood', category: 'material', weightKg: 2, basePrice: 3 },
  shoes: {
    type: 'shoes',
    category: 'gear',
    weightKg: 1,
    basePrice: 15,
    maxDurability: 200,
    slot: 'feet',
  },
  cloak: {
    type: 'cloak',
    category: 'gear',
    weightKg: 2,
    basePrice: 25,
    maxDurability: 300,
    warmth: 40,
    slot: 'body',
  },
  // §7.2 v1 essential goods — harvested by farm shift labor (Stage 3);
  // millable into flour by Stage 5's real production chain (production/recipes.ts).
  grain: { type: 'grain', category: 'material', weightKg: 1, basePrice: 1 },
  // §Stage 5: the grain -> flour -> bread chain's middle good. No merchant
  // import listing of its own — it only ever exists via the mill's real
  // production (or Riverside Mill's starting stock), unlike bread/grain
  // which both still carry a merchant-faucet safety buffer (§7.2 "imported
  // via merchant faucet at first, produced locally as chains come online").
  flour: { type: 'flour', category: 'material', weightKg: 1, basePrice: 2 },
  // Company-owned (§9.4), not a person's worn gear — no `slot`. Durability
  // is generous on purpose: company equipment *purchasing* (replacing a
  // broken tool) is explicitly Stage 5 (§15), so Stage 3's single seeded
  // hoe needs to comfortably outlast a season's worth of shifts rather than
  // strand the job.
  hoe: { type: 'hoe', category: 'tool', weightKg: 3, basePrice: 12, maxDurability: 3000 },
  // §Stage 4's second employer (the logging camp) — same generous,
  // outlast-a-season durability reasoning as the farm's hoe.
  axe: { type: 'axe', category: 'tool', weightKg: 4, basePrice: 14, maxDurability: 3000 },
};

export function getGoodDefinition(type: string): GoodDefinition {
  const def = GOODS[type];
  if (!def) throw new Error(`Unknown good type: "${type}"`);
  return def;
}
