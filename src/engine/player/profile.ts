import { queryRows } from '../db/sqlite';
import { getGoodDefinition } from '../goods/catalog';
import { PERSONAL_CARRY_CAPACITY_KG, getCarriedWeightKg } from '../inventory/capacity';
import { getHousehold, getHouseholdIdForMember } from '../population/households';
import { getHouseholdProfile, getPersonProfile } from '../reports/profiles';
import { getRoutinePreferences } from './preferences';
import type { Database } from '../db/sqlite';

export function getPlayerProfile(db: Database, playerId: string) {
  return {
    ...getPersonProfile(db, playerId),
    carriedWeightKg: getCarriedWeightKg(db, playerId),
    capacityKg: PERSONAL_CARRY_CAPACITY_KG,
    items: queryRows(
      db,
      `SELECT id, type, durability FROM items WHERE container_id = ? AND status = 'active' ORDER BY type, id`,
      [playerId],
    ).map((row) => {
      const def = getGoodDefinition(String(row[1]));
      return {
        id: String(row[0]),
        goodType: def.type,
        weightKg: def.weightKg,
        slot: def.slot ?? null,
        durability: row[2] === null ? null : Number(row[2]),
        maxDurability: def.maxDurability ?? null,
        warmth: def.warmth ?? 0,
      };
    }),
  };
}

export type PlayerProfile = ReturnType<typeof getPlayerProfile>;

export function getPlayerHome(db: Database, playerId: string) {
  const householdId = getHouseholdIdForMember(db, playerId);
  const household = householdId ? getHousehold(db, householdId) : null;
  return household
    ? {
        household,
        profile: getHouseholdProfile(db, household.id),
        preferences: getRoutinePreferences(db, playerId),
      }
    : null;
}

export type PlayerHome = ReturnType<typeof getPlayerHome>;
