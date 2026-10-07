import { registerGameActions } from '../actions/gameActions';
import { inspectConservation } from '../audit/conservationAudit';
import { migrations } from '../db/migrations';
import { createDatabase, queryRow, queryRows, withSavepoint } from '../db/sqlite';
import { Engine } from '../engine';
import { IMPLEMENTED_SKILLS } from '../skills/skills';
import { getRoutinePreferences, setRoutinePreferences } from './preferences';
import type { SqlJsStatic } from '../db/sqlite';

export const SAVE_FORMAT_VERSION = 1;
export const GAME_VERSION = '0.1.0';

export class SaveLoadError extends Error {}

// Validate before any migrations or engine bootstrap can write to an imported database.
export function loadGame(SQL: SqlJsStatic, bytes: Uint8Array): Engine {
  if (new TextDecoder().decode(bytes.slice(0, 16)) !== 'SQLite format 3\0')
    throw new SaveLoadError('This file is not a SQLite game save.');
  let db;
  try {
    db = createDatabase(SQL, bytes);
  } catch {
    throw new SaveLoadError('This file is damaged or is not a compatible Wyrnlands save.');
  }
  let engine: Engine | null = null;
  try {
    if (queryRow(db, 'PRAGMA quick_check')?.[0] !== 'ok') throw new SaveLoadError('This save is damaged.');
    const applied = queryRows(db, 'SELECT id FROM schema_migrations').map((row) => String(row[0]));
    if (applied.some((id) => !migrations.some((m) => m.id === id)))
      throw new SaveLoadError('This save uses a newer schema. Update the game to load it.');
    // These are the earliest supported playable saves. A bare SQLite DB is not a world.
    if (!applied.includes('0022_market_activity') || !applied.includes('0001_init'))
      throw new SaveLoadError('This is not a compatible Wyrnlands save.');
    const meta = queryRow(db, 'SELECT tick, rng_seed, rng_state FROM world_meta WHERE id = 1');
    if (
      !meta ||
      !Number.isSafeInteger(meta[0]) ||
      Number(meta[0]) < 0 ||
      typeof meta[1] !== 'string' ||
      !Number.isSafeInteger(meta[2]) ||
      Number(meta[2]) < 0 ||
      Number(meta[2]) > 0xffffffff
    )
      throw new SaveLoadError('This save has invalid world data.');
    if (applied.includes('0023_player_experience')) {
      if (
        queryRow(db, 'SELECT save_format_version FROM world_meta WHERE id = 1')?.[0] !== SAVE_FORMAT_VERSION
      )
        throw new SaveLoadError('This save uses an unsupported format. Update the game to load it.');
    }
    engine = withSavepoint(db, () => Engine.bootstrap(db, { seed: String(meta[1]) }));
    const playerId = engine.getPlayerEntityId();
    if (
      !engine.getEntity(playerId) ||
      !engine.getNeeds(playerId) ||
      !engine.getSite('well') ||
      !engine.getSite('tavern')
    )
      throw new SaveLoadError('This save has no playable character or settlement.');
    // Upgrade legacy anonymous-player saves without creating any world content, coin, or gear.
    if (!applied.includes('0023_player_experience')) {
      if (!engine.getHouseholdIdForMember(playerId)) {
        engine.createHousehold({
          id: `${playerId}-household`,
          name: `${engine.getEntity(playerId)?.name ?? 'Player'} Household`,
          homeSiteId: 'tavern',
        });
        engine.addHouseholdMember(`${playerId}-household`, playerId, 'foreground');
      }
      for (const skill of IMPLEMENTED_SKILLS) engine.ensureSkill(playerId, skill);
      setRoutinePreferences(db, playerId, getRoutinePreferences(db, playerId));
    }
    registerGameActions(engine);
    for (const row of queryRows(
      db,
      "SELECT DISTINCT type FROM actions WHERE status IN ('queued', 'in_progress')",
    )) {
      if (!engine.actions.has(String(row[0])))
        throw new SaveLoadError('This save contains actions unavailable in this version.');
    }
    if (!inspectConservation(db, engine.tick).passed)
      throw new SaveLoadError('This save failed the world integrity check.');
    return engine;
  } catch (error) {
    if (engine) engine.dispose();
    else db.close();
    if (error instanceof SaveLoadError) throw error;
    throw new SaveLoadError('This file is damaged or is not a compatible Wyrnlands save.');
  }
}
