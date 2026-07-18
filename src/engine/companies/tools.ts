import { queryRow } from '../db/sqlite';
import { destroyItem, findFirstActiveItem } from '../inventory/items';
import type { EventBus } from '../eventBus';
import type { Database } from 'sql.js';

// Company-owned tools (§9.4) wear with use like a person's worn gear, but
// aren't equipped via the gear/slot table — they simply live in the
// company's own inventory (container_id = companyId) and get picked up by
// whichever worker is on shift. No shared "in use" reservation exists yet:
// fine while only one worker (the player) can hold a job at all, before
// Stage 4 gives NPCs jobs too.
export function wearCompanyTool(
  db: Database,
  bus: EventBus,
  companyId: string,
  goodType: string,
  amount: number,
  tick: number,
): void {
  const tool = findFirstActiveItem(db, companyId, goodType);
  if (!tool) return;

  const row = queryRow(db, 'SELECT durability FROM items WHERE id = ?', [tool.id]);
  const durability = Number(row?.[0] ?? 0);
  const nextDurability = durability - amount;
  if (nextDurability > 0) {
    db.run('UPDATE items SET durability = ? WHERE id = ?', [nextDurability, tool.id]);
    return;
  }

  destroyItem(db, bus, tool.id, 'worn_out', tick, {
    note: `${companyId}'s ${goodType} wears out and breaks.`,
  });
}
