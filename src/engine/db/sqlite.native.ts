import { DatabaseSync, type SQLInputValue, type StatementSync } from 'node:sqlite';
import type { BindParams, Database, SqlValue } from './sqlite';

// Native SQLite for the engine (MigrationPlan.md Phase 10): Node's built-in
// node:sqlite, the same SQLite library compiled into Electron's Node — no
// native module to rebuild or package. Node-only, like db/sqlite.node.ts:
// the simulation process, the perf harness and tests import it; engine
// modules never do (they see only the Database interface).
//
// Requires node:sqlite's array rows (StatementSync.setReturnArrays: Node
// 22.16+ / 24) — Electron 44's Node 24 has them. Engine code reads columns by
// position, so object rows (which collapse duplicate column names) would
// silently corrupt results; an older runtime is refused instead.

// Statements are prepared once and reused; dynamically built SQL is bounded
// by evicting the least recently used.
const STATEMENT_CACHE_SIZE = 512;

// Binds values exactly as sql.js does, so both backends compute the same
// results: a JS number that fits in 32 bits binds as an INTEGER, any other
// number as a REAL (node:sqlite on its own binds every number as a REAL,
// which would make `? / 2` fractional and store 5 as '5.0' in TEXT columns).
function bindValue(value: SqlValue | boolean | undefined): SQLInputValue {
  if (typeof value === 'number') return value === (value | 0) ? BigInt(value) : value;
  if (typeof value === 'boolean') return value ? 1n : 0n;
  if (value === undefined) return null;
  return value;
}

export function isNativeSqliteAvailable(): boolean {
  return typeof (DatabaseSync.prototype as { serialize?: unknown }).serialize === 'function';
}

export interface NativeDatabaseOptions {
  // A file-backed save: write-ahead logging, so a crash leaves the last
  // committed transaction intact and readers never block the writer.
  durable?: boolean;
}

export class NativeDatabase implements Database {
  readonly backend = 'native';
  readonly location: string;
  private readonly db: DatabaseSync;
  private readonly statements = new Map<string, StatementSync>();

  // `location` is a file path, or ':memory:'.
  constructor(location: string, options: NativeDatabaseOptions = {}) {
    if (!isNativeSqliteAvailable())
      throw new Error(`Native SQLite needs Node 22.16+ (array rows); this is Node ${process.versions.node}.`);
    this.location = location;
    this.db = new DatabaseSync(location);
    try {
      if (options.durable) {
        // NORMAL in WAL mode: committed transactions survive a process crash;
        // only an OS crash/power loss can lose the last few — never corrupt.
        //
        // Commits then cost no disk flush; checkpoints (folding the log
        // back into the file) do, and SQLite's default of one every ~4 MB of
        // log made them most of a file-backed game's time (69 ms of every
        // daily commit; PERFORMANCE_AUDIT.md §9.5). The simulation host
        // checkpoints at every autosave (each minute of play, and on close),
        // so SQLite's own trigger is only a backstop for callers that never
        // do: at 64 MB of log.
        this.db.exec(
          'PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA wal_autocheckpoint = 16384;',
        );
      }
      // A larger page cache than SQLite's 2 MB default: the whole working
      // set of a several-year world stays hot.
      this.db.exec('PRAGMA cache_size = -65536;');
    } catch (error) {
      // Not a usable database (e.g. a damaged file): don't keep it open —
      // on Windows an open handle would stop it being deleted.
      this.db.close();
      throw error;
    }
  }

  // A private in-memory copy of a saved file image (tests, imports).
  static fromBytes(bytes: Uint8Array): NativeDatabase {
    const db = new NativeDatabase(':memory:');
    db.db.deserialize(bytes);
    return db;
  }

  private statement(sql: string): StatementSync {
    let statement = this.statements.get(sql);
    if (statement) {
      // Most recently used goes to the back of the eviction order.
      this.statements.delete(sql);
    } else {
      statement = this.db.prepare(sql);
      statement.setReturnArrays(true);
      if (this.statements.size >= STATEMENT_CACHE_SIZE) {
        const oldest = this.statements.keys().next().value;
        if (oldest !== undefined) this.statements.delete(oldest);
      }
    }
    this.statements.set(sql, statement);
    return statement;
  }

  run(sql: string, params?: BindParams): void {
    if (params === undefined) {
      this.db.exec(sql);
      return;
    }
    this.statement(sql).run(...params.map(bindValue));
  }

  query(sql: string, params?: BindParams): SqlValue[][] {
    const statement = this.statement(sql);
    return (params ? statement.all(...params.map(bindValue)) : statement.all()) as unknown as SqlValue[][];
  }

  export(): Uint8Array {
    return new Uint8Array(this.db.serialize());
  }

  // Writes a consistent, standalone copy of the database to `file` (which
  // must not exist) while it stays open — VACUUM INTO, so the copy is also
  // compact and in rollback-journal mode: a single portable file.
  copyTo(file: string): void {
    this.query('VACUUM INTO ?', [file]);
  }

  // Folds the write-ahead log back into the main file.
  checkpoint(): void {
    this.db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
  }

  close(): void {
    this.statements.clear();
    this.db.close();
  }
}
