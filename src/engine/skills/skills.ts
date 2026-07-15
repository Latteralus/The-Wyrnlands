import { queryRow } from '../db/sqlite';
import type { Database } from 'sql.js';

// v1 skill list (§13.2). Only "labor" is used before jobs/production exist
// (Stage 3+); this module is generic over any skill name so trade skills
// slot in later without a schema change.
export const LABOR_SKILL = 'labor';

// Steep, learn-by-doing requirements (§13.2 "requirements grow steeply").
// Placeholder curve — revisit with the balance harness (§17) once the harsh-
// pace table (§13.1) has real playtesting to calibrate against.
const XP_PER_LEVEL = 200;
const MAX_LEVEL = 5;

export function ensureSkill(db: Database, entityId: string, skill: string): void {
  db.run('INSERT OR IGNORE INTO skills (entity_id, skill, xp) VALUES (?, ?, 0)', [entityId, skill]);
}

export function getXp(db: Database, entityId: string, skill: string): number {
  const row = queryRow(db, 'SELECT xp FROM skills WHERE entity_id = ? AND skill = ?', [entityId, skill]);
  return row ? Number(row[0]) : 0;
}

export function getLevel(db: Database, entityId: string, skill: string): number {
  const xp = getXp(db, entityId, skill);
  return Math.min(MAX_LEVEL, Math.floor(xp / XP_PER_LEVEL));
}

// §13.2: "each labor-tick grants XP" — regardless of the attempt's outcome,
// time spent doing the work is what teaches it.
export function addXp(db: Database, entityId: string, skill: string, amount: number): void {
  ensureSkill(db, entityId, skill);
  db.run('UPDATE skills SET xp = xp + ? WHERE entity_id = ? AND skill = ?', [amount, entityId, skill]);
}

// Skill affects failure rate (§13.2). Unskilled work is allowed but
// failure-prone; the cap keeps even a max-level actor exposed to some risk,
// consistent with "skill affects... failure rate," not eliminates it.
const BASE_SUCCESS_CHANCE = 0.6;
const SUCCESS_CHANCE_PER_LEVEL = 0.07;
const MAX_SUCCESS_CHANCE = 0.95;

export function getSuccessChance(db: Database, entityId: string, skill: string): number {
  const level = getLevel(db, entityId, skill);
  return Math.min(MAX_SUCCESS_CHANCE, BASE_SUCCESS_CHANCE + level * SUCCESS_CHANCE_PER_LEVEL);
}
