import type { Database } from 'sql.js'
import type { EventBus } from '../eventBus'
import { incrementGoodsCreated, incrementGoodsDestroyed } from './counters'
import type { DestructionReason, Item, ProvenanceEvent, ProvenanceEventType } from './types'

function rowToItem(row: unknown[]): Item {
  return {
    id: String(row[0]),
    type: String(row[1]),
    qualityTier: Number(row[2]),
    containerId: String(row[3]),
    status: row[4] as Item['status'],
    createdAtTick: Number(row[5]),
    destroyedAtTick: row[6] === null ? null : Number(row[6]),
  }
}

const ITEM_COLUMNS = 'id, type, quality_tier, container_id, status, created_at_tick, destroyed_at_tick'

export function getItem(db: Database, itemId: string): Item | null {
  const result = db.exec(`SELECT ${ITEM_COLUMNS} FROM items WHERE id = ?`, [itemId])
  if (result.length === 0) return null
  return rowToItem(result[0].values[0])
}

export function countActiveItems(db: Database): number {
  const result = db.exec("SELECT COUNT(*) FROM items WHERE status = 'active'")
  return Number(result[0].values[0][0])
}

function recordProvenance(
  db: Database,
  params: {
    itemId: string
    tick: number
    eventType: ProvenanceEventType
    actorId?: string
    fromContainerId?: string
    toContainerId?: string
    note?: string
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
  )
}

export function getProvenanceChain(db: Database, itemId: string): ProvenanceEvent[] {
  const result = db.exec(
    `SELECT id, item_id, tick, event_type, actor_id, from_container_id, to_container_id, note
     FROM provenance_events WHERE item_id = ? ORDER BY tick ASC, id ASC`,
    [itemId],
  )
  if (result.length === 0) return []
  return result[0].values.map((row) => ({
    id: Number(row[0]),
    itemId: String(row[1]),
    tick: Number(row[2]),
    eventType: row[3] as ProvenanceEventType,
    actorId: row[4] === null ? null : String(row[4]),
    fromContainerId: row[5] === null ? null : String(row[5]),
    toContainerId: row[6] === null ? null : String(row[6]),
    note: row[7] === null ? null : String(row[7]),
  }))
}

export interface ProduceItemParams {
  id: string
  type: string
  qualityTier?: number
  containerId: string
  tick: number
  actorId?: string
  note?: string
}

export function produceItem(db: Database, bus: EventBus, params: ProduceItemParams): void {
  const qualityTier = params.qualityTier ?? 1
  db.run(
    `INSERT INTO items (id, type, quality_tier, container_id, status, created_at_tick)
     VALUES (?, ?, ?, ?, 'active', ?)`,
    [params.id, params.type, qualityTier, params.containerId, params.tick],
  )
  recordProvenance(db, {
    itemId: params.id,
    tick: params.tick,
    eventType: 'produced',
    actorId: params.actorId,
    toContainerId: params.containerId,
    note: params.note,
  })
  incrementGoodsCreated(db)

  bus.emit({
    tick: params.tick,
    scope: 'personal',
    actorId: params.actorId,
    type: 'item.produced',
    message: params.note ?? `Produced ${params.type}.`,
    data: { itemId: params.id, type: params.type },
  })
}

export function transferItem(
  db: Database,
  bus: EventBus,
  itemId: string,
  toContainerId: string,
  tick: number,
  options: { actorId?: string; note?: string } = {},
): void {
  const item = getItem(db, itemId)
  if (!item) throw new Error(`Unknown item: "${itemId}"`)
  if (item.status !== 'active') throw new Error(`Cannot transfer non-active item: "${itemId}" (${item.status})`)

  db.run('UPDATE items SET container_id = ? WHERE id = ?', [toContainerId, itemId])
  recordProvenance(db, {
    itemId,
    tick,
    eventType: 'transferred',
    actorId: options.actorId,
    fromContainerId: item.containerId,
    toContainerId,
    note: options.note,
  })

  bus.emit({
    tick,
    scope: 'personal',
    actorId: options.actorId,
    type: 'item.transferred',
    message: options.note ?? `Moved ${item.type} to ${toContainerId}.`,
    data: { itemId, from: item.containerId, to: toContainerId },
  })
}

export function destroyItem(
  db: Database,
  bus: EventBus,
  itemId: string,
  reason: DestructionReason,
  tick: number,
  options: { actorId?: string; note?: string } = {},
): void {
  const item = getItem(db, itemId)
  if (!item) throw new Error(`Unknown item: "${itemId}"`)
  if (item.status !== 'active') throw new Error(`Item already destroyed: "${itemId}" (${item.status})`)

  db.run('UPDATE items SET status = ?, destroyed_at_tick = ? WHERE id = ?', [reason, tick, itemId])
  recordProvenance(db, {
    itemId,
    tick,
    eventType: reason,
    actorId: options.actorId,
    fromContainerId: item.containerId,
    note: options.note,
  })
  incrementGoodsDestroyed(db)

  bus.emit({
    tick,
    scope: 'personal',
    actorId: options.actorId,
    type: `item.${reason}`,
    message: options.note ?? `${item.type} was ${reason}.`,
    data: { itemId, type: item.type },
  })
}
