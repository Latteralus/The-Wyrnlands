import { SPEEDS, type MethodName, type ParamsOf, type Speed } from '../shared/protocol';

// Shape checks for everything the renderer sends, run in the simulation
// process before any engine code sees it. The renderer is treated as
// untrusted input: these reject wrong types, unknown keys' worth of junk,
// absurd sizes and unknown enum values. Game rules (can you afford it, is
// the job still open…) stay the engine's own checks.

export class InvalidRequestError extends Error {}

type Record_ = Record<string, unknown>;

function fail(message: string): never {
  throw new InvalidRequestError(message);
}

function object(value: unknown, what = 'parameters'): Record_ {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(`Expected ${what} object.`);
  return value as Record_;
}

function string(value: unknown, name: string, maxLength = 200): string {
  if (typeof value !== 'string' || value.length > maxLength) fail(`${name} must be a string.`);
  return value;
}

function integer(value: unknown, name: string, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max)
    fail(`${name} must be a whole number between ${min} and ${max}.`);
  return value as number;
}

function boolean(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') fail(`${name} must be true or false.`);
  return value;
}

function oneOf<T extends string>(value: unknown, name: string, options: readonly T[]): T {
  if (!options.includes(value as T)) fail(`${name} must be one of ${options.join(', ')}.`);
  return value as T;
}

function none(params: unknown): void {
  if (params !== undefined && params !== null) fail('This request takes no parameters.');
}

const EVENT_SCOPES = ['personal', 'business', 'settlement', 'world'] as const;
const ACTIVITY_KINDS = [
  'purchase',
  'listed',
  'withdrawn',
  'imported',
  'exported',
  'direct',
  'sold_to_stall',
] as const;
const TENURES = ['lease', 'freehold'] as const;

type Validators = { [M in MethodName]: (params: unknown) => ParamsOf<M> };

const VALIDATORS: Validators = {
  'view.hud': none,
  'view.log': (p) => {
    const o = object(p);
    return { scope: oneOf(o.scope, 'scope', EVENT_SCOPES), limit: integer(o.limit, 'limit', 1, 500) };
  },
  'view.character': none,
  'view.home': none,
  'view.settlement': none,
  'view.location': (p) => ({ siteId: string(object(p).siteId, 'siteId') }),
  'view.jobs': none,
  'view.person': (p) => ({ entityId: string(object(p).entityId, 'entityId') }),
  'view.household': (p) => ({ householdId: string(object(p).householdId, 'householdId') }),
  'view.business': (p) => ({ companyId: string(object(p).companyId, 'companyId') }),
  'view.market': (p) => ({ siteId: string(object(p).siteId, 'siteId') }),
  'view.marketHistory': (p) => {
    const o = object(p);
    return {
      siteId: string(o.siteId, 'siteId'),
      goodType: string(o.goodType, 'goodType'),
      windowDays: integer(o.windowDays, 'windowDays', 1, 3650),
    };
  },
  'view.marketActivity': (p) => {
    const o = object(p);
    const f = object(o.filter, 'filter');
    return {
      siteId: string(o.siteId, 'siteId'),
      filter: {
        ...(f.goodType === undefined ? {} : { goodType: string(f.goodType, 'goodType') }),
        ...(f.kind === undefined ? {} : { kind: oneOf(f.kind, 'kind', ACTIVITY_KINDS) }),
        ...(f.beforeId === undefined
          ? {}
          : { beforeId: integer(f.beforeId, 'beforeId', 0, Number.MAX_SAFE_INTEGER) }),
        ...(f.limit === undefined ? {} : { limit: integer(f.limit, 'limit', 1, 100) }),
      },
    };
  },
  'view.founding': (p) => {
    const o = object(p);
    return {
      typeId: string(o.typeId, 'typeId'),
      siteId: o.siteId === null ? null : string(o.siteId, 'siteId'),
      tenure: oneOf(o.tenure, 'tenure', TENURES),
      inputs: integer(o.inputs, 'inputs', 0, 1_000_000),
    };
  },
  'player.queueAction': (p) => ({ type: string(object(p).type, 'type', 120) }),
  'player.queueMarketTrade': (p) => {
    const o = object(p);
    return {
      kind: oneOf(o.kind, 'kind', ['buy', 'list', 'withdraw'] as const),
      siteId: string(o.siteId, 'siteId'),
      goodType: string(o.goodType, 'goodType'),
      quantity: integer(o.quantity, 'quantity', 1, 1000),
    };
  },
  'player.interruptAction': none,
  'player.applyForJob': (p) => {
    const o = object(p);
    return { jobSlotId: string(o.jobSlotId, 'jobSlotId'), haggle: boolean(o.haggle, 'haggle') };
  },
  'player.quitJob': none,
  'player.setRoutinePreferences': (p) => {
    const o = object(p);
    return {
      attendWork: boolean(o.attendWork, 'attendWork'),
      eatDrink: boolean(o.eatDrink, 'eatDrink'),
      maintainProvisions: boolean(o.maintainProvisions, 'maintainProvisions'),
      sleep: boolean(o.sleep, 'sleep'),
      lodging: oneOf(o.lodging, 'lodging', ['rough', 'tavern'] as const),
      // Range enforced by the engine with a player-facing message.
      reserveCoin: typeof o.reserveCoin === 'number' ? o.reserveCoin : fail('reserveCoin must be a number.'),
    };
  },
  'player.equipItem': (p) => ({ itemId: string(object(p).itemId, 'itemId') }),
  'player.unequipSlot': (p) => ({ slot: oneOf(object(p).slot, 'slot', ['feet', 'body'] as const) }),
  'player.foundCompany': (p) => {
    const o = object(p);
    return {
      businessTypeId: string(o.businessTypeId, 'businessTypeId'),
      siteId: string(o.siteId, 'siteId'),
      tenureKind: oneOf(o.tenureKind, 'tenureKind', TENURES),
      companyName: string(o.companyName, 'companyName', 120),
      positions: integer(o.positions, 'positions', 0, 100),
      postedWage: integer(o.postedWage, 'postedWage', 0, 1_000_000),
      investment: integer(o.investment, 'investment', 0, 100_000_000),
      initialInputUnits: integer(o.initialInputUnits, 'initialInputUnits', 0, 1_000_000),
      founderWorks: boolean(o.founderWorks, 'founderWorks'),
    };
  },
  'clock.setSpeed': (p) => {
    const speed = object(p).speed;
    if (!SPEEDS.includes(speed as Speed)) fail('speed must be paused, 1, 4 or 16.');
    return { speed: speed as Speed };
  },
  'clock.skipToMorning': none,
  'clock.skipToActionComplete': none,
  'session.get': none,
  'session.newGame': (p) => {
    const o = object(p);
    const world = object(o.world, 'world');
    const character = object(o.character, 'character');
    const items = character.items === undefined ? undefined : character.items;
    if (items !== undefined && (!Array.isArray(items) || items.length > 50)) fail('items must be a list.');
    const skillXp = character.skillXp === undefined ? undefined : object(character.skillXp, 'skillXp');
    return {
      world: {
        seed: string(world.seed, 'seed', 200),
        ...(world.startSeasonIndex === undefined
          ? {}
          : { startSeasonIndex: integer(world.startSeasonIndex, 'startSeasonIndex', 0, 3) }),
      },
      character: {
        firstName: string(character.firstName, 'firstName', 200),
        lastName: string(character.lastName, 'lastName', 200),
        preset: oneOf(character.preset, 'preset', ['standard', 'custom'] as const),
        ...(character.coin === undefined
          ? {}
          : { coin: typeof character.coin === 'number' ? character.coin : fail('coin must be a number.') }),
        ...(skillXp === undefined
          ? {}
          : {
              // Skill names are checked against the implemented list by the
              // engine's validateNewGameConfig.
              skillXp: Object.fromEntries(
                Object.entries(skillXp).map(([skill, xp]) => [
                  string(skill, 'skill', 40),
                  typeof xp === 'number' ? xp : fail('skill XP must be a number.'),
                ]),
              ),
            }),
        ...(items === undefined
          ? {}
          : {
              items: (items as unknown[]).map((raw) => {
                const item = object(raw, 'item');
                return {
                  goodType: string(item.goodType, 'goodType', 40),
                  quantity:
                    typeof item.quantity === 'number' ? item.quantity : fail('quantity must be a number.'),
                  ...(item.durability === undefined
                    ? {}
                    : {
                        durability:
                          typeof item.durability === 'number'
                            ? item.durability
                            : fail('durability must be a number.'),
                      }),
                  ...(item.equipped === undefined ? {} : { equipped: boolean(item.equipped, 'equipped') }),
                };
              }),
            }),
      },
    };
  },
  'session.continue': none,
  'session.load': (p) => ({ saveId: string(object(p).saveId, 'saveId', 100) }),
  'session.close': none,
  'saves.list': none,
  'saves.autosave': none,
  'saves.create': (p) => {
    const o = object(p);
    return {
      name: string(o.name, 'name', 100),
      overwriteId: o.overwriteId === null ? null : string(o.overwriteId, 'overwriteId', 100),
    };
  },
  'saves.delete': (p) => ({ saveId: string(object(p).saveId, 'saveId', 100) }),
};

export function validateParams<M extends MethodName>(method: M, params: unknown): ParamsOf<M> {
  return VALIDATORS[method](params);
}
