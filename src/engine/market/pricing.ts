import { getGoodDefinition } from '../goods/catalog';
import { listAllMarketListings } from './market';
import type { Database } from 'sql.js';

// §8.1 rule 4: "target price = base × scarcity × demand × local × seasonal;
// actual drifts ~10% of the gap per interval." This implements the scarcity
// factor for real (current stock vs. each listing's own reference_stock,
// set once at seed time — market.ts's seedListing/sellSurplusToMarket) and
// the drift-toward-target mechanic. demand/local/seasonal multipliers are a
// real refinement for later, not modeled yet — flagged, not silently
// dropped (no per-settlement regions or seasons-affecting-price exist
// before Stage 5/7 anyway).
const MIN_SCARCITY_MULTIPLIER = 0.5;
const MAX_SCARCITY_MULTIPLIER = 2.5;
const DRIFT_FRACTION = 0.1; // "~10% of the gap per interval"
const MIN_PRICE = 1;

export function computeTargetPrice(
  basePrice: number,
  quantity: number,
  referenceStock: number | null,
): number {
  if (!referenceStock || referenceStock <= 0) return basePrice;
  const scarcity = Math.min(
    MAX_SCARCITY_MULTIPLIER,
    Math.max(MIN_SCARCITY_MULTIPLIER, referenceStock / Math.max(quantity, 1)),
  );
  return Math.max(MIN_PRICE, Math.round(basePrice * scarcity));
}

// §4.2's cadence table places "price drift" hourly; this engine's cadence
// granularity below a day is per-tick only (no hourly hook exists anywhere
// yet), so this runs once per day instead — smoothed pricing that moves
// daily rather than hourly, a deliberate coarsening flagged like every
// other cadence simplification in this codebase (population/cadence.ts's
// header comment is the precedent). No price-history table exists yet
// either (§14.2's "price history charts" is a later, UI-driven addition) —
// this only maintains the live price, not a queryable series over time.
export function driftMarketPrices(db: Database): void {
  for (const listing of listAllMarketListings(db)) {
    const basePrice = getGoodDefinition(listing.goodType).basePrice;
    const target = computeTargetPrice(basePrice, listing.quantity, listing.referenceStock);
    const gap = target - listing.price;
    if (gap === 0) continue;

    // Prices here are small integers (most goods are 1-25 coin), so a plain
    // "10% of the gap, rounded" can round to zero and leave the price stuck
    // forever just below its target — a real bug, not a rounding nicety.
    // Guarantee at least 1 coin of movement toward the target whenever a
    // real gap exists, but never step past it.
    let step = Math.round(gap * DRIFT_FRACTION);
    if (step === 0) step = Math.sign(gap);
    if (Math.abs(step) > Math.abs(gap)) step = gap;

    const next = Math.max(MIN_PRICE, listing.price + step);
    if (next !== listing.price) {
      db.run('UPDATE market_listings SET price = ? WHERE id = ?', [next, listing.id]);
    }
  }
}
