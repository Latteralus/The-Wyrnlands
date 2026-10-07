import { randomUUID } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeSync,
} from 'node:fs';
import path from 'node:path';
import type { SaveKind, SaveMetadata } from '../shared/protocol';

// The save library on disk (MigrationPlan.md Phase 12):
//
//   <userData>/saves/
//     autosave/          the game being played — its world.sqlite is the
//       world.sqlite     live save (file-backed SQLite) or its latest flush
//       metadata.json    (sql.js)
//       world.sqlite.backup   a periodic safety copy of the live save
//     autosave-backup/   the autosave as it was before the last New Game or
//       …                Load replaced it (another life, kept once)
//     <uuid>/            manual saves and imports
//       world.sqlite
//       metadata.json
//
// world.sqlite is a complete, portable SQLite database — the simulation
// state and nothing else. metadata.json holds what the save list shows and
// the wall-clock times, which never enter the deterministic world.

export const AUTOSAVE_ID = 'autosave';
export const BACKUP_ID = 'autosave-backup';
export const WORLD_FILE = 'world.sqlite';
const METADATA_FILE = 'metadata.json';

const SAVE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const KINDS: readonly SaveKind[] = ['autosave', 'manual', 'import', 'backup'];

// Writes go to a temporary file that is flushed to disk and then renamed
// over the target, so a crash leaves either the old file or the new one,
// never a torn mix.
// A SQLite database file and the side files a connection may leave beside
// it (write-ahead log, shared memory, rollback journal, a pending copy).
export function removeDatabaseFiles(file: string): void {
  for (const suffix of ['', '-wal', '-shm', '-journal', '.tmp']) rmSync(`${file}${suffix}`, { force: true });
}

export function writeFileAtomic(file: string, data: Uint8Array | string): void {
  const temporary = `${file}.tmp`;
  const fd = openSync(temporary, 'w');
  try {
    const bytes = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
    let offset = 0;
    while (offset < bytes.length) offset += writeSync(fd, bytes, offset, bytes.length - offset);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temporary, file);
}

function parseMetadata(text: string): SaveMetadata | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const m = value as Record<string, unknown>;
  const strings = [
    'id',
    'displayName',
    'characterName',
    'season',
    'worldSeed',
    'createdAt',
    'updatedAt',
    'gameVersion',
  ];
  const numbers = ['tick', 'year', 'day', 'saveFormatVersion'];
  if (!strings.every((k) => typeof m[k] === 'string')) return null;
  if (!numbers.every((k) => typeof m[k] === 'number' && Number.isFinite(m[k]))) return null;
  if (!KINDS.includes(m.kind as SaveKind)) return null;
  return value as SaveMetadata;
}

export class SaveLibrary {
  readonly root: string;

  constructor(root: string) {
    this.root = root;
    mkdirSync(root, { recursive: true });
  }

  static isValidId(id: string): boolean {
    return SAVE_ID.test(id);
  }

  newId(): string {
    return randomUUID();
  }

  dir(id: string): string {
    if (!SaveLibrary.isValidId(id)) throw new Error('No such save.');
    return path.join(this.root, id);
  }

  worldFile(id: string): string {
    return path.join(this.dir(id), WORLD_FILE);
  }

  ensureDir(id: string): string {
    const dir = this.dir(id);
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  hasWorld(id: string): boolean {
    return existsSync(this.worldFile(id));
  }

  read(id: string): SaveMetadata | null {
    try {
      const metadata = parseMetadata(readFileSync(path.join(this.dir(id), METADATA_FILE), 'utf8'));
      return metadata && metadata.id === id ? metadata : null;
    } catch {
      return null;
    }
  }

  writeMetadata(metadata: SaveMetadata): void {
    this.ensureDir(metadata.id);
    writeFileAtomic(
      path.join(this.dir(metadata.id), METADATA_FILE),
      `${JSON.stringify(metadata, null, 2)}\n`,
    );
  }

  // Every save with readable metadata and a world file, newest first (ties
  // broken by id, so the order is stable).
  list(): SaveMetadata[] {
    const saves: SaveMetadata[] = [];
    for (const entry of readdirSync(this.root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !SaveLibrary.isValidId(entry.name)) continue;
      const metadata = this.read(entry.name);
      if (metadata && this.hasWorld(entry.name)) saves.push(metadata);
    }
    return saves.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
  }

  remove(id: string): void {
    rmSync(this.dir(id), { recursive: true, force: true });
  }

  // Moves save `fromId`'s world file into save `toId` (replacing it), with
  // new metadata. Both must be closed.
  move(fromId: string, toId: string, metadata: SaveMetadata): void {
    this.ensureDir(toId);
    renameSync(this.worldFile(fromId), this.worldFile(toId));
    this.writeMetadata(metadata);
  }
}
