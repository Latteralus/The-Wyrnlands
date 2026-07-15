import { describe, expect, it } from 'vitest';
import { createDatabase } from '../db/sqlite';
import { loadSqlJs } from '../db/sqlite.node';
import { Engine } from '../engine';
import { LABOR_SKILL } from './skills';

describe('skills', () => {
  it('starts at 0 xp/level and grows the level as xp accrues, capped at max level', async () => {
    const SQL = await loadSqlJs();
    const db = createDatabase(SQL);
    const engine = Engine.bootstrap(db, { seed: 'skills-progress' });
    engine.createEntity('villager-1', 'Test Villager');
    engine.ensureSkill('villager-1', LABOR_SKILL);

    expect(engine.getSkillXp('villager-1', LABOR_SKILL)).toBe(0);
    expect(engine.getSkillLevel('villager-1', LABOR_SKILL)).toBe(0);
    const baseChance = engine.getSkillSuccessChance('villager-1', LABOR_SKILL);

    engine.addSkillXp('villager-1', LABOR_SKILL, 200);
    expect(engine.getSkillLevel('villager-1', LABOR_SKILL)).toBe(1);
    expect(engine.getSkillSuccessChance('villager-1', LABOR_SKILL)).toBeGreaterThan(baseChance);

    engine.addSkillXp('villager-1', LABOR_SKILL, 10_000); // comfortably past max level
    expect(engine.getSkillLevel('villager-1', LABOR_SKILL)).toBe(5);
    const maxChance = engine.getSkillSuccessChance('villager-1', LABOR_SKILL);

    engine.addSkillXp('villager-1', LABOR_SKILL, 500);
    expect(engine.getSkillLevel('villager-1', LABOR_SKILL)).toBe(5);
    expect(engine.getSkillSuccessChance('villager-1', LABOR_SKILL)).toBe(maxChance);

    engine.dispose();
  });

  it('addXp implicitly creates the skill row', async () => {
    const SQL = await loadSqlJs();
    const db = createDatabase(SQL);
    const engine = Engine.bootstrap(db, { seed: 'skills-implicit' });
    engine.createEntity('villager-2', 'Test Villager 2');

    engine.addSkillXp('villager-2', LABOR_SKILL, 50);
    expect(engine.getSkillXp('villager-2', LABOR_SKILL)).toBe(50);

    engine.dispose();
  });
});
