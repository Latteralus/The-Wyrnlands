import { registerGameActions } from '../actions/gameActions';
import { withSavepoint } from '../db/sqlite';
import { Engine } from '../engine';
import { setSimulationMode } from '../entities';
import { getGoodDefinition } from '../goods/catalog';
import { PERSONAL_CARRY_CAPACITY_KG } from '../inventory/capacity';
import { createWorld } from '../seed/demoWorld';
import { IMPLEMENTED_SKILLS } from '../skills/skills';
import { DEFAULT_ROUTINE, setRoutinePreferences } from './preferences';
import type { Database } from 'sql.js';

export interface StartingItem {
  goodType: string;
  quantity: number;
  durability?: number;
  equipped?: boolean;
}

export interface NewGameConfig {
  world: { seed: string; startSeasonIndex?: number };
  character: {
    firstName: string;
    lastName: string;
    preset: 'standard' | 'custom';
    coin?: number;
    skillXp?: Partial<Record<(typeof IMPLEMENTED_SKILLS)[number], number>>;
    items?: StartingItem[];
  };
}

export function validateNewGameConfig(config: NewGameConfig): void {
  for (const name of [config.character.firstName, config.character.lastName]) {
    if (!name.trim() || name.trim().length > 60 || /[\p{Cc}\p{Cf}<>]/u.test(name))
      throw new Error('Enter a first and last name, each between 1 and 60 characters.');
  }
  if (!config.world.seed.trim() || config.world.seed.length > 200)
    throw new Error('Enter a world seed between 1 and 200 characters.');
  if (!['standard', 'custom'].includes(config.character.preset)) throw new Error('Choose a starting preset.');
  if (
    config.world.startSeasonIndex !== undefined &&
    (!Number.isInteger(config.world.startSeasonIndex) ||
      config.world.startSeasonIndex < 0 ||
      config.world.startSeasonIndex > 3)
  )
    throw new Error('Choose a valid starting season.');
  if (config.character.preset === 'standard') return;
  const coin = config.character.coin ?? 100;
  if (!Number.isSafeInteger(coin) || coin < 0 || coin > 1_000_000)
    throw new Error('Starting coin must be a whole number between 0 and 1,000,000.');
  for (const [skill, xp] of Object.entries(config.character.skillXp ?? {})) {
    if (!IMPLEMENTED_SKILLS.some((s) => s === skill) || !Number.isSafeInteger(xp) || xp < 0 || xp > 1_000_000)
      throw new Error('Choose an implemented skill and whole XP between 0 and 1,000,000.');
  }
  let weight = 0;
  const slots = new Set<string>();
  for (const item of config.character.items ?? []) {
    const def = getGoodDefinition(item.goodType);
    if (!Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 100)
      throw new Error('Item quantities must be whole numbers between 1 and 100.');
    if (
      item.durability !== undefined &&
      (!def.maxDurability ||
        !Number.isSafeInteger(item.durability) ||
        item.durability < 1 ||
        item.durability > def.maxDurability)
    )
      throw new Error('Choose valid item durability.');
    if (item.equipped) {
      if (!def.slot || item.quantity !== 1 || slots.has(def.slot))
        throw new Error('Choose one garment per worn slot.');
      slots.add(def.slot);
    }
    weight += def.weightKg * item.quantity;
  }
  if (weight > PERSONAL_CARRY_CAPACITY_KG) throw new Error('Starting items exceed the 20 kg carry capacity.');
}

export function createPlayerCharacter(engine: Engine, character: NewGameConfig['character']): void {
  validateNewGameConfig({ world: { seed: 'character-validation' }, character });
  const id = 'player';
  if (engine.getEntity(id)) throw new Error('A player character already exists.');
  withSavepoint(engine.db, () => {
    engine.createEntity(id, `${character.firstName.trim()} ${character.lastName.trim()}`);
    engine.db.run('UPDATE world_meta SET player_entity_id = ? WHERE id = 1', [id]);
    setSimulationMode(engine.db, id, 'foreground');
    engine.ensureNeeds(id);
    engine.ensureWallet(id);
    const coin = character.preset === 'standard' ? 100 : (character.coin ?? 100);
    if (coin > 0) engine.faucetCoin(id, coin, `You arrive with ${coin} coin saved for your new life.`);
    for (const skill of IMPLEMENTED_SKILLS) {
      engine.ensureSkill(id, skill);
      if (character.preset === 'custom') {
        const xp = character.skillXp?.[skill] ?? 0;
        if (xp > 0) engine.addSkillXp(id, skill, xp);
      }
    }
    engine.createHousehold({
      id: 'player-household',
      name: `The ${character.lastName.trim()} Household`,
      homeSiteId: 'tavern',
    });
    engine.addHouseholdMember('player-household', id, 'foreground');
    setRoutinePreferences(engine.db, id, DEFAULT_ROUTINE);
    const standardItems: StartingItem[] = [{ goodType: 'shoes', quantity: 1, equipped: true }];
    if (engine.calendar.season === 'winter')
      standardItems.push({ goodType: 'cloak', quantity: 1, durability: 150, equipped: true });
    const items = character.preset === 'standard' ? standardItems : (character.items ?? standardItems);
    let sequence = 0;
    for (const item of items) {
      for (let n = 0; n < item.quantity; n++) {
        const itemId = `${id}-starting-${sequence++}`;
        const durability = item.durability ?? getGoodDefinition(item.goodType).maxDurability;
        engine.produceItem({
          id: itemId,
          type: item.goodType,
          containerId: id,
          ...(durability === undefined ? {} : { durability }),
          note: 'Your belongings on arrival.',
        });
        if (item.equipped) engine.equipItem(id, itemId);
      }
    }
    engine.setAutonomous(id, true);
  });
}

export function createNewGame(db: Database, config: NewGameConfig): Engine {
  validateNewGameConfig(config);
  const engine = Engine.bootstrap(db, { seed: config.world.seed });
  try {
    withSavepoint(db, () => {
      if (engine.getSite('well') || engine.getEntity(engine.getPlayerEntityId()))
        throw new Error('New game requires an empty world.');
      createWorld(engine, config.world);
      createPlayerCharacter(engine, config.character);
    });
    registerGameActions(engine);
    return engine;
  } catch (error) {
    engine.dispose();
    throw error;
  }
}
