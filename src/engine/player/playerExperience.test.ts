import { beforeAll, describe, expect, it } from 'vitest';
import { playerRoutine, registerGameActions } from '../actions/gameActions';
import { inspectConservation } from '../audit/conservationAudit';
import { migrations } from '../db/migrations';
import { createDatabase, queryRow, queryRows, type SqlJsStatic } from '../db/sqlite';
import { loadSqlJs } from '../db/sqlite.node';
import { isBackgroundActor, isPlayerControlled } from '../entities';
import {
  applyHouseholdDailyCadence,
  applyNpcJobSeekingWeeklyCadence,
  applyNpcLaborDailyCadence,
} from '../population/cadence';
import { IMPLEMENTED_SKILLS, MAX_SKILL_LEVEL, getXpForSkillLevel } from '../skills/skills';
import { MINUTES_PER_DAY } from '../time/clock';
import { createUiApi } from '../ui-api';
import { loadGame } from './loadGame';
import { createNewGame, createPlayerCharacter, validateNewGameConfig, type NewGameConfig } from './newGame';
import type { Engine } from '../engine';

let SQL: SqlJsStatic;
beforeAll(async () => {
  SQL = await loadSqlJs();
});
const config = (character: Partial<NewGameConfig['character']> = {}): NewGameConfig => ({
  world: { seed: 'named-player-regression', startSeasonIndex: 0 },
  character: { firstName: 'Edda', lastName: 'Hale', preset: 'standard', ...character },
});
const game = (character: Partial<NewGameConfig['character']> = {}) =>
  createNewGame(createDatabase(SQL), config(character));
const founder = () =>
  game({
    preset: 'custom',
    coin: 2000,
    items: [{ goodType: 'shoes', quantity: 1, equipped: true }],
    skillXp: { management: 800 },
  });
const foundingPlan = {
  businessTypeId: 'logging',
  siteId: 'northwood',
  tenureKind: 'lease' as const,
  companyName: 'Hale Timber',
  positions: 1,
  postedWage: 20,
  investment: 500,
  initialInputUnits: 0,
  founderWorks: true,
};

function logicalState(engine: Engine) {
  engine.export(); // Sync RNG identically for both sides before inspecting world state.
  return Object.fromEntries(
    queryRows(engine.db, "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").map((row) => [
      String(row[0]),
      queryRows(engine.db, `SELECT * FROM "${String(row[0])}" ORDER BY rowid`),
    ]),
  );
}

describe('a named player and a real household', () => {
  it('creates the requested identity, seven zero-level skills, household, purse and shoes', () => {
    const e = game();
    const api = createUiApi(e);
    const p = api.getPlayerProfile();
    expect(p.name).toBe('Edda Hale');
    expect(api.getPlayerEntityId()).toBe(p.id);
    expect(p.householdName).toBe('The Hale Household');
    expect(p.skills.map((s) => s.skill).sort()).toEqual([...IMPLEMENTED_SKILLS].sort());
    expect(p.skills.every((s) => s.xp === 0 && s.level === 0 && s.xpToNextLevel === 200)).toBe(true);
    expect(p.inspect.purse).toBe(100);
    expect(p.inspect.householdCoin).toBe(0);
    expect(p.inspect.gear).toMatchObject([{ slot: 'feet', goodType: 'shoes', durability: 200 }]);
    expect(p.carriedWeightKg).toBe(1);
    expect(p.capacityKg).toBe(20);
    expect(api.getPlayerHome()?.household.homeSiteId).toBe('tavern');
    expect(inspectConservation(e.db, e.tick).passed).toBe(true);
    e.dispose();
  });

  it('gives a winter Standard start the existing half-worn cloak and no extra money', () => {
    const cfg = config();
    cfg.world.startSeasonIndex = 3;
    const e = createNewGame(createDatabase(SQL), cfg);
    expect(e.getPlayerProfile().inspect.gear).toContainEqual(
      expect.objectContaining({ goodType: 'cloak', durability: 150 }),
    );
    expect(e.getBalance(e.getPlayerEntityId())).toBe(100);
    e.dispose();
  });

  it('applies custom resources exactly once and refuses a second character', () => {
    const e = game({
      preset: 'custom',
      coin: 777,
      skillXp: { farming: 350, trading: 0 },
      items: [
        { goodType: 'axe', quantity: 1, durability: 1200 },
        { goodType: 'bread', quantity: 3 },
      ],
    });
    const p = e.getPlayerProfile();
    expect(p.inspect.purse).toBe(777);
    expect(p.inspect.householdCoin).toBe(0);
    expect(p.skills.find((s) => s.skill === 'farming')).toMatchObject({
      xp: 350,
      level: 1,
      xpToNextLevel: 50,
    });
    expect(p.items).toHaveLength(4);
    expect(p.inspect.gear).toHaveLength(0);
    expect(() => createPlayerCharacter(e, config().character)).toThrow('already exists');
    expect(e.getBalance(p.id)).toBe(777);
    expect(inspectConservation(e.db, 0).passed).toBe(true);
    e.dispose();
  });

  it.each(['', '   ', '\nBad', '<name>', 'a'.repeat(61)])(
    'rejects invalid identity %j before seeding',
    (name) => {
      const db = createDatabase(SQL);
      expect(() => createNewGame(db, config({ firstName: name }))).toThrow('first and last name');
      expect(queryRows(db, "SELECT name FROM sqlite_master WHERE type = 'table'")).toHaveLength(0);
      db.close();
    },
  );

  it.each([-1, NaN, Infinity, 0.5, 1000001])('rejects invalid custom coin %j', (coin) => {
    expect(() => validateNewGameConfig(config({ preset: 'custom', coin }))).toThrow('Starting coin');
  });

  it.each([-1, NaN, Infinity, 0.5, getXpForSkillLevel(MAX_SKILL_LEVEL) + 1, 1_000_000])(
    'rejects invalid starting skill XP %j before seeding',
    (xp) => {
      const db = createDatabase(SQL);
      expect(() => createNewGame(db, config({ preset: 'custom', skillXp: { farming: xp } }))).toThrow(
        'Starting skill XP',
      );
      expect(queryRows(db, "SELECT name FROM sqlite_master WHERE type = 'table'")).toHaveLength(0);
      db.close();
    },
  );

  it('creates every selectable skill level, including the maximum, at its XP threshold', () => {
    const e = game({
      preset: 'custom',
      skillXp: Object.fromEntries(
        IMPLEMENTED_SKILLS.map((skill, i) => [skill, getXpForSkillLevel(i % (MAX_SKILL_LEVEL + 1))]),
      ),
    });
    for (const [i, skill] of IMPLEMENTED_SKILLS.entries()) {
      const level = i % (MAX_SKILL_LEVEL + 1);
      expect(e.getPlayerProfile().skills.find((s) => s.skill === skill)).toMatchObject({
        level,
        xp: getXpForSkillLevel(level),
        xpToNextLevel: level === MAX_SKILL_LEVEL ? null : getXpForSkillLevel(1),
      });
    }
    e.dispose();
  });

  it('rejects fake skills, overweight items, invalid quantities and duplicate worn slots', () => {
    expect(() => validateNewGameConfig(config({ preset: 'custom', skillXp: { farming: -1 } }))).toThrow(
      'skill',
    );
    expect(() =>
      validateNewGameConfig(config({ preset: 'custom', items: [{ goodType: 'axe', quantity: 6 }] })),
    ).toThrow('capacity');
    expect(() =>
      validateNewGameConfig(config({ preset: 'custom', items: [{ goodType: 'shoes', quantity: 0 }] })),
    ).toThrow('quantities');
    expect(() =>
      validateNewGameConfig(
        config({
          preset: 'custom',
          items: [
            { goodType: 'shoes', quantity: 1, equipped: true },
            { goodType: 'shoes', quantity: 1, equipped: true },
          ],
        }),
      ),
    ).toThrow('worn slot');
  });

  it('keeps world rolls, NPC identities, employment and the RNG independent of character options', () => {
    const a = game();
    const b = game({
      firstName: 'Chris',
      lastName: 'Barnett',
      preset: 'custom',
      coin: 900,
      skillXp: { farming: 800 },
      items: [],
    });
    for (const table of ['companies', 'market_listings', 'employment', 'traits'])
      expect(queryRows(a.db, `SELECT * FROM ${table}`)).toEqual(queryRows(b.db, `SELECT * FROM ${table}`));
    expect(a.getScenarioRoll()).toBe(b.getScenarioRoll());
    expect(a.listHouseholds().filter((h) => h.id !== 'player-household')).toEqual(
      b.listHouseholds().filter((h) => h.id !== 'player-household'),
    );
    expect(a.nextRandom()).toBe(b.nextRandom());
    a.dispose();
    b.dispose();
  });

  it('uses controlled identity for second-person narration, even with a different entity id', () => {
    const e = game();
    e.createEntity('controlled-person', 'Chris Barnett');
    e.ensureNeeds('controlled-person');
    e.db.run('UPDATE world_meta SET player_entity_id = ?', ['controlled-person']);
    expect(isPlayerControlled(e.db, 'controlled-person')).toBe(true);
    expect(isPlayerControlled(e.db, 'player')).toBe(false);
    e.db.run('UPDATE needs SET thirst = 0.01 WHERE entity_id = ?', ['controlled-person']);
    e.advanceTicks(1);
    expect(
      e.queryActorLog('controlled-person').find((event) => event.type === 'need.collapsed')?.message,
    ).toMatch(/^You collapse/);
    e.createEntity('impostor', 'You');
    expect(isPlayerControlled(e.db, 'impostor')).toBe(false);
    e.dispose();
  });

  it('preserves per-tick player needs while NPC household members remain coarse', () => {
    const e = game();
    e.setAutonomous(e.getPlayerEntityId(), false);
    const npcId = e.listHouseholdMembers('household-0')[0]!;
    const npcNeeds = e.getNeeds(npcId);
    expect(isBackgroundActor(e.db, npcId)).toBe(true);
    expect(isBackgroundActor(e.db, e.getPlayerEntityId())).toBe(false);
    e.advanceTicks(10);
    expect(e.getNeeds(e.getPlayerEntityId())!.thirst).toBeLessThan(100);
    expect(e.getNeeds(npcId)).toEqual(npcNeeds);
    e.dispose();
  });

  it('does not pool the player purse, feed the player, pay a duplicate shift or auto-hire them in NPC cadence', () => {
    const e = game();
    const id = e.getPlayerEntityId();
    const slot = e.listJobOpenings()[0]!;
    applyNpcJobSeekingWeeklyCadence(e.db, e.bus, 7 * MINUTES_PER_DAY, () => 0);
    expect(e.getEmployment(id)).toBeNull();
    e.db.run('UPDATE job_slots SET capacity = capacity + 1 WHERE id = ?', [slot.id]);
    e.applyForJob(id, slot.id, { haggle: false });
    const needs = e.getNeeds(id);
    const xp = e.getSkillXp(id, slot.skill);
    applyNpcLaborDailyCadence(e.db, e.bus, MINUTES_PER_DAY, () => 0);
    applyHouseholdDailyCadence(e.db, e.bus, MINUTES_PER_DAY, false);
    expect(e.getBalance(id)).toBe(100);
    expect(e.getBalance('player-household')).toBe(0);
    expect(e.getNeeds(id)).toEqual(needs);
    expect(e.getSkillXp(id, slot.skill)).toBe(xp);
    e.dispose();
  });

  it('equips and unequips carried gear safely without moving or destroying items', () => {
    const e = game();
    const api = createUiApi(e);
    const shoe = api.getPlayerProfile().items[0]!;
    api.unequipPlayerSlot('feet');
    expect(api.getPlayerProfile().inspect.gear).toHaveLength(0);
    api.equipPlayerItem(shoe.id);
    expect(api.getPlayerProfile().inspect.gear[0]?.itemId).toBe(shoe.id);
    e.produceItem({ id: 'not-yours', type: 'cloak', containerId: 'household-0' });
    expect(() => api.equipPlayerItem('not-yours')).toThrow('you carry');
    expect(inspectConservation(e.db, e.tick).passed).toBe(true);
    e.dispose();
  });

  it('keeps permanent job history after a player quits', () => {
    const e = game();
    const slot = e.listJobOpenings()[0]!;
    e.db.run('UPDATE job_slots SET capacity = capacity + 1 WHERE id = ?', [slot.id]);
    e.applyForJob(e.getPlayerEntityId(), slot.id, { haggle: false });
    e.advanceTicks(1);
    e.quitJob(e.getPlayerEntityId());
    expect(e.getPlayerProfile().jobs[0]).toMatchObject({ companyId: slot.companyId, endedTick: 1 });
    e.dispose();
  });
});

describe('routine settings and strategic decisions', () => {
  it('named household player still works, eats, drinks and sleeps autonomously', () => {
    const e = game();
    const id = e.getPlayerEntityId();
    const slot = e.listJobOpenings().find((s) => s.skill === 'farming')!;
    e.db.run('UPDATE job_slots SET capacity = capacity + 1 WHERE id = ?', [slot.id]);
    e.applyForJob(id, slot.id, { haggle: false });
    e.advanceTicks(5 * MINUTES_PER_DAY);
    const actions = e.getActorActions(id).map((a) => a.type);
    expect(actions).toContain(`work_shift_${slot.id}`);
    expect(actions).toContain('eat');
    expect(actions).toContain('drink');
    expect(actions.some((a) => a === 'sleep_bunk' || a === 'sleep_rough')).toBe(true);
    expect(e.queryActorLog(id, 1000).some((event) => event.type === 'need.collapsed')).toBe(false);
    expect(e.queryActorLog(id, 1000).some((event) => event.message.startsWith('You finish your shift'))).toBe(
      true,
    );
    expect(inspectConservation(e.db, e.tick).passed).toBe(true);
    e.dispose();
  });

  it('disabling all routine options stops automatic choices; emergency recovery remains', () => {
    const e = game();
    e.setPlayerRoutinePreferences({
      ...e.getRoutinePreferences(),
      attendWork: false,
      eatDrink: false,
      maintainProvisions: false,
      sleep: false,
    });
    e.advanceTicks(MINUTES_PER_DAY);
    expect(e.getActorActions(e.getPlayerEntityId()).every((a) => a.type === 'collapse_recovery')).toBe(true);
    e.dispose();
  });

  it('work, food, provisions, sleep, lodging and reserve settings each affect the policy', () => {
    const e = game();
    const id = e.getPlayerEntityId();
    const original = e.getRoutinePreferences();
    e.db.run('UPDATE needs SET thirst = 40 WHERE entity_id = ?', [id]);
    expect(playerRoutine(e, id, null)?.type).toBe('fetch_water');
    e.setPlayerRoutinePreferences({
      ...original,
      eatDrink: false,
      maintainProvisions: false,
      sleep: false,
      attendWork: false,
    });
    expect(playerRoutine(e, id, null)).toBeNull();
    e.db.run('UPDATE needs SET thirst = 100, hunger = 100, energy = 100 WHERE entity_id = ?', [id]);
    e.db.run('UPDATE world_meta SET tick = 600');
    e.setPlayerRoutinePreferences({ ...original, maintainProvisions: true });
    expect(playerRoutine(e, id, null)?.type).toBe('fetch_water');
    e.setPlayerRoutinePreferences({
      ...original,
      maintainProvisions: false,
      eatDrink: false,
      reserveCoin: 100,
    });
    e.db.run('UPDATE world_meta SET tick = 1200');
    e.db.run('UPDATE needs SET energy = 40 WHERE entity_id = ?', [id]);
    expect(playerRoutine(e, id, null)?.type).toBe('sleep_rough');
    e.setPlayerRoutinePreferences({
      ...original,
      maintainProvisions: false,
      eatDrink: false,
      lodging: 'rough',
    });
    expect(playerRoutine(e, id, null)?.type).toBe('sleep_rough');
    e.setPlayerRoutinePreferences({ ...original, maintainProvisions: false, eatDrink: false });
    expect(playerRoutine(e, id, null)?.type).toBe('sleep_bunk');
    e.setPlayerRoutinePreferences({ ...original, maintainProvisions: false, eatDrink: false, sleep: false });
    expect(playerRoutine(e, id, null)).toBeNull();
    e.dispose();
  });

  it('manually queued work takes precedence over every routine choice', () => {
    const e = game();
    e.queueAction(e.getPlayerEntityId(), 'read_notices');
    e.queueAction(e.getPlayerEntityId(), 'rest_rough');
    e.advanceTicks(10);
    expect(e.getCurrentAction(e.getPlayerEntityId())?.type).toBe('rest_rough');
    expect(e.getActorActions(e.getPlayerEntityId()).map((a) => a.type)).toEqual([
      'read_notices',
      'rest_rough',
    ]);
    e.dispose();
  });

  it('rejects invalid routine settings without changing the saved preference', () => {
    const e = game();
    const before = e.getRoutinePreferences();
    expect(() => e.setPlayerRoutinePreferences({ ...before, reserveCoin: NaN })).toThrow('routine');
    expect(e.getRoutinePreferences()).toEqual(before);
    e.dispose();
  });

  it('routine provisions respect the entire coin reserve and pack capacity at purchase time', () => {
    const e = game({
      preset: 'custom',
      coin: 100,
      items: [
        { goodType: 'axe', quantity: 4 },
        { goodType: 'shoes', quantity: 1, equipped: true },
      ],
    });
    const id = e.getPlayerEntityId();
    e.setPlayerRoutinePreferences({ ...e.getRoutinePreferences(), reserveCoin: 80 });
    e.setAutonomous(id, false);
    e.queueAction(id, 'stock_up_bread');
    e.advanceTicks(21);
    expect(e.getBalance(id)).toBeGreaterThanOrEqual(80);
    expect(e.getCarriedWeightKg(id)).toBeLessThanOrEqual(20);
    const bread = e.getPlayerProfile().inspect.inventory.find((i) => i.goodType === 'bread');
    expect(bread?.count).toBe(1);
    expect(inspectConservation(e.db, e.tick).passed).toBe(true);
    e.dispose();
  });

  it('founds through shared transactional records, pays land and tools and becomes an owner-operator', () => {
    const e = founder();
    const quote = e.estimatePlayerBusinessStartup('logging', 'northwood', 'lease', 0)!;
    const result = createUiApi(e).foundPlayerCompany(foundingPlan);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);
    expect(e.getBalance(e.getPlayerEntityId())).toBe(1500);
    expect(e.getBalance(result.companyId)).toBe(500 - quote.total);
    expect(e.getEmployment(e.getPlayerEntityId())?.companyId).toBe(result.companyId);
    expect(e.getCompanyFounding(result.companyId)?.payerId).toBe(e.getPlayerEntityId());
    expect(e.getPlayerProfile().businesses).toContainEqual(
      expect.objectContaining({ role: 'owner', companyId: result.companyId }),
    );
    expect(e.getPlayerHome()?.profile?.businesses.some((b) => b.companyId === result.companyId)).toBe(true);
    expect(e.getOpenSiteTenure('northwood')?.kind).toBe('lease');
    expect(
      queryRow(
        e.db,
        "SELECT COUNT(*) FROM items WHERE container_id = ? AND type = 'axe' AND status = 'active'",
        [result.companyId],
      )?.[0],
    ).toBe(1);
    expect(inspectConservation(e.db, 0).passed).toBe(true);
    e.dispose();
  });

  it('insufficient funds or invalid amounts leave no partial company, tenure or transferred money', () => {
    const e = game();
    const before = logicalState(e);
    expect(e.foundPlayerCompany(foundingPlan).ok).toBe(false);
    expect(logicalState(e)).toEqual(before);
    expect(e.foundPlayerCompany({ ...foundingPlan, positions: 1.5 }).ok).toBe(false);
    expect(e.foundPlayerCompany({ ...foundingPlan, investment: NaN }).ok).toBe(false);
    expect(logicalState(e)).toEqual(before);
    e.dispose();
  });

  it('pays the freehold price and real opening input stock for a bakery', () => {
    const e = founder();
    e.seedMarketListing('market', 'flour', 16, 10);
    const result = e.foundPlayerCompany({
      ...foundingPlan,
      businessTypeId: 'bakery',
      siteId: 'old_bakehouse',
      tenureKind: 'freehold',
      initialInputUnits: 5,
      investment: 1000,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);
    expect(result.outlay.land).toBe(600);
    expect(result.outlay.inputs).toBe(80);
    expect(e.getBalance(result.companyId)).toBe(320);
    expect(
      queryRow(
        e.db,
        "SELECT COUNT(*) FROM items WHERE container_id = ? AND type = 'flour' AND status = 'active'",
        [result.companyId],
      )?.[0],
    ).toBe(5);
    expect(inspectConservation(e.db, 0).passed).toBe(true);
    e.dispose();
  });

  it('refuses a transformation business without its mandatory starting inputs', () => {
    const e = founder();
    const before = logicalState(e);
    expect(
      e.foundPlayerCompany({
        ...foundingPlan,
        businessTypeId: 'bakery',
        siteId: 'old_bakehouse',
        initialInputUnits: 1,
      }).ok,
    ).toBe(false);
    expect(logicalState(e)).toEqual(before);
    e.dispose();
  });

  it('player management does not draw personal funds or alter opening staffing and tier automatically', () => {
    const e = founder();
    const result = e.foundPlayerCompany(foundingPlan);
    if (!result.ok) throw new Error(result.reason);
    e.setPlayerRoutinePreferences({
      ...e.getRoutinePreferences(),
      attendWork: false,
      sleep: false,
      eatDrink: false,
      maintainProvisions: false,
    });
    e.advanceTicks(14 * MINUTES_PER_DAY);
    expect(e.getBalance(e.getPlayerEntityId())).toBe(1500);
    expect(e.getBalance('player-household')).toBe(0);
    expect(e.getCompany(result.companyId)?.tier).toBe(1);
    expect(e.listJobSlotsForCompany(result.companyId)[0]?.capacity).toBe(1);
    expect(e.getCompanyLedgerSummary(result.companyId, 0).ownerDraws).toBe(0);
    expect(e.getCompanyLedgerSummary(result.companyId, 0).ownerContributions).toBe(500);
    expect(inspectConservation(e.db, e.tick).passed).toBe(true);
    e.dispose();
  }, 30_000);
});

describe('SQLite persistence and deterministic continuation', () => {
  it('round-trips all logical state, preferences, ownership, employment, gear, queued trades and founded shifts', () => {
    const e = founder();
    const result = e.foundPlayerCompany(foundingPlan);
    if (!result.ok) throw new Error(result.reason);
    e.setPlayerRoutinePreferences({ ...e.getRoutinePreferences(), lodging: 'rough', reserveCoin: 90 });
    e.queueAction(e.getPlayerEntityId(), `work_shift_${result.companyId}-logging`);
    e.queueMarketTrade(e.getPlayerEntityId(), {
      kind: 'buy',
      siteId: 'market',
      goodType: 'bread',
      quantity: 2,
    });
    e.advanceTicks(50);
    const restored = loadGame(SQL, e.export());
    expect(logicalState(restored)).toEqual(logicalState(e));
    expect(restored.getPlayerProfile()).toEqual(e.getPlayerProfile());
    expect(restored.getPlayerHome()).toEqual(e.getPlayerHome());
    expect(restored.getCurrentAction(restored.getPlayerEntityId())).toEqual(
      e.getCurrentAction(e.getPlayerEntityId()),
    );
    expect(restored.getCurrentAction(restored.getPlayerEntityId())?.startedAtTick).toBe(1);
    e.advanceTicks(3000);
    restored.advanceTicks(3000);
    expect(logicalState(restored)).toEqual(logicalState(e));
    expect(restored.nextRandom()).toBe(e.nextRandom());
    e.dispose();
    restored.dispose();
  });

  it('registration alone never seeds content, and can be repeated without changing saved state', () => {
    const e = game();
    const before = logicalState(e);
    registerGameActions(e);
    registerGameActions(e);
    expect(logicalState(e)).toEqual(before);
    e.dispose();
  });

  it('migrates a schema-22 save and preserves resources and NPC background identity', () => {
    const e = game();
    const id = e.getPlayerEntityId();
    e.setAutonomous(id, false);
    e.export();
    e.db.run('DROP TABLE player_preferences');
    for (const column of ['player_entity_id', 'save_format_version', 'game_version'])
      e.db.run(`ALTER TABLE world_meta DROP COLUMN ${column}`);
    e.db.run('DROP INDEX idx_entities_simulation_mode');
    e.db.run('ALTER TABLE entities DROP COLUMN simulation_mode');
    e.db.run("DELETE FROM schema_migrations WHERE id = '0023_player_experience'");
    const restored = loadGame(SQL, e.export());
    expect(restored.getPlayerProfile().name).toBe('Edda Hale');
    expect(restored.getBalance(id)).toBe(100);
    expect(isBackgroundActor(restored.db, id)).toBe(false);
    expect(isBackgroundActor(restored.db, 'npc-0')).toBe(true);
    expect(restored.isAutonomous(id)).toBe(false);
    // Every migration applied (0023 after any later ones, since the legacy save lacked it).
    expect(queryRows(restored.db, 'SELECT id FROM schema_migrations ORDER BY id').map((r) => r[0])).toEqual(
      migrations.map((m) => m.id).sort(),
    );
    expect(inspectConservation(restored.db, 0).passed).toBe(true);
    e.dispose();
    restored.dispose();
  });

  it.each([new Uint8Array(), new TextEncoder().encode('not a game'), new Uint8Array(100)])(
    'rejects non-SQLite data gracefully',
    (bytes) => {
      expect(() => loadGame(SQL, bytes)).toThrow('not a SQLite game save');
    },
  );

  it('rejects an unrelated SQLite DB without creating a world in it', () => {
    const db = createDatabase(SQL);
    db.run('CREATE TABLE unrelated (id TEXT)');
    expect(() => loadGame(SQL, db.export())).toThrow('not a compatible Wyrnlands save');
    db.close();
  });

  it('rejects future schema, future format, invalid world data, and conservation drift', () => {
    const e = game();
    e.db.run("INSERT INTO schema_migrations VALUES ('9999_future')");
    expect(() => loadGame(SQL, e.export())).toThrow('newer schema');
    e.db.run("DELETE FROM schema_migrations WHERE id = '9999_future'");
    e.db.run('UPDATE world_meta SET save_format_version = 2');
    expect(() => loadGame(SQL, e.export())).toThrow('unsupported format');
    e.db.run('UPDATE world_meta SET save_format_version = 1, tick = -1');
    expect(() => loadGame(SQL, e.export())).toThrow('invalid world data');
    e.db.run('UPDATE world_meta SET tick = 0');
    e.db.run('UPDATE wallets SET balance = balance + 1 WHERE owner_id = ?', [e.getPlayerEntityId()]);
    expect(() => loadGame(SQL, e.export())).toThrow('integrity');
    e.dispose();
  });
});
