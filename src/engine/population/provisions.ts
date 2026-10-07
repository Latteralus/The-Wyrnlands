import { getGoodDefinition } from '../goods/catalog';
import { consumeActiveItems, countActiveItemsOfType, produceItem } from '../inventory/items';
import { getBalance } from '../inventory/wallet';
import { buyFromMarket, getListing } from '../market/market';
import type { Database } from '../db/sqlite';
import type { EventBus } from '../eventBus';

// Household provisions (§10 "the household is the central economic unit:
// ... shared money/food"): every household keeps a stock of what it eats
// and drinks, sized to its own consumption, instead of buying each meal the
// moment it's eaten — a week's worth at the least, two weeks' when it has
// coin to spare. The player keeps the same kind of supply in their pack
// (seed/demoWorld.ts's playerRoutine).
//
// Two limits on "a week":
//   - Perishables: nobody keeps food past half its shelf life — what's
//     bought may already be days old (bread spoils six days after it's
//     baked, so a household holds about three days of it, not seven).
//   - Water costs nothing but the walk to the well (§6, §8.2), so it's kept
//     at a week, never "two weeks if there's money": coin isn't what limits
//     it.
//
// Water is a real good: someone draws pails at the well and carries them
// home, and the household drinks from that store. Each pail is an item like
// any other — created at the well (a natural resource, like a farm's
// harvest), consumed when drunk, spoiled if left standing too long.

export const MIN_SUPPLY_DAYS = 7;
export const FULL_SUPPLY_DAYS = 14;
export const BREAD_PER_PERSON_PER_DAY = 1;
// Thirst empties in ten hours (needs.ts) and a pail quenches it fully
// (catalog: thirstRestored 100) — about 2.4 pails a person a day.
export const WATER_PAILS_PER_PERSON_PER_DAY = 2.4;
// Coin a household keeps in hand before stocking past its minimum.
export const PROVISION_SPARE_RESERVE = 150;

// How many days of a good a household should hold.
export function supplyDays(goodType: string, spareCoin: boolean): number {
  const def = getGoodDefinition(goodType);
  const wanted = def.basePrice === 0 ? MIN_SUPPLY_DAYS : spareCoin ? FULL_SUPPLY_DAYS : MIN_SUPPLY_DAYS;
  return def.shelfLifeDays ? Math.min(wanted, Math.max(1, Math.floor(def.shelfLifeDays / 2))) : wanted;
}

// Fills a container's water store at the well, up to `target` pails.
// Returns how many pails were drawn.
export function drawWater(
  db: Database,
  bus: EventBus,
  containerId: string,
  target: number,
  tick: number,
  actorId?: string,
): number {
  const have = countActiveItemsOfType(db, containerId, 'water');
  const drawn = Math.max(0, target - have);
  for (let i = 0; i < drawn; i++) {
    produceItem(db, bus, {
      id: `${containerId}-water-${tick}-${i}`,
      type: 'water',
      containerId,
      tick,
      note: 'A pail drawn at the village well.',
      scope: 'business',
      ...(actorId ? { actorId } : {}),
    });
  }
  return drawn;
}

// Buys bread toward `target` loaves in hand, as far as the stall's stock
// and the purse (less `keep` coin) allow. Returns the purchase, if any.
export function stockUpOnBread(
  db: Database,
  bus: EventBus,
  buyerId: string,
  target: number,
  keep: number,
  tick: number,
  note: string,
  destinationContainerId = buyerId,
) {
  const listing = getListing(db, 'market', 'bread');
  if (!listing || listing.quantity <= 0 || listing.price <= 0) return null;
  const want = target - countActiveItemsOfType(db, buyerId, 'bread');
  const affordable = Math.floor(Math.max(0, getBalance(db, buyerId) - keep) / listing.price);
  const units = Math.min(want, affordable, listing.quantity);
  if (units <= 0) return null;
  return buyFromMarket(db, bus, buyerId, 'market', 'bread', units, tick, {
    note,
    scope: 'business',
    destinationContainerId,
  });
}

export interface HouseholdProvisioning {
  fed: number; // members who ate a proper meal today
  watered: boolean; // everyone drank their fill
}

// One household's day: fetch water and stock up on bread toward their
// targets, then drink and eat from the store — oldest first.
export function provisionHousehold(
  db: Database,
  bus: EventBus,
  household: { id: string; name: string },
  memberCount: number,
  tick: number,
  replenish = true,
): HouseholdProvisioning {
  const pailsPerDay = Math.ceil(memberCount * WATER_PAILS_PER_PERSON_PER_DAY);
  // Today's drinking plus the store to keep.
  if (replenish) drawWater(db, bus, household.id, pailsPerDay * (supplyDays('water', false) + 1), tick);
  const drunk = consumeActiveItems(db, bus, household.id, 'water', pailsPerDay, tick, {
    note: `${household.name} drinks.`,
    scope: 'business',
  });

  const breadPerDay = memberCount * BREAD_PER_PERSON_PER_DAY;
  const breadPrice = getListing(db, 'market', 'bread')?.price ?? getGoodDefinition('bread').basePrice;
  const minTarget = breadPerDay * (supplyDays('bread', false) + 1);
  const fullTarget = breadPerDay * (supplyDays('bread', true) + 1);
  const minCost = Math.max(0, minTarget - countActiveItemsOfType(db, household.id, 'bread')) * breadPrice;
  const spare = getBalance(db, household.id) - minCost >= PROVISION_SPARE_RESERVE + fullTarget * breadPrice;
  if (replenish)
    stockUpOnBread(
      db,
      bus,
      household.id,
      spare ? fullTarget : minTarget,
      0,
      tick,
      `${household.name} buys bread at the market.`,
    );
  const fed = consumeActiveItems(db, bus, household.id, 'bread', breadPerDay, tick, {
    note: `${household.name} eats.`,
    scope: 'business',
  });
  return { fed: Math.min(fed, memberCount), watered: drunk >= pailsPerDay };
}
