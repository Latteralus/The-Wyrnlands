export const PLAYER_ID = 'player';

export const REST_BUNK_PRICE = 15;
export const REST_BUNK_ENERGY = 50;
export const REST_ROUGH_ENERGY = 20;
export const SHOE_WEAR_PER_CHOP = 10; // maxDurability 200 → wears out roughly every 20 chops
export const SLEEP_DURATION_TICKS = 8 * 60;
// What a night's sleep gives back, spread across the night (an action's
// restoresPerTick, needs.ts): a bunk all of it, rough ground most.
export const SLEEP_ROUGH_ENERGY = 70;

export const FARM_SITE_ID = 'farm';
export const FARM_COMPANY_ID = 'oster_farm';
export const FARM_JOB_SLOT_ID = 'oster_farm_farmhand';
export const FARM_SHIFT_DURATION_TICKS = 360; // a six-hour shift (§14.4)
export const FARM_WAGE_MIN = 20;
export const FARM_WAGE_MAX = 35;
// Sized for up to FARM_JOB_CAPACITY workers' wages over a full 90-day season
// even before §Stage 5's grain-selling revenue ramps up — generous headroom
// rather than a tightly-balanced number (§17's balance harness is the place
// for real tuning); a company that would eventually go insolvent over a
// long enough run with badly-managed selling is a realistic outcome
// (§11.5), not a bug — see shifts.ts's affordableWage cap for what happens
// when it does, and companies/decisions.ts's insolvency signal.
export const FARM_STARTING_CAPITAL = 12500;
export const FARM_JOB_CAPACITY = 10; // the farm is the village's main employer (§3): most hands work the land

export const LOGGING_SITE_ID = 'forest'; // the camp works out of the existing forest site, no new location needed
export const LOGGING_COMPANY_ID = 'hollows_edge_logging';
export const LOGGING_JOB_SLOT_ID = 'hollows_edge_logging_woodcutter';
export const LOGGING_SHIFT_DURATION_TICKS = 360;
export const LOGGING_WAGE_MIN = 15;
export const LOGGING_WAGE_MAX = 30;
export const LOGGING_STARTING_CAPITAL = 12500;
export const LOGGING_JOB_CAPACITY = 4; // the owner-operator plus the same 3 NPC woodcutters as before (still none open for the player)

// §Stage 5's first real transformation chain: grain (farm) -> flour (mill)
// -> bread (bakery), closing the loop that used to be a one-way merchant
// import (see market.ts's producerCompanyId). Modest starting capital —
// unlike the farm/logging camp above, these two are meant to actually earn
// their keep from day one via companies/decisions.ts's daily selling.
export const MILL_SITE_ID = 'mill';
export const MILL_COMPANY_ID = 'riverside_mill';
export const MILL_JOB_SLOT_ID = 'riverside_mill_miller';
export const MILL_SHIFT_DURATION_TICKS = 360;
export const MILL_WAGE_MIN = 20;
export const MILL_WAGE_MAX = 35;
export const MILL_STARTING_CAPITAL = 2500;
export const MILL_JOB_CAPACITY = 2;

export const BAKERY_SITE_ID = 'bakery';
export const BAKERY_COMPANY_ID = 'village_bakery';
export const BAKERY_JOB_SLOT_ID = 'village_bakery_baker';
export const BAKERY_SHIFT_DURATION_TICKS = 360;
export const BAKERY_WAGE_MIN = 20;
export const BAKERY_WAGE_MAX = 35;
export const BAKERY_STARTING_CAPITAL = 2500;
export const BAKERY_JOB_CAPACITY = 2;

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
export const FARM_OWNER_MANAGEMENT_XP = 650; // level 3
export const LOGGING_OWNER_MANAGEMENT_XP = 450; // level 2
export const MILL_OWNER_MANAGEMENT_XP = 1100; // level 5
export const BAKERY_OWNER_MANAGEMENT_XP = 50; // level 0
export const OWNER_STARTING_RESERVE = 400; // same placeholder "modest family savings" as generated NPC households

// §5.4 "Starting Conditions Are Rolled... the recent harvest quality, each
// business's health... current season, price levels, and job availability.
// Two new games in the same village play differently." The starting season
// itself is rolled by createWorld (with an optional explicit override);
// everything else rolled here is genuinely this seed's own
// content decision. "Job availability" is the one named factor *not*
// separately rolled this slice — the existing NPC-generation randomness
// already gives some natural variance in who's hired where, but nothing
// here deliberately widens or narrows it further; a flagged, honest scope
// cut, not a silent omission.
export const PRICE_LEVEL_MIN = 0.85;
export const PRICE_LEVEL_RANGE = 0.4; // rolls a market-wide price level in [0.85, 1.25)
export const MAX_STARTING_GRAIN = 40; // a bountiful recent harvest leaves the farm with up to this much grain already in store
export const FAILED_BUSINESS_CHANCE = 0.2; // §5.4's own example: "one may be freshly failed — the shuttered mill opening"
export const PARISH_ENDOWMENT = 500;

// What each parcel is worth (world/tenure.ts prices leases and purchases
// from it). The seeded companies hold theirs freehold, as they always
// implicitly did; when one closes its land is free for the next taker.
export const FARM_LAND_VALUE = 800;
export const FOREST_LAND_VALUE = 500;
export const MILL_LAND_VALUE = 1000;
export const BAKERY_LAND_VALUE = 700;
export const VACANT_PARCELS = [
  { id: 'eastfield', name: 'Eastfield', kind: 'farm', x: 6, y: -4, landValue: 600 },
  { id: 'brook_meadow', name: 'Brook Meadow', kind: 'farm', x: -5, y: 4, landValue: 600 },
  { id: 'northwood', name: 'Northwood Lot', kind: 'forest', x: 8, y: 6, landValue: 400 },
  { id: 'old_bakehouse', name: 'The Old Bakehouse', kind: 'bakery', x: 1, y: 4, landValue: 600 },
];

export function rolledPrice(basePrice: number, priceLevel: number): number {
  return Math.max(1, Math.round(basePrice * priceLevel));
}

export const NPC_HOUSEHOLD_COUNT = 20;
// §9.2: one single-person household per company owner-operator (farm,
// logging, mill, bakery — seedCompanyOwner) — real households, not test
// fixtures, so anything counting engine.listHouseholds() needs to account
// for them alongside the generated NPC ones.
export const COMPANY_OWNER_HOUSEHOLD_COUNT = 4;
