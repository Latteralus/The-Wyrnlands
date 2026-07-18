import { queryRow, queryRows } from '../db/sqlite';
import type { Database } from 'sql.js';

// §10 Households. A household is also an entities row — same "reuse the
// entity/wallet/item machinery" precedent as companies (§Stage 3): it owns
// a wallet (shared money) and holds shared food/goods in its own inventory
// container, with no separate "business account" concept invented for it.
export interface Household {
  id: string;
  name: string;
  homeSiteId: string;
}

export function createHousehold(db: Database, household: Household): void {
  db.run('INSERT INTO households (id, name, home_site_id) VALUES (?, ?, ?)', [
    household.id,
    household.name,
    household.homeSiteId,
  ]);
}

function rowToHousehold(row: unknown[]): Household {
  return { id: String(row[0]), name: String(row[1]), homeSiteId: String(row[2]) };
}

export function getHousehold(db: Database, id: string): Household | null {
  const row = queryRow(db, 'SELECT id, name, home_site_id FROM households WHERE id = ?', [id]);
  return row ? rowToHousehold(row) : null;
}

export function listHouseholds(db: Database): Household[] {
  return queryRows(db, 'SELECT id, name, home_site_id FROM households ORDER BY id').map(rowToHousehold);
}

export function addHouseholdMember(db: Database, householdId: string, entityId: string): void {
  db.run('INSERT INTO household_members (entity_id, household_id) VALUES (?, ?)', [entityId, householdId]);
}

export function getHouseholdIdForMember(db: Database, entityId: string): string | null {
  const row = queryRow(db, 'SELECT household_id FROM household_members WHERE entity_id = ?', [entityId]);
  return row ? String(row[0]) : null;
}

export function isHouseholdMember(db: Database, entityId: string): boolean {
  return getHouseholdIdForMember(db, entityId) !== null;
}

export function listHouseholdMembers(db: Database, householdId: string): string[] {
  return queryRows(db, 'SELECT entity_id FROM household_members WHERE household_id = ? ORDER BY entity_id', [
    householdId,
  ]).map((row) => String(row[0]));
}

// Every NPC belongs to exactly one household (§Stage 4's population-
// generation invariant). This is the signal Engine uses to split "player" /
// other foreground actors (full per-tick simulation) from "NPC" (background-
// aggregated, daily/weekly cadence — see population/cadence.ts's header
// comment for why that split is load-bearing, not cosmetic).
export function listAllHouseholdMemberIds(db: Database): string[] {
  return queryRows(db, 'SELECT entity_id FROM household_members').map((row) => String(row[0]));
}
