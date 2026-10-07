import { closeSync, openSync, readFileSync, readSync, renameSync } from 'node:fs';
import { createDatabase, type SqlJsStatic } from '../engine/db/sqlite';
import { NativeDatabase } from '../engine/db/sqlite.native';
import { isSqliteHeader, loadGame, openGame, SaveLoadError } from '../engine/player/loadGame';
import { createNewGame, type NewGameConfig } from '../engine/player/newGame';
import { removeDatabaseFiles, writeFileAtomic } from './saveLibrary';
import type { Engine } from '../engine/engine';
import type { StorageBackend } from '../shared/protocol';

// How a running game is kept on disk. The simulation host drives every save
// operation through this interface, so the same session/save logic runs on
// either SQLite implementation (MigrationPlan.md Phases 8–11).
export interface GameStorage {
  readonly backend: StorageBackend;
  // Whether the host should keep a periodic safety copy of the live save
  // (MigrationPlan.md Phase 24) — only meaningful when the live database
  // file is written in place.
  readonly periodicBackups: boolean;
  // A brand-new world whose save lives at `file` (which must not exist).
  create(config: NewGameConfig, file: string): Engine;
  // Opens the save at `file` for play: validated, migrated, actions
  // registered. Throws SaveLoadError with a player-facing message.
  open(file: string): Engine;
  // Makes everything the running game has done durable in its `file`.
  flush(engine: Engine, file: string): void;
  // A standalone, portable copy of the running game written to `dest`
  // (replacing it atomically).
  snapshot(engine: Engine, dest: string): void;
  // Ends the game: durable in `file`, then closed.
  close(engine: Engine, file: string): void;
}

// sql.js: the world lives in WebAssembly memory; the save file is a full
// export of it, rewritten on every flush — exactly how the browser version
// worked (with IndexedDB in place of files). Kept as the comparison
// baseline and a fallback (--sim-backend=sqljs).
export class SqlJsStorage implements GameStorage {
  readonly backend = 'sqljs';
  // Every flush rewrites the whole file atomically; the previous version
  // survives until the new one is complete.
  readonly periodicBackups = false;

  private readonly SQL: SqlJsStatic;

  constructor(SQL: SqlJsStatic) {
    this.SQL = SQL;
  }

  create(config: NewGameConfig, file: string): Engine {
    const engine = createNewGame(createDatabase(this.SQL), config);
    this.flush(engine, file);
    return engine;
  }

  open(file: string): Engine {
    return loadGame(this.SQL, new Uint8Array(readFileSync(file)));
  }

  flush(engine: Engine, file: string): void {
    writeFileAtomic(file, engine.export());
  }

  snapshot(engine: Engine, dest: string): void {
    writeFileAtomic(dest, engine.export());
  }

  close(engine: Engine, file: string): void {
    this.flush(engine, file);
    engine.dispose();
  }
}

function nativeDatabase(engine: Engine): NativeDatabase {
  if (!(engine.db instanceof NativeDatabase)) throw new Error('Not a native SQLite game.');
  return engine.db;
}

function readHeader(file: string): Uint8Array {
  const fd = openSync(file, 'r');
  try {
    const header = new Uint8Array(16);
    readSync(fd, header, 0, 16, 0);
    return header;
  } finally {
    closeSync(fd);
  }
}

// Native, file-backed SQLite (MigrationPlan.md Phases 10–11): the save file
// *is* the live database. Every batch of ticks and every command is its own
// committed transaction, written through a write-ahead log, so the save is
// always current to the last thing that happened — no exporting the world
// to save it. Flushing only commits the RNG position and folds the log back
// into the file; copies (manual saves, exports, backups) are VACUUM INTO
// snapshots, taken without stopping. At rest — after a clean close — the
// file is an ordinary single-file SQLite database, portable to sql.js or any
// SQLite tool.
export class NativeStorage implements GameStorage {
  readonly backend = 'native';
  readonly periodicBackups = true;

  create(config: NewGameConfig, file: string): Engine {
    removeDatabaseFiles(file);
    return createNewGame(new NativeDatabase(file, { durable: true }), config);
  }

  open(file: string): Engine {
    if (!isSqliteHeader(readHeader(file))) throw new SaveLoadError('This file is not a SQLite game save.');
    let db: NativeDatabase;
    try {
      db = new NativeDatabase(file, { durable: true });
    } catch {
      throw new SaveLoadError('This file is damaged or is not a compatible Wyrnlands save.');
    }
    return openGame(db);
  }

  flush(engine: Engine): void {
    engine.syncRngState();
    nativeDatabase(engine).checkpoint();
  }

  snapshot(engine: Engine, dest: string): void {
    engine.syncRngState();
    const temporary = `${dest}.tmp`;
    removeDatabaseFiles(temporary);
    nativeDatabase(engine).copyTo(temporary);
    renameSync(temporary, dest);
  }

  close(engine: Engine): void {
    engine.syncRngState();
    const db = nativeDatabase(engine);
    db.checkpoint();
    // Back to a plain single-file database on disk.
    db.run('PRAGMA journal_mode = DELETE');
    engine.dispose();
  }
}
