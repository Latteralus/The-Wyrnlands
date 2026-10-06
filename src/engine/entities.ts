import { queryRow } from './db/sqlite';
import type { Database } from 'sql.js';

export interface Entity {
  id: string;
  name: string;
}

export function createEntity(db: Database, id: string, name: string): void {
  db.run('INSERT OR IGNORE INTO entities (id, name) VALUES (?, ?)', [id, name]);
}

export function getEntity(db: Database, id: string): Entity | null {
  const row = queryRow(db, 'SELECT id, name FROM entities WHERE id = ?', [id]);
  return row ? { id: String(row[0]), name: String(row[1]) } : null;
}

export function getEntityName(db: Database, id: string): string {
  return getEntity(db, id)?.name ?? id;
}

// The player's entity is named "You" — narration about them reads in the
// second person ("You collapse…") rather than as a name ("You collapses…").
export function isYou(db: Database, id: string): boolean {
  return getEntityName(db, id) === 'You';
}
