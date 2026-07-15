import { describe, expect, it } from 'vitest';
import { createDatabase } from '../db/sqlite';
import { loadSqlJs } from '../db/sqlite.node';
import { Engine } from '../engine';
import { PERSONAL_CARRY_CAPACITY_KG } from './capacity';

describe('inventory capacity', () => {
  it('sums carried weight from the goods catalog and enforces the limit', async () => {
    const SQL = await loadSqlJs();
    const db = createDatabase(SQL);
    const engine = Engine.bootstrap(db, { seed: 'capacity' });
    engine.createEntity('villager-1', 'Test Villager');

    expect(engine.getCarriedWeightKg('villager-1')).toBe(0);
    expect(engine.canCarry('villager-1', PERSONAL_CARRY_CAPACITY_KG)).toBe(true);
    expect(engine.canCarry('villager-1', PERSONAL_CARRY_CAPACITY_KG + 0.01)).toBe(false);

    // firewood weighs 2kg each (catalog) — load up near the cap.
    for (let i = 0; i < 9; i++) {
      engine.produceItem({ id: `firewood-${i}`, type: 'firewood', containerId: 'villager-1' });
    }
    expect(engine.getCarriedWeightKg('villager-1')).toBe(18);
    expect(engine.canCarry('villager-1', 2)).toBe(true);
    expect(engine.canCarry('villager-1', 4)).toBe(false);

    // Destroyed items no longer count.
    engine.destroyItem('firewood-0', 'consumed');
    expect(engine.getCarriedWeightKg('villager-1')).toBe(16);

    engine.dispose();
  });
});
