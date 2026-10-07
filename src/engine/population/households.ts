import { queryRow, queryRows } from '../db/sqlite';
import { setSimulationMode, type SimulationMode } from '../entities';
import type { Database } from '../db/sqlite';

// §10 Households. A household is also an entities row — same "reuse the
// entity/wallet/item machinery" precedent as companies (§Stage 3): it owns
// a wallet (shared money) and holds shared food/goods in its own inventory
// container, with no separate "business account" concept invented for it.
export interface Household {
  id: string;
  name: string;
  homeSiteId: string;
  // §11.4 Migration / §10's "migrate" rung — mirrors companies'
  // insolventSinceTick/closedAtTick pair exactly. destituteSinceTick is the
  // first tick this household had no employed members and a balance below
  // the charity threshold, cleared on recovery (set/cleared daily by
  // cadence.ts's applyHouseholdDailyCadence). departedAtTick is set once,
  // for good, when a household stays destitute past its grace period and
  // emigrates (cadence.ts's applyHouseholdMigrationWeeklyCadence) — never
  // cleared, matching every other soft-delete in this codebase.
  destituteSinceTick: number | null;
  departedAtTick: number | null;
  // §11.4 "push (... hunger ...)": +1 per day this household couldn't feed
  // everyone, -1 per day it could, floored at 0 (updated daily by
  // cadence.ts; emigration reads it weekly).
  hungerDays: number;
}

const HOUSEHOLD_COLUMNS = 'id, name, home_site_id, destitute_since_tick, departed_at_tick, hunger_days';

export function createHousehold(
  db: Database,
  household: Omit<Household, 'destituteSinceTick' | 'departedAtTick' | 'hungerDays'>,
): void {
  db.run('INSERT INTO households (id, name, home_site_id) VALUES (?, ?, ?)', [
    household.id,
    household.name,
    household.homeSiteId,
  ]);
}

function rowToHousehold(row: unknown[]): Household {
  return {
    id: String(row[0]),
    name: String(row[1]),
    homeSiteId: String(row[2]),
    destituteSinceTick: row[3] === null ? null : Number(row[3]),
    departedAtTick: row[4] === null ? null : Number(row[4]),
    hungerDays: Number(row[5] ?? 0),
  };
}

export function getHousehold(db: Database, id: string): Household | null {
  const row = queryRow(db, `SELECT ${HOUSEHOLD_COLUMNS} FROM households WHERE id = ?`, [id]);
  return row ? rowToHousehold(row) : null;
}

export function listHouseholds(db: Database): Household[] {
  return queryRows(db, `SELECT ${HOUSEHOLD_COLUMNS} FROM households ORDER BY id`).map(rowToHousehold);
}

export function recordHouseholdFedDay(db: Database, householdId: string, fullyFed: boolean): void {
  db.run(
    'UPDATE households SET hunger_days = CASE WHEN ? THEN MAX(0, hunger_days - 1) ELSE hunger_days + 1 END WHERE id = ?',
    [fullyFed ? 1 : 0, householdId],
  );
}

export function setHouseholdDestitution(db: Database, householdId: string, sinceTick: number | null): void {
  db.run('UPDATE households SET destitute_since_tick = ? WHERE id = ?', [sinceTick, householdId]);
}

// §11.4 "emigrants take theirs out": cadence.ts's applyHouseholdMigrationWeeklyCadence
// is the only caller, and it's responsible for terminating employment and
// liquidating/sinking whatever the household still holds first.
export function departHousehold(db: Database, householdId: string, tick: number): void {
  db.run('UPDATE households SET departed_at_tick = ? WHERE id = ?', [tick, householdId]);
}

export function addHouseholdMember(
  db: Database,
  householdId: string,
  entityId: string,
  mode: SimulationMode = 'background',
): void {
  db.run('INSERT INTO household_members (entity_id, household_id) VALUES (?, ?)', [entityId, householdId]);
  setSimulationMode(db, entityId, mode);
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

// Background presence follows the NPC schedule. Household membership and
// simulation mode are separate: a foreground player can have a home here too.
//
// Excludes members of a departed household (§11.4 Migration) — presence.ts's
// listPresentEntities is the only caller, and an emigrated household has no
// presence to roll (they're gone, not just off today). The membership row
// itself is kept (never deleted, matching every soft-delete in this
// codebase), so getHouseholdIdForMember/listHouseholdMembers still resolve
// it as history — this function alone narrows to the "currently in the
// settlement" set.
export function listAllHouseholdMemberIds(db: Database): string[] {
  return queryRows(
    db,
    `SELECT household_members.entity_id FROM household_members
     JOIN households ON households.id = household_members.household_id
     JOIN entities ON entities.id = household_members.entity_id
     WHERE households.departed_at_tick IS NULL AND entities.simulation_mode = 'background'`,
  ).map((row) => String(row[0]));
}
