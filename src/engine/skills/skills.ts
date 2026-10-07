import { queryRow, queryRows } from '../db/sqlite';
import type { Database } from 'sql.js';

// v1 skill list (§13.2). This module is generic over any skill name, so
// trade skills slot in without a schema change — these are just the named
// constants in use so far, typo-safety over an enum.
export const LABOR_SKILL = 'labor';
export const FARMING_SKILL = 'farming';
export const TRADING_SKILL = 'trading'; // §9.8/§13.2: margins + haggling
export const WOODCUTTING_SKILL = 'woodcutting';
export const MANAGEMENT_SKILL = 'management'; // §9.2: business owners' skill
export const MILLING_SKILL = 'milling'; // §Stage 5: grain -> flour
export const BAKING_SKILL = 'baking'; // §Stage 5: flour -> bread

export const IMPLEMENTED_SKILLS = [
  LABOR_SKILL,
  FARMING_SKILL,
  WOODCUTTING_SKILL,
  MILLING_SKILL,
  BAKING_SKILL,
  TRADING_SKILL,
  MANAGEMENT_SKILL,
] as const;

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

export interface SkillRecord {
  skill: string;
  xp: number;
  level: number;
  // XP still needed for the next level, or null at the cap.
  xpToNextLevel: number | null;
}

// Everything an entity has any XP in, best first — a character sheet or
// profile (§14.2) reads this rather than knowing the skill list.
export function listSkills(db: Database, entityId: string): SkillRecord[] {
  return queryRows(db, 'SELECT skill, xp FROM skills WHERE entity_id = ? ORDER BY xp DESC, skill', [
    entityId,
  ]).map((row) => {
    const xp = Number(row[1]);
    const level = Math.min(MAX_LEVEL, Math.floor(xp / XP_PER_LEVEL));
    return {
      skill: String(row[0]),
      xp,
      level,
      xpToNextLevel: level >= MAX_LEVEL ? null : (level + 1) * XP_PER_LEVEL - xp,
    };
  });
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
