import { queryRows } from '../db/sqlite';
import type { Database } from '../db/sqlite';

export type MarketActivityKind =
  'purchase' | 'listed' | 'withdrawn' | 'imported' | 'exported' | 'direct' | 'sold_to_stall';

export interface MarketActivityInput {
  siteId: string;
  tick: number;
  kind: MarketActivityKind;
  goodType: string;
  quantity: number;
  unitPrice: number;
  sellerId: string | null;
  buyerId: string | null;
}

export interface MarketActivity extends MarketActivityInput {
  id: number;
  sellerName: string;
  buyerName: string;
}

export interface MarketActivityFilter {
  goodType?: string;
  kind?: MarketActivityKind;
  beforeId?: number;
  limit?: number;
}

// One entry per seller's batch, never per item or per participant's log.
export function recordMarketActivity(db: Database, entry: MarketActivityInput): void {
  if (entry.quantity <= 0) return;
  db.run(
    `INSERT INTO market_activity (site_id, tick, kind, good_type, quantity, unit_price, seller_id, buyer_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      entry.siteId,
      entry.tick,
      entry.kind,
      entry.goodType,
      entry.quantity,
      entry.unitPrice,
      entry.sellerId,
      entry.buyerId,
    ],
  );
}

export function queryMarketActivity(
  db: Database,
  siteId: string,
  filter: MarketActivityFilter = {},
): MarketActivity[] {
  const limit = Math.min(100, Math.max(1, Math.trunc(filter.limit ?? 40)));
  const rows = queryRows(
    db,
    `SELECT a.id, a.tick, a.kind, a.good_type, a.quantity, a.unit_price, a.seller_id, a.buyer_id,
            seller.name, buyer.name
     FROM market_activity a
     LEFT JOIN entities seller ON seller.id = a.seller_id
     LEFT JOIN entities buyer ON buyer.id = a.buyer_id
     WHERE a.site_id = ?
       ${filter.goodType ? 'AND a.good_type = ?' : ''}
       ${filter.kind ? 'AND a.kind = ?' : ''}
       ${filter.beforeId !== undefined ? 'AND a.id < ?' : ''}
     ORDER BY a.tick DESC, a.id DESC LIMIT ?`,
    [
      siteId,
      ...(filter.goodType ? [filter.goodType] : []),
      ...(filter.kind ? [filter.kind] : []),
      ...(filter.beforeId !== undefined ? [filter.beforeId] : []),
      limit,
    ],
  );
  return rows.map((row) => ({
    id: Number(row[0]),
    siteId,
    tick: Number(row[1]),
    kind: row[2] as MarketActivityKind,
    goodType: String(row[3]),
    quantity: Number(row[4]),
    unitPrice: Number(row[5]),
    sellerId: row[6] === null ? null : String(row[6]),
    buyerId: row[7] === null ? null : String(row[7]),
    sellerName: row[8] === null ? 'Travelling merchant' : String(row[8]),
    buyerName: row[9] === null ? 'Travelling merchant' : String(row[9]),
  }));
}
