import { describe, expect, it } from 'vitest';
import { createDatabase } from '../db/sqlite';
import { loadSqlJs } from '../db/sqlite.node';
import { Engine } from '../engine';

describe('gear', () => {
  it('equips into a slot, swaps out a prior occupant, and wears down to destruction', async () => {
    const SQL = await loadSqlJs();
    const db = createDatabase(SQL);
    const engine = Engine.bootstrap(db, { seed: 'gear-lifecycle' });
    engine.createEntity('villager-1', 'Test Villager');

    engine.produceItem({ id: 'shoes-1', type: 'shoes', containerId: 'villager-1', durability: 20 });
    engine.equipItem('villager-1', 'shoes-1');

    const worn = engine.getWornGear('villager-1');
    expect(worn).toEqual([
      { slot: 'feet', itemId: 'shoes-1', goodType: 'shoes', durability: 20, maxDurability: 200 },
    ]);

    // Equipping a second pair swaps the first out (still intact, just unworn).
    engine.produceItem({ id: 'shoes-2', type: 'shoes', containerId: 'villager-1', durability: 200 });
    engine.equipItem('villager-1', 'shoes-2');
    expect(engine.getWornGear('villager-1').map((g) => g.itemId)).toEqual(['shoes-2']);
    expect(engine.getItem('shoes-1')?.status).toBe('active'); // swapped out, not destroyed

    // Wearing shoes-2 down past 0 destroys and unequips it.
    engine.wearGear('villager-1', 'feet', 150);
    expect(engine.getWornGear('villager-1')).toHaveLength(1);
    engine.wearGear('villager-1', 'feet', 150);
    expect(engine.getWornGear('villager-1')).toHaveLength(0);
    expect(engine.getItem('shoes-2')?.status).toBe('worn_out');

    const personalLog = engine.queryLog('personal', 20);
    expect(personalLog.some((e) => e.type === 'item.worn_out')).toBe(true);

    engine.dispose();
  });

  it('rejects equipping a non-gear good', async () => {
    const SQL = await loadSqlJs();
    const db = createDatabase(SQL);
    const engine = Engine.bootstrap(db, { seed: 'gear-non-equippable' });
    engine.createEntity('villager-2', 'Test Villager 2');
    engine.produceItem({ id: 'bread-1', type: 'bread', containerId: 'villager-2' });

    expect(() => engine.equipItem('villager-2', 'bread-1')).toThrow(/isn't equippable/);

    engine.dispose();
  });

  it('wearGear is a no-op when nothing is equipped in that slot', async () => {
    const SQL = await loadSqlJs();
    const db = createDatabase(SQL);
    const engine = Engine.bootstrap(db, { seed: 'gear-empty-slot' });
    engine.createEntity('villager-3', 'Test Villager 3');

    expect(() => engine.wearGear('villager-3', 'feet', 10)).not.toThrow();
    expect(engine.getWornGear('villager-3')).toHaveLength(0);

    engine.dispose();
  });
});
