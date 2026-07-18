import { queryRow } from './db/sqlite';
import type { Database } from 'sql.js';

export interface Entity {
  id: string;
  name: string;
}

export function getEntity(db: Database, id: string): Entity | null {
  const row = queryRow(db, 'SELECT id, name FROM entities WHERE id = ?', [id]);
  return row ? { id: String(row[0]), name: String(row[1]) } : null;
}

export function getEntityName(db: Database, id: string): string {
  return getEntity(db, id)?.name ?? id;
}
