import { queryRows } from '../db/sqlite';
import { getGoodDefinition, type GoodCategory } from '../goods/catalog';
import { getCarriedWeightKg, PERSONAL_CARRY_CAPACITY_KG } from '../inventory/capacity';
import { dayOf } from './history';
import { listListingsForSite, marketStockContainerId } from './market';
import type { Database } from '../db/sqlite';

export interface MarketSeller {
  sellerId: string | null;
  sellerName: string;
  isCompany: boolean;
  quantity: number;
}

export interface MarketGood {
  goodType: string;
  category: GoodCategory;
  price: number;
  quantity: number;
  weightKg: number;
  priceChange: number | null;
  sellers: MarketSeller[];
}

export interface MarketPackLine {
  goodType: string;
  marketable: boolean;
  quantity: number;
  listableQuantity: number;
  avgCondition: number | null;
}

export interface PersonalMarketListing {
  goodType: string;
  quantity: number;
  price: number;
  firstListedTick: number;
}

export interface MarketOverview {
  goods: MarketGood[];
  pack: MarketPackLine[];
  myListings: PersonalMarketListing[];
  carriedWeightKg: number;
  capacityKg: number;
}

export interface MarketHistoryPoint {
  day: number;
  price: number | null;
  quantity: number | null;
  sold: number;
  imported: number;
  exported: number;
}

export function getMarketHistory(
  db: Database,
  siteId: string,
  goodType: string,
  tick: number,
  windowDays: number,
): MarketHistoryPoint[] {
  const end = dayOf(tick);
  const days = Math.min(90, Math.max(1, Math.trunc(windowDays)));
  return queryRows(
    db,
    `SELECT day, price, quantity, sold, imported, exported FROM market_history
     WHERE site_id = ? AND good_type = ? AND day > ? AND day <= ? ORDER BY day`,
    [siteId, goodType, end - days, end],
  ).map((row) => ({
    day: Number(row[0]),
    price: row[1] === null ? null : Number(row[1]),
    quantity: row[2] === null ? null : Number(row[2]),
    sold: Number(row[3]),
    imported: Number(row[4]),
    exported: Number(row[5]),
  }));
}

// These reads never seed listings, close a day, record activity or draw RNG.
export function getMarketOverview(db: Database, siteId: string, actorId: string): MarketOverview {
  const sellerRows = queryRows(
    db,
    `SELECT i.type, c.consignor_id, e.name, companies.id, COUNT(*)
     FROM items i JOIN market_consignments c ON c.item_id = i.id
     JOIN entities e ON e.id = c.consignor_id
     LEFT JOIN companies ON companies.id = c.consignor_id
     WHERE c.site_id = ? AND i.container_id = ? AND i.status = 'active'
     GROUP BY i.type, c.consignor_id ORDER BY i.type, e.name, c.consignor_id`,
    [siteId, marketStockContainerId(siteId)],
  );
  const lastPrices = new Map(
    queryRows(
      db,
      `SELECT l.good_type, (SELECT h.price FROM market_history h
       WHERE h.site_id = l.site_id AND h.good_type = l.good_type AND h.price IS NOT NULL
       ORDER BY h.day DESC LIMIT 1)
       FROM market_listings l WHERE l.site_id = ?`,
      [siteId],
    )
      .filter((row) => row[1] !== null)
      .map((row) => [String(row[0]), Number(row[1])]),
  );
  const goods = listListingsForSite(db, siteId).map((listing) => {
    const def = getGoodDefinition(listing.goodType);
    const sellers: MarketSeller[] = sellerRows
      .filter((row) => row[0] === listing.goodType)
      .map((row) => ({
        sellerId: String(row[1]),
        sellerName: String(row[2]),
        isCompany: row[3] !== null,
        quantity: Number(row[4]),
      }));
    const merchantQuantity = listing.quantity - sellers.reduce((total, seller) => total + seller.quantity, 0);
    if (merchantQuantity > 0)
      sellers.push({
        sellerId: null,
        sellerName: 'Travelling merchant',
        isCompany: false,
        quantity: merchantQuantity,
      });
    const previous = lastPrices.get(listing.goodType);
    return {
      goodType: listing.goodType,
      category: def.category,
      price: listing.price,
      quantity: listing.quantity,
      weightKg: def.weightKg,
      priceChange: previous === undefined ? null : listing.price - previous,
      sellers,
    };
  });
  const pack = queryRows(
    db,
    `SELECT i.type, COUNT(*), SUM(CASE WHEN g.item_id IS NULL THEN 1 ELSE 0 END), AVG(i.durability)
     FROM items i LEFT JOIN gear g ON g.item_id = i.id
     WHERE i.container_id = ? AND i.status = 'active' GROUP BY i.type ORDER BY i.type`,
    [actorId],
  ).map((row) => {
    const def = getGoodDefinition(String(row[0]));
    return {
      goodType: def.type,
      marketable: def.basePrice > 0,
      quantity: Number(row[1]),
      listableQuantity: Number(row[2]),
      avgCondition: row[3] !== null && def.maxDurability ? Number(row[3]) / def.maxDurability : null,
    };
  });
  const myListings = queryRows(
    db,
    `SELECT i.type, COUNT(*), l.price, MIN(c.consigned_at_tick)
     FROM market_consignments c JOIN items i ON i.id = c.item_id
     JOIN market_listings l ON l.site_id = c.site_id AND l.good_type = i.type
     WHERE c.site_id = ? AND c.consignor_id = ? AND i.container_id = ? AND i.status = 'active'
     GROUP BY i.type ORDER BY i.type`,
    [siteId, actorId, marketStockContainerId(siteId)],
  ).map((row) => ({
    goodType: String(row[0]),
    quantity: Number(row[1]),
    price: Number(row[2]),
    firstListedTick: Number(row[3]),
  }));
  return {
    goods,
    pack,
    myListings,
    carriedWeightKg: getCarriedWeightKg(db, actorId),
    capacityKg: PERSONAL_CARRY_CAPACITY_KG,
  };
}
