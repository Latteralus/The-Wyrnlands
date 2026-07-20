import { queryRow, queryRows } from '../db/sqlite';
import { withOptional } from '../optional';
import { incrementGoodsCreated, incrementGoodsDestroyed } from './counters';
import type { EventBus, EventScope } from '../eventBus';
import type { DestructionReason, Item, ProvenanceEvent, ProvenanceEventType } from './types';
import type { Database } from 'sql.js';

function rowToItem(row: unknown[]): Item {
  return {
    id: String(row[0]),
    type: String(row[1]),
    qualityTier: Number(row[2]),
    containerId: String(row[3]),
    status: row[4] as Item['status'],
    createdAtTick: Number(row[5]),
    destroyedAtTick: row[6] === null ? null : Number(row[6]),
  };
}

const ITEM_COLUMNS = 'id, type, quality_tier, container_id, status, created_at_tick, destroyed_at_tick';

export function getItem(db: Database, itemId: string): Item | null {
  const row = queryRow(db, `SELECT ${ITEM_COLUMNS} FROM items WHERE id = ?`, [itemId]);
  return row ? rowToItem(row) : null;
}

export function countActiveItems(db: Database): number {
  const row = queryRow(db, "SELECT COUNT(*) FROM items WHERE status = 'active'");
  return Number(row?.[0]);
}

// Picks any one active item of a type out of a container — e.g. "sell a
// firewood" doesn't care which specific unit, just that one exists.
export function findFirstActiveItem(db: Database, containerId: string, type: string): Item | null {
  const row = queryRow(
    db,
    `SELECT ${ITEM_COLUMNS} FROM items WHERE container_id = ? AND type = ? AND status = 'active' LIMIT 1`,
    [containerId, type],
  );
  return row ? rowToItem(row) : null;
}

// §9.6 "permanent failure -> auction": a closing company needs to liquidate
// everything it still holds, of every type — companies/decisions.ts's
// liquidateCompany is the only caller.
export function listActiveItemsInContainer(db: Database, containerId: string): Item[] {
  return queryRows(db, `SELECT ${ITEM_COLUMNS} FROM items WHERE container_id = ? AND status = 'active'`, [
    containerId,
  ]).map(rowToItem);
}

// §Stage 5: how much of a good a container (typically a company) currently
// holds — production chains (production/recipes.ts) use this to cap output
// by available input stock before consuming any of it.
export function countActiveItemsOfType(db: Database, containerId: string, type: string): number {
  const row = queryRow(
    db,
    `SELECT COUNT(*) FROM items WHERE container_id = ? AND type = ? AND status = 'active'`,
    [containerId, type],
  );
  return Number(row?.[0] ?? 0);
}

function recordProvenance(
  db: Database,
  params: {
    itemId: string;
    tick: number;
    eventType: ProvenanceEventType;
    actorId?: string;
    fromContainerId?: string;
    toContainerId?: string;
    note?: string;
  },
): void {
  db.run(
    `INSERT INTO provenance_events (item_id, tick, event_type, actor_id, from_container_id, to_container_id, note)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      params.itemId,
      params.tick,
      params.eventType,
      params.actorId ?? null,
      params.fromContainerId ?? null,
      params.toContainerId ?? null,
      params.note ?? null,
    ],
  );
}

export function getProvenanceChain(db: Database, itemId: string): ProvenanceEvent[] {
  return queryRows(
    db,
    `SELECT id, item_id, tick, event_type, actor_id, from_container_id, to_container_id, note
     FROM provenance_events WHERE item_id = ? ORDER BY tick ASC, id ASC`,
    [itemId],
  ).map((row) => ({
    id: Number(row[0]),
    itemId: String(row[1]),
    tick: Number(row[2]),
    eventType: row[3] as ProvenanceEventType,
    actorId: row[4] === null ? null : String(row[4]),
    fromContainerId: row[5] === null ? null : String(row[5]),
    toContainerId: row[6] === null ? null : String(row[6]),
    note: row[7] === null ? null : String(row[7]),
  }));
}

export interface ProduceItemParams {
  id: string;
  type: string;
  qualityTier?: number;
  containerId: string;
  tick: number;
  actorId?: string;
  note?: string;
  // Gear/tools only (§6) — the good catalog's maxDurability, so a freshly
  // produced item starts at full condition instead of NULL (which would
  // read as 0, i.e. already broken).
  durability?: number;
  // Defaults to 'personal' — right for the player's own items. Background-
  // simulated NPCs (§Stage 4) pass 'business' so their routine household
  // transactions don't leak into the player's personal log, which nothing
  // filters by actor and only ever shows the player's own scope='personal'
  // feed (see population/cadence.ts's header comment).
  scope?: EventScope;
}

export function produceItem(db: Database, bus: EventBus, params: ProduceItemParams): void {
  const qualityTier = params.qualityTier ?? 1;
  db.run(
    `INSERT INTO items (id, type, quality_tier, container_id, status, created_at_tick, durability)
     VALUES (?, ?, ?, ?, 'active', ?, ?)`,
    [params.id, params.type, qualityTier, params.containerId, params.tick, params.durability ?? null],
  );
  recordProvenance(
    db,
    withOptional(
      {
        itemId: params.id,
        tick: params.tick,
        eventType: 'produced' as const,
        toContainerId: params.containerId,
      },
      { actorId: params.actorId, note: params.note },
    ),
  );
  incrementGoodsCreated(db);

  bus.emit(
    withOptional(
      {
        tick: params.tick,
        scope: params.scope ?? 'personal',
        type: 'item.produced',
        message: params.note ?? `Produced ${params.type}.`,
        data: { itemId: params.id, type: params.type },
      },
      { actorId: params.actorId },
    ),
  );
}

export function transferItem(
  db: Database,
  bus: EventBus,
  itemId: string,
  toContainerId: string,
  tick: number,
  options: { actorId?: string; note?: string; scope?: EventScope } = {},
): void {
  const item = getItem(db, itemId);
  if (!item) throw new Error(`Unknown item: "${itemId}"`);
  if (item.status !== 'active')
    throw new Error(`Cannot transfer non-active item: "${itemId}" (${item.status})`);

  db.run('UPDATE items SET container_id = ? WHERE id = ?', [toContainerId, itemId]);
  recordProvenance(
    db,
    withOptional(
      { itemId, tick, eventType: 'transferred' as const, fromContainerId: item.containerId, toContainerId },
      { actorId: options.actorId, note: options.note },
    ),
  );

  bus.emit(
    withOptional(
      {
        tick,
        scope: options.scope ?? 'personal',
        type: 'item.transferred',
        message: options.note ?? `Moved ${item.type} to ${toContainerId}.`,
        data: { itemId, from: item.containerId, to: toContainerId },
      },
      { actorId: options.actorId },
    ),
  );
}

export function destroyItem(
  db: Database,
  bus: EventBus,
  itemId: string,
  reason: DestructionReason,
  tick: number,
  options: { actorId?: string; note?: string; scope?: EventScope } = {},
): void {
  const item = getItem(db, itemId);
  if (!item) throw new Error(`Unknown item: "${itemId}"`);
  if (item.status !== 'active') throw new Error(`Item already destroyed: "${itemId}" (${item.status})`);

  db.run('UPDATE items SET status = ?, destroyed_at_tick = ? WHERE id = ?', [reason, tick, itemId]);
  recordProvenance(
    db,
    withOptional(
      { itemId, tick, eventType: reason, fromContainerId: item.containerId },
      { actorId: options.actorId, note: options.note },
    ),
  );
  incrementGoodsDestroyed(db);

  bus.emit(
    withOptional(
      {
        tick,
        scope: options.scope ?? 'personal',
        type: `item.${reason}`,
        message: options.note ?? `${item.type} was ${reason}.`,
        data: { itemId, type: item.type },
      },
      { actorId: options.actorId },
    ),
  );
}

// §Stage 5: consumes up to `quantity` active items of a type out of a
// container as production inputs (a mill's grain, a bakery's flour) —
// factored out because production/recipes.ts's two consumers (the player's
// own work_shift action in jobs/shifts.ts, and NPCs' weekly batch in
// population/cadence.ts) both need the exact same "destroy N units,
// individually provenance-logged" loop that feedHousehold (population/
// cadence.ts) already had a bespoke version of. Returns the actual count
// consumed, which can be less than requested if stock runs out mid-loop —
// callers that already capped `quantity` by countActiveItemsOfType shouldn't
// normally see that happen, but nothing here assumes it can't.
export function consumeActiveItems(
  db: Database,
  bus: EventBus,
  containerId: string,
  type: string,
  quantity: number,
  tick: number,
  options: { actorId?: string; note?: string; scope?: EventScope } = {},
): number {
  let consumed = 0;
  for (let i = 0; i < quantity; i++) {
    const item = findFirstActiveItem(db, containerId, type);
    if (!item) break;
    destroyItem(db, bus, item.id, 'consumed', tick, options);
    consumed++;
  }
  return consumed;
}
