import { createDatabase, queryRow } from '../engine/db/sqlite';
import { loadSqlJs } from '../engine/db/sqlite.browser';
import { GAME_VERSION, SAVE_FORMAT_VERSION, loadGame } from '../engine/player/loadGame';
import { createNewGame } from '../engine/player/newGame';
import { createUiApi } from '../engine/ui-api';
import type { SaveMetadata, StoredSave } from './saveStore';
import type { Engine } from '../engine/engine';
import type { NewGameConfig } from '../engine/player/newGame';

// App lifecycle owns this service; screens only receive UiApi.
export class GameSession {
  readonly api;
  private engine: Engine;
  constructor(engine: Engine) {
    this.engine = engine;
    this.api = createUiApi(engine);
  }
  static async create(config: NewGameConfig): Promise<GameSession> {
    return new GameSession(createNewGame(createDatabase(await loadSqlJs()), config));
  }
  static async load(bytes: Uint8Array): Promise<GameSession> {
    return new GameSession(loadGame(await loadSqlJs(), bytes));
  }
  snapshot(id: string, displayName: string, kind: SaveMetadata['kind'], previous?: SaveMetadata): StoredSave {
    const calendar = this.engine.calendar;
    const now = new Date().toISOString();
    return {
      metadata: {
        id,
        kind,
        displayName,
        characterName: this.engine.getPlayerProfile().name,
        tick: this.engine.tick,
        year: calendar.year,
        season: calendar.season,
        day: calendar.day,
        worldSeed: String(queryRow(this.engine.db, 'SELECT rng_seed FROM world_meta WHERE id = 1')?.[0]),
        createdAt: previous?.createdAt ?? now,
        updatedAt: now,
        gameVersion: GAME_VERSION,
        saveFormatVersion: SAVE_FORMAT_VERSION,
      },
      bytes: this.engine.export(),
    };
  }
  export(): Uint8Array {
    return this.engine.export();
  }
  dispose(): void {
    this.engine.dispose();
  }
}
