import { queryRow, queryRows } from '../db/sqlite';
import { getGoodDefinition, type GearSlot } from '../goods/catalog';
import { destroyItem, getItem } from '../inventory/items';
import type { EventBus } from '../eventBus';
import type { Database } from 'sql.js';

export interface WornGear {
  slot: GearSlot;
  itemId: string;
  goodType: string;
  durability: number;
  maxDurability: number;
}

// Worn gear (§6, §14.2 character sheet): a slot holds at most one item;
// equipping into an occupied slot swaps it out (the old item stays in the
// actor's inventory, unequipped but intact — equipping never destroys).
export function equipItem(db: Database, bus: EventBus, entityId: string, itemId: string, tick: number): void {
  const item = getItem(db, itemId);
  if (!item) throw new Error(`Unknown item: "${itemId}"`);
  const def = getGoodDefinition(item.type);
  if (!def.slot) throw new Error(`"${item.type}" isn't equippable gear`);

  db.run('INSERT OR REPLACE INTO gear (entity_id, slot, item_id, equipped_at_tick) VALUES (?, ?, ?, ?)', [
    entityId,
    def.slot,
    itemId,
    tick,
  ]);

  bus.emit({
    tick,
    scope: 'personal',
    actorId: entityId,
    type: 'gear.equipped',
    message: `${entityId} equips ${item.type}.`,
    data: { itemId, slot: def.slot },
  });
}

export function getWornGear(db: Database, entityId: string): WornGear[] {
  const rows = queryRows(
    db,
    `SELECT gear.slot, items.id, items.type, items.durability
     FROM gear JOIN items ON items.id = gear.item_id
     WHERE gear.entity_id = ? AND items.status = 'active'`,
    [entityId],
  );
  return rows.map((row) => {
    const goodType = String(row[2]);
    const def = getGoodDefinition(goodType);
    return {
      slot: row[0] as GearSlot,
      itemId: String(row[1]),
      goodType,
      durability: Number(row[3]),
      maxDurability: def.maxDurability ?? 0,
    };
  });
}

export function getWornItemInSlot(db: Database, entityId: string, slot: GearSlot): WornGear | null {
  return getWornGear(db, entityId).find((g) => g.slot === slot) ?? null;
}

// Wear from use (§6: "shoes wear out with walking and labor... tools have
// durability"). Breaking gear unequips and destroys it — the actor is bare
// again until they buy a replacement, which is the point (§Stage 2 exit
// test: "a gear replacement purchase").
export function wearGear(
  db: Database,
  bus: EventBus,
  entityId: string,
  slot: GearSlot,
  amount: number,
  tick: number,
): void {
  const worn = getWornItemInSlot(db, entityId, slot);
  if (!worn) return;

  const nextDurability = worn.durability - amount;
  if (nextDurability > 0) {
    db.run('UPDATE items SET durability = ? WHERE id = ?', [nextDurability, worn.itemId]);
    return;
  }

  db.run('DELETE FROM gear WHERE entity_id = ? AND slot = ?', [entityId, slot]);
  destroyItem(db, bus, worn.itemId, 'worn_out', tick, {
    actorId: entityId,
    note: `${entityId}'s ${worn.goodType} wears out and falls apart.`,
  });
}

export function countGearRows(db: Database): number {
  const row = queryRow(db, 'SELECT COUNT(*) FROM gear');
  return Number(row?.[0]);
}
