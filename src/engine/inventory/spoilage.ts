import { queryRows } from '../db/sqlite';
import { listGoodDefinitions } from '../goods/catalog';
import { MINUTES_PER_DAY } from '../time/clock';
import { destroyItem } from './items';
import type { Database } from '../db/sqlite';
import type { EventBus } from '../eventBus';

// §7.1 "Perishability is first-class (grain keeps months; bread spoils in
// days)" and §8.1 rule 1 ("spoilage and wear are the only destruction").
// Daily: every active unit of a perishable good older than its shelf life
// spoils, wherever it is. A spoiled unit that was sitting in a market's
// stock also comes off that listing's quantity (and any consignment), so
// listings keep counting only what really exists. Over-production of a
// perishable is therefore a real loss, not a stockpile.
export function applySpoilage(db: Database, bus: EventBus, tick: number): void {
  for (const def of listGoodDefinitions()) {
    if (!def.shelfLifeDays) continue;
    const cutoff = tick - def.shelfLifeDays * MINUTES_PER_DAY;
    if (cutoff < 0) continue;
    const expired = queryRows(
      db,
      `SELECT items.id, market_listings.id
       FROM items
       LEFT JOIN market_listings
         ON items.container_id = market_listings.site_id || '-stock' AND market_listings.good_type = items.type
       WHERE items.status = 'active' AND items.type = ? AND items.created_at_tick <= ?
       ORDER BY items.rowid`,
      [def.type, cutoff],
    );
    for (const row of expired) {
      const itemId = String(row[0]);
      const listingId = row[1];
      destroyItem(db, bus, itemId, 'spoiled', tick, {
        note: `${def.type} went bad.`,
        scope: 'business',
      });
      if (listingId !== null && listingId !== undefined) {
        db.run('UPDATE market_listings SET quantity = MAX(0, quantity - 1) WHERE id = ?', [listingId]);
        db.run('DELETE FROM market_consignments WHERE item_id = ?', [itemId]);
      }
    }
  }
}
