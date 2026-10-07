import { queryRow } from './db/sqlite';
import type { Database } from './db/sqlite';

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

export type SimulationMode = 'foreground' | 'background';

export function getPlayerEntityId(db: Database): string | null {
  const row = queryRow(db, 'SELECT player_entity_id FROM world_meta WHERE id = 1');
  return typeof row?.[0] === 'string' ? row[0] : null;
}

export function isPlayerControlled(db: Database, id: string): boolean {
  return getPlayerEntityId(db) === id;
}

export function isBackgroundActor(db: Database, id: string): boolean {
  return queryRow(db, 'SELECT simulation_mode FROM entities WHERE id = ?', [id])?.[0] === 'background';
}

export function setSimulationMode(db: Database, id: string, mode: SimulationMode): void {
  db.run('UPDATE entities SET simulation_mode = ? WHERE id = ?', [mode, id]);
}

// Compatibility name for narration callers; identity is independent of display name.
export function isYou(db: Database, id: string): boolean {
  return isPlayerControlled(db, id);
}
