import { describe, expect, it } from 'vitest';
import { getRecipeForSkill } from './recipes';

describe('recipes', () => {
  it('extraction recipes (farming, woodcutting) have no input good', () => {
    expect(getRecipeForSkill('farming')?.inputGood).toBeNull();
    expect(getRecipeForSkill('woodcutting')?.inputGood).toBeNull();
    expect(getRecipeForSkill('farming')?.outputGood).toBe('grain');
    expect(getRecipeForSkill('woodcutting')?.outputGood).toBe('firewood');
  });

  it('transformation recipes (milling, baking) consume a real input good', () => {
    const milling = getRecipeForSkill('milling');
    expect(milling?.inputGood).toBe('grain');
    expect(milling?.outputGood).toBe('flour');

    const baking = getRecipeForSkill('baking');
    expect(baking?.inputGood).toBe('flour');
    expect(baking?.outputGood).toBe('bread');
  });

  it('returns null for a skill with no production recipe', () => {
    expect(getRecipeForSkill('trading')).toBeNull();
    expect(getRecipeForSkill('management')).toBeNull();
  });
});
