// Skill names and the level curve — pure data, shared by the engine and the
// interface (through src/shared). skills.ts holds the database side.

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
export const XP_PER_LEVEL = 200;
export const MAX_SKILL_LEVEL = 5;

export function getXpForSkillLevel(level: number): number {
  if (!Number.isInteger(level) || level < 0 || level > MAX_SKILL_LEVEL)
    throw new Error(`Skill level must be a whole number between 0 and ${MAX_SKILL_LEVEL}.`);
  return level * XP_PER_LEVEL;
}
