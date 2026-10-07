import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase } from '../engine/db/sqlite';
import { isNativeSqliteAvailable, NativeDatabase } from '../engine/db/sqlite.native';
import { loadSqlJs } from '../engine/db/sqlite.node';
import { canonicalState } from '../engine/perf/benchmark';
import { loadGame, openGame } from '../engine/player/loadGame';
import { createNewGame } from '../engine/player/newGame';
import { BASE_TICKS_PER_BATCH, BATCH_INTERVAL_MS } from './clock';
import { AUTOSAVE_ID, BACKUP_ID } from './saveLibrary';
import { AUTOSAVE_INTERVAL_MS } from './simulationHost';
import { NativeStorage } from './storage';
import { createTestHost, NEW_GAME, settle, sqlJsStorage, type TestHost } from './testing/testHost';
import type { GameStorage } from './storage';
import type { SimulationNotification } from '../shared/protocol';

const MINUTES_PER_DAY = 1440;

// Every host test runs on each storage backend this runtime supports:
// sql.js everywhere; native SQLite under Node 22.16+/24 (npm run test:native
// runs the suite on Electron's own Node).
const BACKENDS: { name: string; storage: () => Promise<GameStorage> }[] = [
  { name: 'sql.js', storage: sqlJsStorage },
  ...(isNativeSqliteAvailable()
    ? [{ name: 'native SQLite', storage: () => Promise.resolve<GameStorage>(new NativeStorage()) }]
    : []),
];
let hosts: TestHost[] = [];
const track = (host: TestHost) => (hosts.push(host), host);
afterEach(() => {
  for (const host of hosts.reverse()) host.dispose();
  hosts = [];
});

async function savedState(file: string): Promise<string> {
  const engine = loadGame(await loadSqlJs(), new Uint8Array(readFileSync(file)));
  try {
    return canonicalState(engine);
  } finally {
    engine.dispose();
  }
}

const updates = (notifications: SimulationNotification[]) =>
  notifications.filter(
    (n): n is Extract<SimulationNotification, { type: 'simulation.updated' }> =>
      n.type === 'simulation.updated',
  );

describe.each(BACKENDS)('simulation host ($name) — sessions, views and commands', ({ storage }) => {
  it('creates a new game through the host and serves its views', async () => {
    const t = track(await createTestHost({ storage: await storage() }));
    const c = t.connect();
    expect(await c.request('session.get')).toBeNull();
    const session = await c.request('session.newGame', NEW_GAME);
    expect(session).toMatchObject({
      playerName: 'Edda Hale',
      tick: 0,
      speed: 'paused',
      backend: t.host.backend,
    });
    const hud = await c.request('view.hud');
    expect(hud.balance).toBe(100);
    expect(hud.needs).not.toBeNull();
    const settlement = await c.request('view.settlement');
    expect(settlement.sites.some((s) => s.id === 'market')).toBe(true);
    expect(settlement.households.length).toBeGreaterThan(10);
    const character = await c.request('view.character');
    expect(character.profile.name).toBe('Edda Hale');
    expect((await c.request('view.location', { siteId: 'market' }))?.site.kind).toBe('market');
    expect(await c.request('view.location', { siteId: 'nowhere' })).toBeNull();
    expect((await c.request('view.market', { siteId: 'market' })).overview.goods.length).toBeGreaterThan(0);
    expect(await c.request('view.person', { entityId: 'nobody' })).toBeNull();
  });

  it('applies player commands to the running world and announces them', async () => {
    const t = track(await createTestHost({ storage: await storage() }));
    const c = t.connect();
    await c.request('session.newGame', NEW_GAME);
    const jobs = await c.request('view.jobs');
    const opening = jobs.openings.find((o) => o.vacancies > 0);
    expect(opening).toBeDefined();
    const result = await c.request('player.applyForJob', { jobSlotId: opening?.id ?? '', haggle: false });
    expect(result.message).toBeTruthy();
    expect((await c.request('view.jobs')).employment?.jobSlotId).toBe(opening?.id);
    await settle();
    const last = updates(c.notifications).at(-1);
    expect(last?.domains).toEqual(['clock', 'player', 'market', 'world', 'logs']);

    const prefs = (await c.request('view.character')).routine;
    await c.request('player.setRoutinePreferences', { ...prefs, lodging: 'rough', reserveCoin: 25 });
    expect((await c.request('view.home'))?.routine).toMatchObject({ lodging: 'rough', reserveCoin: 25 });
    await expect(c.request('player.setRoutinePreferences', { ...prefs, reserveCoin: -5 })).rejects.toThrow(
      'Choose valid routine settings',
    );

    await c.request('player.queueAction', { type: 'draw_water' });
    expect((await c.request('view.hud')).activeActions[0]?.type).toBe('draw_water');
    await c.request('player.interruptAction');
    await expect(c.request('player.queueAction', { type: 'no_such_action' })).rejects.toThrow();
  });

  it('refuses malformed and unknown requests before they reach the engine', async () => {
    const t = track(await createTestHost({ storage: await storage() }));
    const c = t.connect();
    await expect(c.request('view.hud')).rejects.toThrow('No game is running.');
    await c.request('session.newGame', NEW_GAME);
    const raw = (method: string, params: unknown) =>
      (c.request as (method: string, params: unknown) => Promise<unknown>)(method, params);
    await expect(raw('db.exec', { sql: 'DROP TABLE items' })).rejects.toMatchObject({ code: 'invalid' });
    await expect(raw('view.log', { scope: 'secret', limit: 5 })).rejects.toMatchObject({ code: 'invalid' });
    await expect(raw('view.log', { scope: 'personal', limit: 1e9 })).rejects.toMatchObject({
      code: 'invalid',
    });
    await expect(raw('clock.setSpeed', { speed: 1000 })).rejects.toMatchObject({ code: 'invalid' });
    await expect(raw('player.equipItem', { itemId: 42 })).rejects.toMatchObject({ code: 'invalid' });
    await expect(raw('session.load', { saveId: '../../etc' })).rejects.toThrow(
      'This save is no longer available.',
    );
    await expect(raw('saves.delete', { saveId: '..' })).rejects.toThrow('No such save.');
    // The world is untouched by all of it.
    expect((await c.request('view.hud')).tick).toBe(0);
  });
});

describe.each(BACKENDS)('simulation host ($name) — the clock', ({ storage }) => {
  it('advances in batches at the chosen speed, pauses, and skips', async () => {
    const t = track(await createTestHost({ storage: await storage() }));
    const c = t.connect();
    await c.request('session.newGame', NEW_GAME);
    await c.request('clock.setSpeed', { speed: 16 });
    t.timers.advance(BATCH_INTERVAL_MS * 3);
    expect((await c.request('view.hud')).tick).toBe(3 * 16 * BASE_TICKS_PER_BATCH);
    await c.request('clock.setSpeed', { speed: 4 });
    t.timers.advance(BATCH_INTERVAL_MS * 2);
    expect((await c.request('view.hud')).tick).toBe(3 * 80 + 2 * 20);
    await c.request('clock.setSpeed', { speed: 'paused' });
    t.timers.advance(BATCH_INTERVAL_MS * 10);
    expect((await c.request('view.hud')).tick).toBe(280);
    await c.request('clock.skipToMorning');
    expect((await c.request('view.hud')).tick).toBe(MINUTES_PER_DAY);
    await settle();
    const ticks = updates(c.notifications);
    expect(ticks.map((n) => n.ticks)).toEqual([80, 80, 80, 20, 20, MINUTES_PER_DAY - 280]);
    // Within a day only the clock and the player's own state move; crossing
    // midnight runs the economy and invalidates everything.
    expect(ticks[0]?.domains).toEqual(expect.arrayContaining(['clock', 'player']));
    expect(ticks.at(-1)?.domains).toEqual(['clock', 'player', 'market', 'world', 'logs']);
    expect(
      c.notifications
        .filter((n) => n.type === 'clock.changed')
        .map((n) => n.type === 'clock.changed' && n.speed),
    ).toEqual([16, 4, 'paused']);
  });

  it('skips to the end of the current action', async () => {
    const t = track(await createTestHost({ storage: await storage() }));
    const c = t.connect();
    await c.request('session.newGame', NEW_GAME);
    await c.request('player.queueAction', { type: 'rest_rough' });
    await c.request('clock.setSpeed', { speed: 1 });
    t.timers.advance(BATCH_INTERVAL_MS);
    await c.request('clock.setSpeed', { speed: 'paused' });
    const action = (await c.request('view.hud')).activeActions[0];
    expect(action?.status).toBe('in_progress');
    await c.request('clock.skipToActionComplete');
    expect((await c.request('view.hud')).tick).toBe(action?.endsAtTick);
  });

  it('keeps the world intact across a renderer disconnect and reconnect', async () => {
    const t = track(await createTestHost({ storage: await storage() }));
    const first = t.connect();
    await first.request('session.newGame', NEW_GAME);
    await first.request('clock.setSpeed', { speed: 16 });
    t.timers.advance(BATCH_INTERVAL_MS * 5);
    first.close();
    await settle();
    // Nobody watching: the clock stopped and the game was saved.
    t.timers.advance(BATCH_INTERVAL_MS * 20);
    const second = t.connect();
    const session = await second.request('session.get');
    expect(session).toMatchObject({ tick: 400, speed: 'paused', playerName: 'Edda Hale' });
    expect(t.library.read(AUTOSAVE_ID)?.tick).toBe(400);
    await second.request('clock.setSpeed', { speed: 16 });
    t.timers.advance(BATCH_INTERVAL_MS);
    expect((await second.request('view.hud')).tick).toBe(480);
  });
});

describe.each(BACKENDS)('simulation host ($name) — determinism', ({ storage }) => {
  it('runs exactly the world a headless engine runs, however the ticks are batched', async () => {
    const SQL = await loadSqlJs();
    const t = track(await createTestHost({ storage: await storage() }));
    const c = t.connect();
    await c.request('session.newGame', NEW_GAME);
    const slot = (await c.request('view.jobs')).openings.find((o) => o.vacancies > 0)?.id ?? '';
    await c.request('player.applyForJob', { jobSlotId: slot, haggle: true });
    await c.request('clock.setSpeed', { speed: 16 });
    t.timers.advance(BATCH_INTERVAL_MS * 7); // 560 ticks in 7 batches
    await c.request('clock.setSpeed', { speed: 'paused' });
    await c.request('clock.skipToMorning'); // to 1440 in one batch
    await c.request('clock.setSpeed', { speed: 4 });
    t.timers.advance(BATCH_INTERVAL_MS * 9); // + 180
    await c.request('clock.setSpeed', { speed: 'paused' });
    await c.request('clock.skipToMorning'); // to 2880
    await c.request('session.close');

    const headless = createNewGame(createDatabase(SQL), NEW_GAME);
    headless.applyForJob(headless.getPlayerEntityId(), slot, { haggle: true });
    for (let i = 0; i < 560; i += 37) headless.advanceTicks(Math.min(37, 560 - i)); // different batches
    for (let i = 0; i < 2 * MINUTES_PER_DAY - 560; i++) headless.advanceTicks(1); // one tick at a time
    expect(headless.tick).toBe(2 * MINUTES_PER_DAY);
    const expected = canonicalState(headless);
    headless.dispose();
    expect(await savedState(t.library.worldFile(AUTOSAVE_ID))).toBe(expected);
  });

  it('resumes the RNG exactly after save and reload', async () => {
    const t = track(await createTestHost({ storage: await storage() }));
    const c = t.connect();
    await c.request('session.newGame', { ...NEW_GAME, world: { seed: 'rng-resume' } });
    await c.request('clock.skipToMorning');
    const manual = await c.request('saves.create', { name: 'Checkpoint', overwriteId: null });
    await c.request('clock.skipToMorning');
    await c.request('clock.skipToMorning');
    await c.request('session.close');
    const continued = await savedState(t.library.worldFile(AUTOSAVE_ID));

    await c.request('session.load', { saveId: manual.id });
    expect((await c.request('session.get'))?.tick).toBe(MINUTES_PER_DAY);
    await c.request('clock.skipToMorning');
    await c.request('clock.skipToMorning');
    await c.request('session.close');
    expect(await savedState(t.library.worldFile(AUTOSAVE_ID))).toBe(continued);
  });
});

describe.each(BACKENDS)('simulation host ($name) — saves', ({ storage }) => {
  it('persists the game to a real file and restores it in a fresh host', async () => {
    const t = track(await createTestHost({ storage: await storage() }));
    const c = t.connect();
    await c.request('session.newGame', NEW_GAME);
    const slot = (await c.request('view.jobs')).openings.find((o) => o.vacancies > 0)?.id ?? '';
    await c.request('player.applyForJob', { jobSlotId: slot, haggle: false });
    await c.request('clock.skipToMorning');
    const before = await c.request('view.character');
    // Application exit.
    t.host.shutdown();
    expect(existsSync(t.library.worldFile(AUTOSAVE_ID))).toBe(true);
    await expect(c.request('session.get')).rejects.toThrow('shutting down');

    const restarted = track(await createTestHost({ dir: t.dir, storage: await storage() }));
    const d = restarted.connect();
    const session = await d.request('session.continue');
    expect(session.tick).toBe(MINUTES_PER_DAY);
    const after = await d.request('view.character');
    expect(after.profile.jobs).toEqual(before.profile.jobs);
    expect(after.profile.inspect.purse).toBe(before.profile.inspect.purse);
    expect((await d.request('view.jobs')).employment?.jobSlotId).toBe(slot);
  });

  it('autosaves on a timer only when something changed', async () => {
    const t = track(await createTestHost({ storage: await storage() }));
    const c = t.connect();
    await c.request('session.newGame', NEW_GAME);
    const created = t.library.read(AUTOSAVE_ID);
    expect(created?.tick).toBe(0);
    await c.request('clock.setSpeed', { speed: 16 });
    t.timers.advance(BATCH_INTERVAL_MS * 4);
    await c.request('clock.setSpeed', { speed: 'paused' });
    t.timers.advance(AUTOSAVE_INTERVAL_MS);
    const autosaved = t.library.read(AUTOSAVE_ID);
    expect(autosaved?.tick).toBe(320);
    t.timers.advance(AUTOSAVE_INTERVAL_MS);
    expect(t.library.read(AUTOSAVE_ID)?.updatedAt).toBe(autosaved?.updatedAt);
    // Paused changes count as changes, too.
    await c.request('player.unequipSlot', { slot: 'feet' });
    t.timers.advance(AUTOSAVE_INTERVAL_MS);
    expect(t.library.read(AUTOSAVE_ID)?.updatedAt).not.toBe(autosaved?.updatedAt);
  });

  it('creates, overwrites, lists and deletes manual saves', async () => {
    const t = track(await createTestHost({ storage: await storage() }));
    const c = t.connect();
    await c.request('session.newGame', NEW_GAME);
    const save = await c.request('saves.create', { name: '  First  ', overwriteId: null });
    expect(save).toMatchObject({ kind: 'manual', displayName: 'First', tick: 0, characterName: 'Edda Hale' });
    await c.request('clock.skipToMorning');
    const overwritten = await c.request('saves.create', { name: 'First', overwriteId: save.id });
    expect(overwritten).toMatchObject({ id: save.id, tick: MINUTES_PER_DAY, createdAt: save.createdAt });
    await expect(c.request('saves.create', { name: 'x', overwriteId: AUTOSAVE_ID })).rejects.toThrow(
      'Only manual saves can be overwritten.',
    );
    await expect(c.request('saves.create', { name: '   ', overwriteId: null })).rejects.toThrow(
      'Enter a save name.',
    );
    const listing = await c.request('saves.list');
    expect(listing.activeSaveId).toBe(AUTOSAVE_ID);
    expect(listing.saves.map((s) => s.id).sort()).toEqual([AUTOSAVE_ID, save.id].sort());
    // The autosave the game is running in can't be deleted under it.
    await expect(c.request('saves.delete', { saveId: AUTOSAVE_ID })).rejects.toThrow(
      'the game you are playing',
    );
    await c.request('saves.delete', { saveId: save.id });
    expect((await c.request('saves.list')).saves.map((s) => s.id)).toEqual([AUTOSAVE_ID]);
  });

  it('keeps the replaced autosave as a loadable backup', async () => {
    const t = track(await createTestHost({ storage: await storage() }));
    const c = t.connect();
    await c.request('session.newGame', NEW_GAME);
    await c.request('clock.skipToMorning');
    await c.request('session.newGame', {
      world: { seed: 'second-life' },
      character: { firstName: 'Bram', lastName: 'Cotter', preset: 'standard' },
    });
    const backup = t.library.read(BACKUP_ID);
    expect(backup).toMatchObject({ kind: 'backup', characterName: 'Edda Hale', tick: MINUTES_PER_DAY });
    const restored = await c.request('session.load', { saveId: BACKUP_ID });
    expect(restored).toMatchObject({ playerName: 'Edda Hale', tick: MINUTES_PER_DAY });
    // …and Bram's life became the backup in turn.
    expect(t.library.read(BACKUP_ID)?.characterName).toBe('Bram Cotter');
  });

  it('exports a portable file and imports it as a new save', async () => {
    const t = track(await createTestHost({ storage: await storage() }));
    const c = t.connect();
    await c.request('session.newGame', NEW_GAME);
    await c.request('clock.skipToMorning');
    expect(t.host.suggestedExportName()).toBe('wyrnlands-edda-hale.sqlite');
    const exported = path.join(t.dir, 'exported.sqlite');
    t.host.exportTo(exported);
    expect(readFileSync(exported).subarray(0, 16).toString('latin1')).toBe('SQLite format 3\0');
    const imported = t.host.importFrom(exported);
    expect(imported).toMatchObject({ kind: 'import', displayName: 'exported', tick: MINUTES_PER_DAY });
    const expected = await savedState(exported);
    await c.request('session.load', { saveId: imported.id });
    await c.request('session.close');
    expect(await savedState(t.library.worldFile(AUTOSAVE_ID))).toBe(expected);
  });

  it('rejects damaged and foreign files gracefully, leaving the library intact', async () => {
    const t = track(await createTestHost({ storage: await storage() }));
    const c = t.connect();
    await c.request('session.newGame', NEW_GAME);
    const junk = path.join(t.dir, 'junk.sqlite');
    writeFileSync(junk, 'not a database at all');
    expect(() => t.host.importFrom(junk)).toThrow('This file is not a SQLite game save.');
    const truncated = path.join(t.dir, 'truncated.sqlite');
    t.host.exportTo(truncated);
    writeFileSync(truncated, readFileSync(truncated).subarray(0, 5000));
    expect(() => t.host.importFrom(truncated)).toThrow(/damaged|not a compatible/);
    expect((await c.request('saves.list')).saves.map((s) => s.id)).toEqual([AUTOSAVE_ID]);

    // A save folder with a corrupt world: Continue skips it for the next good one.
    const good = await c.request('saves.create', { name: 'Good', overwriteId: null });
    await c.request('session.close');
    writeFileSync(t.library.worldFile(AUTOSAVE_ID), 'corrupted');
    const resumed = await c.request('session.continue');
    expect(resumed.playerName).toBe('Edda Hale');
    expect(t.library.read(AUTOSAVE_ID)?.displayName).toBe('Autosave');
    expect(good.id).not.toBe(AUTOSAVE_ID);

    // Folders without valid metadata are not saves.
    mkdirSync(path.join(t.library.root, 'stray'), { recursive: true });
    writeFileSync(path.join(t.library.root, 'stray', 'metadata.json'), '{ nope');
    expect((await c.request('saves.list')).saves.every((s) => s.id !== 'stray')).toBe(true);
  });
});

describe.each(BACKENDS)('simulation host ($name) — IPC payloads', ({ storage }) => {
  it('keeps per-update traffic small and sends views whole', async () => {
    const t = track(await createTestHost({ storage: await storage() }));
    const c = t.connect();
    await c.request('session.newGame', NEW_GAME);
    await settle();
    c.traffic.toClient.length = 0;
    await c.request('clock.setSpeed', { speed: 16 });
    t.timers.advance(BATCH_INTERVAL_MS * 10);
    await settle();
    const notificationBytes = c.traffic.toClient.slice(1); // after the setSpeed response
    expect(Math.max(...notificationBytes)).toBeLessThan(400);
    c.traffic.toClient.length = 0;
    await c.request('view.settlement');
    expect(c.traffic.toClient).toHaveLength(1); // one message for the whole screen
  });
});

describe.skipIf(!isNativeSqliteAvailable())('simulation host (native SQLite) — crash safety', () => {
  it('keeps a periodic safety copy and recovers from it when the live save is damaged', async () => {
    const t = track(await createTestHost({ storage: new NativeStorage(), backupIntervalMs: 1 }));
    const c = t.connect();
    await c.request('session.newGame', NEW_GAME);
    await c.request('clock.skipToMorning');
    t.timers.advance(AUTOSAVE_INTERVAL_MS); // autosave + safety copy
    const live = t.library.worldFile(AUTOSAVE_ID);
    expect(existsSync(`${live}.backup`)).toBe(true);
    await c.request('clock.skipToMorning'); // newer than the copy
    await c.request('session.close');
    writeFileSync(live, readFileSync(live).subarray(0, 8192)); // the disk mangled it

    const resumed = await c.request('session.continue');
    expect(resumed.tick).toBe(MINUTES_PER_DAY); // as of the safety copy
    expect(existsSync(`${live}.damaged`)).toBe(true);
    await settle();
    expect(
      c.notifications.some(
        (n) => n.type === 'host.error' && /restored from its most recent safety copy/.test(n.message),
      ),
    ).toBe(true);
  });

  it('commits every batch, so even an unclean exit leaves the save current to its last batch', async () => {
    const t = track(await createTestHost({ storage: new NativeStorage() }));
    const c = t.connect();
    await c.request('session.newGame', NEW_GAME);
    await c.request('clock.setSpeed', { speed: 16 });
    t.timers.advance(BATCH_INTERVAL_MS * 6);
    // No shutdown, no autosave: read the live file as another process would.
    const engine = openGame(new NativeDatabase(t.library.worldFile(AUTOSAVE_ID), { durable: true }));
    expect(engine.tick).toBe(6 * 80);
    engine.dispose();
  });
});
