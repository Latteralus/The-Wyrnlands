import type { Database } from 'sql.js'
import { gridDistance, type Coordinates } from './grid'

export interface Site extends Coordinates {
  id: string
  name: string
  kind: string
}

export function createSite(db: Database, site: Site): void {
  db.run('INSERT INTO sites (id, name, kind, x, y) VALUES (?, ?, ?, ?, ?)', [
    site.id,
    site.name,
    site.kind,
    site.x,
    site.y,
  ])
}

export function getSite(db: Database, id: string): Site | null {
  const result = db.exec('SELECT id, name, kind, x, y FROM sites WHERE id = ?', [id])
  if (result.length === 0) return null
  const [row] = result[0].values
  return rowToSite(row)
}

export function listSitesByKind(db: Database, kind: string): Site[] {
  const result = db.exec('SELECT id, name, kind, x, y FROM sites WHERE kind = ? ORDER BY id', [kind])
  if (result.length === 0) return []
  return result[0].values.map(rowToSite)
}

export function distanceBetweenSites(db: Database, aId: string, bId: string): number {
  const a = getSite(db, aId)
  const b = getSite(db, bId)
  if (!a) throw new Error(`Unknown site: "${aId}"`)
  if (!b) throw new Error(`Unknown site: "${bId}"`)
  return gridDistance(a, b)
}

function rowToSite(row: unknown[]): Site {
  return {
    id: String(row[0]),
    name: String(row[1]),
    kind: String(row[2]),
    x: Number(row[3]),
    y: Number(row[4]),
  }
}
