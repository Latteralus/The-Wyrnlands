import { copyFileSync, existsSync, renameSync } from 'node:fs';
import path from 'node:path';
import { queryRow, withSavepoint } from '../engine/db/sqlite';
import { GAME_VERSION, SAVE_FORMAT_VERSION } from '../engine/player/loadGame';
import { validateNewGameConfig } from '../engine/player/newGame';
import { createUiApi, type UiApi } from '../engine/ui-api';
import {
  isMethodName,
  type MethodName,
  type ParamsOf,
  type ResultOf,
  type SaveKind,
  type SaveListing,
  type SaveMetadata,
  type SessionInfo,
  type SimulationNotification,
  type Speed,
} from '../shared/protocol';
import { realTimers, SimulationClock, type Timers } from './clock';
import { DomainTracker } from './domains';
import { AUTOSAVE_ID, BACKUP_ID, removeDatabaseFiles, SaveLibrary } from './saveLibrary';
import { InvalidRequestError, validateParams } from './validate';
import { createViewBuilders } from './views';
import type { GameStorage } from './storage';
import type { Engine } from '../engine/engine';

// The simulation host: owns the running game — the Engine, its database, the
// clock, the RNG (inside the Engine) — and the save library, and answers the
// renderer's protocol requests (shared/protocol.ts). Knows nothing about
// Electron or how messages travel: the utility-process entry
// (electron/simProcess.ts) and the tests connect to it through
// rpcServer.ts. Single-threaded and synchronous inside: a request or a
// batch of ticks always runs to completion before the next starts, so no
// request ever sees a half-advanced world or an open transaction.

const MINUTES_PER_DAY = 1440;
export const AUTOSAVE_INTERVAL_MS = 60_000;
// How often a file-backed game's safety copy (world.sqlite.backup) is
// refreshed while it changes.
export const BACKUP_INTERVAL_MS = 10 * 60_000;

export interface HostOptions {
  library: SaveLibrary;
  storage: GameStorage;
  timers?: Timers;
  // Wall-clock time for save metadata only — never enters the simulation.
  wallClock?: () => Date;
  autosaveIntervalMs?: number;
  backupIntervalMs?: number;
  log?: (message: string) => void;
}

interface Session {
  engine: Engine;
  api: UiApi;
  views: ReturnType<typeof createViewBuilders>;
  file: string;
  createdAt: string;
  revision: number;
  savedRevision: number;
  backupRevision: number;
  backedUpAt: number;
  tracker: DomainTracker;
  detach: () => void;
}

type Listener = (notification: SimulationNotification) => void;

export class SimulationHost {
  private session: Session | null = null;
  private readonly listeners = new Set<Listener>();
  private readonly clock: SimulationClock;
  private readonly timers: Timers;
  private autosaveHandle: unknown = null;
  private clients = 0;
  private stopped = false;

  private readonly options: HostOptions;

  constructor(options: HostOptions) {
    this.options = options;
    this.timers = options.timers ?? realTimers;
    this.clock = new SimulationClock((ticks) => this.advance(ticks), this.timers);
  }

  get backend(): GameStorage['backend'] {
    return this.options.storage.backend;
  }

  // --- Notifications and connections -------------------------------------

  onNotification(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(notification: SimulationNotification): void {
    for (const listener of this.listeners) listener(notification);
  }

  clientConnected(): void {
    this.clients++;
  }

  // With no window left to show it, the world stops rather than running on
  // unseen; whatever happened is saved.
  clientDisconnected(): void {
    this.clients = Math.max(0, this.clients - 1);
    if (this.clients === 0) {
      this.setSpeed('paused');
      this.persistIfChanged();
    }
  }

  // --- Requests --------------------------------------------------------------

  // Validates and runs one protocol request. Throws InvalidRequestError for
  // a malformed request, an Error with a player-facing message otherwise.
  request(method: string, params: unknown): unknown {
    if (this.stopped) throw new Error('The game is shutting down.');
    if (!isMethodName(method))
      throw new InvalidRequestError(`Unknown request "${String(method).slice(0, 60)}".`);
    return this.dispatch(method, validateParams(method, params));
  }

  private dispatch<M extends MethodName>(method: M, params: ParamsOf<M>): ResultOf<M> {
    const p = params as never;
    const result: unknown = (() => {
      if (method.startsWith('view.')) {
        const views = this.requireSession().views as unknown as Record<string, (params: unknown) => unknown>;
        const build = views[method];
        if (!build) throw new InvalidRequestError(`Unknown view "${method}".`);
        return build(params);
      }
      switch (method) {
        case 'player.queueAction':
          return this.command(
            (api, id) => void api.queueAction(id, (p as ParamsOf<'player.queueAction'>).type),
          );
        case 'player.queueMarketTrade':
          return this.command(
            (api, id) => void api.queueMarketTrade(id, p as ParamsOf<'player.queueMarketTrade'>),
          );
        case 'player.interruptAction':
          return this.command((api, id) => api.interruptAction(id));
        case 'player.applyForJob': {
          const { jobSlotId, haggle } = p as ParamsOf<'player.applyForJob'>;
          return this.command((api, id) => api.applyForJob(id, jobSlotId, haggle));
        }
        case 'player.quitJob':
          return this.command((api, id) => api.quitJob(id));
        case 'player.setRoutinePreferences':
          return this.command((api) =>
            api.setPlayerRoutinePreferences(p as ParamsOf<'player.setRoutinePreferences'>),
          );
        case 'player.equipItem':
          return this.command((api) => api.equipPlayerItem((p as ParamsOf<'player.equipItem'>).itemId));
        case 'player.unequipSlot':
          return this.command((api) => api.unequipPlayerSlot((p as ParamsOf<'player.unequipSlot'>).slot));
        case 'player.foundCompany':
          return this.command((api) => api.foundPlayerCompany(p as ParamsOf<'player.foundCompany'>));
        case 'clock.setSpeed':
          this.requireSession();
          return this.setSpeed((p as ParamsOf<'clock.setSpeed'>).speed);
        case 'clock.skipToMorning':
          return this.skipToMorning();
        case 'clock.skipToActionComplete':
          return this.skipToActionComplete();
        case 'session.get':
          return this.sessionInfo();
        case 'session.newGame':
          return this.newGame(p);
        case 'session.continue':
          return this.continueGame();
        case 'session.load':
          return this.load((p as ParamsOf<'session.load'>).saveId);
        case 'session.close':
          return this.closeSession();
        case 'saves.list':
          return this.listSaves();
        case 'saves.autosave':
          this.requireSession();
          return this.persistIfChanged();
        case 'saves.create': {
          const { name, overwriteId } = p as ParamsOf<'saves.create'>;
          return this.createSave(name, overwriteId);
        }
        case 'saves.delete':
          return this.deleteSave((p as ParamsOf<'saves.delete'>).saveId);
        default:
          throw new InvalidRequestError(`Unknown request "${method}".`);
      }
    })();
    return result as ResultOf<M>;
  }

  private requireSession(): Session {
    if (!this.session) throw new Error('No game is running.');
    return this.session;
  }

  // A player command: atomic (all of it or none of it), committed together
  // with the RNG position it reached, then announced as a change to every
  // domain — commands are rare, and this keeps every screen honest.
  private command<T>(fn: (api: UiApi, playerId: string) => T): T {
    const session = this.requireSession();
    const { engine } = session;
    const result = withSavepoint(engine.db, () => {
      const value = fn(session.api, engine.getPlayerEntityId());
      engine.syncRngState();
      return value;
    });
    session.revision++;
    this.announce(session, 0, { everything: true });
    return result;
  }

  private announce(
    session: Session,
    ticks: number,
    options: { dayBoundary?: boolean; everything?: boolean },
  ) {
    const { domains, events } = session.tracker.take({
      dayBoundary: options.dayBoundary ?? false,
      ...(options.everything ? { everything: true } : {}),
    });
    this.notify({
      type: 'simulation.updated',
      tick: session.engine.tick,
      calendar: session.engine.calendar,
      domains,
      ticks,
      events,
    });
  }

  // --- The clock ---------------------------------------------------------------

  private setSpeed(speed: Speed): void {
    if (speed !== 'paused' && !this.session) return;
    if (speed === this.clock.speed) return;
    this.clock.setSpeed(speed);
    this.notify({ type: 'clock.changed', speed });
  }

  // One batch of ticks: the only way the world moves forward.
  private advance(ticks: number): void {
    const session = this.session;
    if (!session || ticks <= 0) return;
    const before = session.engine.tick;
    try {
      session.engine.advanceTicks(ticks);
    } catch (error) {
      // advanceTicks rolled the whole batch back; the world is as it was.
      this.log(`Tick batch failed at tick ${before}: ${String(error)}`);
      this.clock.stop();
      this.notify({ type: 'clock.changed', speed: 'paused' });
      this.notify({
        type: 'host.error',
        message: `The simulation stopped: ${error instanceof Error ? error.message : String(error)}`,
      });
      throw error;
    }
    const after = session.engine.tick;
    session.revision++;
    this.announce(session, after - before, {
      dayBoundary: Math.floor(before / MINUTES_PER_DAY) !== Math.floor(after / MINUTES_PER_DAY),
    });
  }

  private skipToMorning(): void {
    const session = this.requireSession();
    const { minuteOfDay } = session.engine.calendar;
    this.advance(minuteOfDay === 0 ? MINUTES_PER_DAY : MINUTES_PER_DAY - minuteOfDay);
  }

  private skipToActionComplete(): void {
    const session = this.requireSession();
    const current = session.api.getCurrentAction(session.engine.getPlayerEntityId());
    if (current?.status !== 'in_progress' || current.endsAtTick === null) return;
    this.advance(current.endsAtTick - session.engine.tick);
  }

  // --- Sessions ------------------------------------------------------------------

  sessionInfo(): SessionInfo | null {
    const session = this.session;
    if (!session) return null;
    const { engine } = session;
    const playerId = engine.getPlayerEntityId();
    return {
      playerId,
      playerName: engine.getEntity(playerId)?.name ?? playerId,
      startSeasonIndex: engine.getStartSeasonIndex(),
      tick: engine.tick,
      calendar: engine.calendar,
      speed: this.clock.speed,
      backend: this.backend,
    };
  }

  private startSession(engine: Engine, file: string, createdAt: string): SessionInfo {
    const tracker = new DomainTracker(() => {
      try {
        return engine.getPlayerEntityId();
      } catch {
        return null;
      }
    });
    const session: Session = {
      engine,
      api: createUiApi(engine),
      views: createViewBuilders(engine),
      file,
      createdAt,
      revision: 0,
      savedRevision: 0,
      backupRevision: 0,
      backedUpAt: this.timers.now(),
      tracker,
      detach: engine.bus.subscribe((event) => tracker.observe(event)),
    };
    this.session = session;
    this.scheduleAutosave();
    const info = this.sessionInfo();
    this.notify({ type: 'session.changed', session: info });
    this.notify({ type: 'saves.changed' });
    return info as SessionInfo;
  }

  // Saves and closes the running game, if there is one. Games always begin
  // paused, so the clock stops here too.
  private endSession(): void {
    const session = this.session;
    if (!session) return;
    this.clock.stop();
    this.notify({ type: 'clock.changed', speed: 'paused' });
    this.cancelAutosave();
    session.detach();
    this.session = null;
    try {
      const metadata = this.describe(session.engine, AUTOSAVE_ID, 'autosave', 'Autosave', session.createdAt);
      try {
        this.options.storage.close(session.engine, session.file);
      } catch (error) {
        // Couldn't save (a full disk…): still release the database, so its
        // file isn't left locked. A file-backed game is intact to its last
        // committed batch regardless.
        this.log(`Closing the game failed: ${String(error)}`);
        try {
          session.engine.dispose();
        } catch {
          // already closed
        }
        throw error;
      }
      this.options.library.writeMetadata(metadata);
    } finally {
      this.notify({ type: 'session.changed', session: null });
    }
  }

  private closeSession(): void {
    this.endSession();
    this.notify({ type: 'saves.changed' });
  }

  private newGame(config: ParamsOf<'session.newGame'>): SessionInfo {
    validateNewGameConfig(config);
    return this.installAutosave((incoming) => {
      const { storage } = this.options;
      const engine = storage.create(config, incoming);
      const metadata = this.describe(engine, AUTOSAVE_ID, 'autosave', 'Autosave');
      storage.close(engine, incoming);
      return metadata;
    });
  }

  private load(saveId: string): SessionInfo {
    const { library, storage } = this.options;
    if (!SaveLibrary.isValidId(saveId) || !library.hasWorld(saveId))
      throw new Error('This save is no longer available.');
    if (saveId === AUTOSAVE_ID) {
      // The game in the autosave slot is played where it lies.
      this.endSession();
      const metadata = library.read(AUTOSAVE_ID);
      const file = library.worldFile(AUTOSAVE_ID);
      return this.startSession(this.openAutosave(file), file, metadata?.createdAt ?? this.now());
    }
    const source = library.read(saveId);
    return this.installAutosave((incoming) => {
      copyFileSync(library.worldFile(saveId), incoming);
      const engine = storage.open(incoming);
      const metadata = this.describe(engine, AUTOSAVE_ID, 'autosave', 'Autosave', source?.createdAt);
      storage.close(engine, incoming);
      return metadata;
    });
  }

  // Puts a new game (or a copy of a saved one) into the autosave slot and
  // starts playing it. `prepare` builds and validates it in a side file
  // first, so if that fails nothing else changes; only then is the running
  // game saved and closed and the previous autosave kept as the backup.
  private installAutosave(prepare: (incomingFile: string) => SaveMetadata): SessionInfo {
    const { library, storage } = this.options;
    const dir = library.ensureDir(AUTOSAVE_ID);
    const incoming = path.join(dir, 'world.sqlite.incoming');
    removeDatabaseFiles(incoming);
    let metadata: SaveMetadata;
    try {
      metadata = prepare(incoming);
    } catch (error) {
      removeDatabaseFiles(incoming);
      throw error;
    }
    this.endSession();
    const live = library.worldFile(AUTOSAVE_ID);
    if (existsSync(live)) {
      const previous = library.read(AUTOSAVE_ID);
      removeDatabaseFiles(library.worldFile(BACKUP_ID));
      library.move(AUTOSAVE_ID, BACKUP_ID, {
        ...(previous ?? this.placeholderMetadata()),
        id: BACKUP_ID,
        kind: 'backup',
        displayName: 'Autosave backup',
      });
    }
    removeDatabaseFiles(live);
    // The old life's safety copy must never "recover" the new one.
    removeDatabaseFiles(`${live}.backup`);
    library.ensureDir(AUTOSAVE_ID);
    renameDatabase(incoming, live);
    library.writeMetadata(metadata);
    return this.startSession(storage.open(live), live, metadata.createdAt);
  }

  // Crash/corruption recovery (MigrationPlan.md Phase 24): if the live
  // autosave can't be opened but its periodic safety copy can, the damaged
  // file is set aside (world.sqlite.damaged) and play resumes from the copy.
  private openAutosave(file: string): Engine {
    const { storage } = this.options;
    try {
      return storage.open(file);
    } catch (error) {
      const backup = `${file}.backup`;
      if (!storage.periodicBackups || !existsSync(backup)) throw error;
      this.log(`Autosave failed to open (${String(error)}); restoring its safety copy.`);
      removeDatabaseFiles(`${file}.damaged`);
      renameSync(file, `${file}.damaged`);
      // Its write-ahead log belongs to the damaged file, not the copy.
      removeDatabaseFiles(file);
      copyFileSync(backup, file);
      const engine = storage.open(file);
      this.notify({
        type: 'host.error',
        message:
          'Your autosave was damaged, so the game was restored from its most recent safety copy (up to ten minutes earlier).',
      });
      return engine;
    }
  }

  private continueGame(): SessionInfo {
    for (const save of this.options.library.list()) {
      try {
        return this.load(save.id);
      } catch (error) {
        this.log(`Continue skipped save ${save.id}: ${String(error)}`);
      }
    }
    throw new Error('No compatible local save could be loaded. Use Load Game to import a backup.');
  }

  // --- Saves -------------------------------------------------------------------------

  private listSaves(): SaveListing {
    return { saves: this.options.library.list(), activeSaveId: this.session ? AUTOSAVE_ID : null };
  }

  private createSave(name: string, overwriteId: string | null): SaveMetadata {
    const session = this.requireSession();
    const { library, storage } = this.options;
    const displayName = name.trim();
    if (!displayName) throw new Error('Enter a save name.');
    let createdAt: string | undefined;
    if (overwriteId !== null) {
      const existing = SaveLibrary.isValidId(overwriteId) ? library.read(overwriteId) : null;
      if (existing?.kind !== 'manual') throw new Error('Only manual saves can be overwritten.');
      createdAt = existing.createdAt;
    }
    const id = overwriteId ?? library.newId();
    library.ensureDir(id);
    storage.snapshot(session.engine, library.worldFile(id));
    const metadata = this.describe(session.engine, id, 'manual', displayName, createdAt);
    library.writeMetadata(metadata);
    this.notify({ type: 'saves.changed' });
    return metadata;
  }

  private deleteSave(saveId: string): void {
    if (this.session && saveId === AUTOSAVE_ID)
      throw new Error('This is the game you are playing. Return to the title screen to delete it.');
    this.options.library.remove(saveId);
    this.notify({ type: 'saves.changed' });
  }

  // --- Main-process operations (file dialogs) ---------------------------------------
  //
  // Paths come only from the main process's native dialogs, never from the
  // renderer (MigrationPlan.md Phase 13).

  suggestedExportName(): string {
    const name = this.session ? (this.sessionInfo()?.playerName ?? 'save') : 'save';
    return `wyrnlands-${name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-')}.sqlite`;
  }

  exportTo(file: string): void {
    const session = this.requireSession();
    this.options.storage.snapshot(session.engine, file);
  }

  importFrom(file: string): SaveMetadata {
    const { library, storage } = this.options;
    const id = library.newId();
    const dir = library.ensureDir(id);
    const incoming = path.join(dir, 'world.sqlite.incoming');
    try {
      copyFileSync(file, incoming);
      const engine = storage.open(incoming);
      try {
        storage.snapshot(engine, library.worldFile(id));
        const displayName =
          path
            .basename(file)
            .replace(/\.sqlite$/i, '')
            .slice(0, 100) || 'Imported save';
        const metadata = this.describe(engine, id, 'import', displayName);
        library.writeMetadata(metadata);
        this.notify({ type: 'saves.changed' });
        return metadata;
      } finally {
        engine.dispose();
      }
    } catch (error) {
      library.remove(id);
      throw error;
    } finally {
      removeDatabaseFiles(incoming);
    }
  }

  // Application exit (MigrationPlan.md Phase 23): stop the clock — between
  // batches, since requests and batches never interleave — save, close the
  // database cleanly. Safe to call twice.
  shutdown(): void {
    if (this.stopped) return;
    this.clock.stop();
    this.cancelAutosave();
    try {
      this.endSession();
    } finally {
      this.stopped = true;
    }
  }

  // --- Autosave ------------------------------------------------------------------------

  private scheduleAutosave(): void {
    this.cancelAutosave();
    const interval = this.options.autosaveIntervalMs ?? AUTOSAVE_INTERVAL_MS;
    this.autosaveHandle = this.timers.setTimeout(() => {
      this.autosaveHandle = null;
      this.persistIfChanged();
      this.backupIfDue();
      if (this.session) this.scheduleAutosave();
    }, interval);
  }

  private cancelAutosave(): void {
    if (this.autosaveHandle !== null) this.timers.clearTimeout(this.autosaveHandle);
    this.autosaveHandle = null;
  }

  // Autosave: make the game durable in its file and refresh the save list's
  // metadata, if anything happened since the last time.
  persistIfChanged(): void {
    const session = this.session;
    if (!session || session.revision === session.savedRevision) return;
    try {
      this.options.storage.flush(session.engine, session.file);
      this.options.library.writeMetadata(
        this.describe(session.engine, AUTOSAVE_ID, 'autosave', 'Autosave', session.createdAt),
      );
      session.savedRevision = session.revision;
      this.notify({ type: 'saves.changed' });
    } catch (error) {
      this.log(`Autosave failed: ${String(error)}`);
      this.notify({ type: 'host.error', message: 'Autosave failed. Export a portable copy of your save.' });
    }
  }

  // The safety copy of a file-backed game: a VACUUM INTO snapshot beside the
  // live file, refreshed at most every BACKUP_INTERVAL_MS while the game
  // changes. SQLite's own transactions keep the live file consistent; this
  // guards against what they can't (a damaged disk sector, a power cut on
  // a drive that lies about flushing, a bug that writes nonsense).
  private backupIfDue(): void {
    const session = this.session;
    if (!session || !this.options.storage.periodicBackups || session.revision === session.backupRevision)
      return;
    const interval = this.options.backupIntervalMs ?? BACKUP_INTERVAL_MS;
    if (this.timers.now() - session.backedUpAt < interval) return;
    try {
      this.options.storage.snapshot(session.engine, `${session.file}.backup`);
      session.backupRevision = session.revision;
      session.backedUpAt = this.timers.now();
    } catch (error) {
      this.log(`Safety copy failed: ${String(error)}`);
    }
  }

  // --- Helpers ---------------------------------------------------------------------------

  private now(): string {
    return (this.options.wallClock?.() ?? new Date()).toISOString();
  }

  private describe(
    engine: Engine,
    id: string,
    kind: SaveKind,
    displayName: string,
    createdAt?: string,
  ): SaveMetadata {
    const calendar = engine.calendar;
    const now = this.now();
    return {
      id,
      kind,
      displayName,
      characterName: engine.getEntity(engine.getPlayerEntityId())?.name ?? 'Unknown',
      tick: engine.tick,
      year: calendar.year,
      season: calendar.season,
      day: calendar.day,
      worldSeed: String(queryRow(engine.db, 'SELECT rng_seed FROM world_meta WHERE id = 1')?.[0] ?? ''),
      createdAt: createdAt ?? now,
      updatedAt: now,
      gameVersion: GAME_VERSION,
      saveFormatVersion: SAVE_FORMAT_VERSION,
    };
  }

  private placeholderMetadata(): SaveMetadata {
    const now = this.now();
    return {
      id: BACKUP_ID,
      kind: 'backup',
      displayName: 'Autosave backup',
      characterName: 'Unknown',
      tick: 0,
      year: 1,
      season: 'spring',
      day: 1,
      worldSeed: '',
      createdAt: now,
      updatedAt: now,
      gameVersion: GAME_VERSION,
      saveFormatVersion: SAVE_FORMAT_VERSION,
    };
  }

  private log(message: string): void {
    this.options.log?.(message);
  }
}

// Within one save folder, so the rename is atomic.
function renameDatabase(from: string, to: string): void {
  renameSync(from, to);
}
