// The typed protocol between the renderer (React) and the simulation host
// (the Electron utility process that owns the Engine, its database, the
// clock and the RNG). Nothing crosses the process boundary but these
// messages — plain, structured-cloneable data. The renderer never sees an
// Engine, a database handle, or SQL.
//
// Three kinds of traffic:
//   - views:    read-only snapshots, one per screen (or panel), computed in
//               the simulation process and sent whole — not one call per
//               field (MigrationPlan.md Phase 4);
//   - commands: the player's intents (queue an action, take a job, set the
//               clock speed…), always on behalf of the controlled character;
//   - notifications: pushed by the host — the clock advanced and which
//               domains changed, the session or the save list changed.
// Session/save lifecycle methods sit alongside the commands.
import type { QueuedAction } from '../engine/actions/types';
import type { Company, LedgerSummary } from '../engine/companies/companies';
import type { FoundingPlan, FoundingResult, StartupOutlay } from '../engine/companies/founding';
import type { Entity } from '../engine/entities';
import type { EngineEvent, EventScope } from '../engine/eventBus';
import type { WornGear } from '../engine/gear/gear';
import type { GearSlot, GoodDefinition } from '../engine/goods/catalog';
import type { ApplyResult, Employment, JobSlot } from '../engine/jobs/jobs';
import type { MarketActivity, MarketActivityFilter, MarketActivityKind } from '../engine/market/activity';
import type {
  MarketGood,
  MarketHistoryPoint,
  MarketOverview,
  MarketPackLine,
  MarketSeller,
  PersonalMarketListing,
} from '../engine/market/dashboard';
import type { MarketListing } from '../engine/market/market';
import type { MarketTradeRequest } from '../engine/market/tradeTypes';
import type { Needs } from '../engine/needs/needs';
import type { NewGameConfig, StartingItem } from '../engine/player/newGame';
import type { RoutinePreferences } from '../engine/player/preferences';
import type { PlayerHome, PlayerProfile } from '../engine/player/profile';
import type { Household } from '../engine/population/households';
import type { PresentEntity } from '../engine/population/presence';
import type {
  BusinessProfile,
  CompanyRole,
  HouseholdMember,
  HouseholdProfile,
  InventoryLine,
  JobRecord,
  PersonProfile,
  Relation,
  StaffMember,
  WealthBand,
} from '../engine/reports/profiles';
import type { SkillRecord } from '../engine/skills/skills';
import type { Calendar } from '../engine/time/clock';
import type { Site } from '../engine/world/sites';
import type { TenureKind } from '../engine/world/tenure';

// Engine data shapes the screens render, re-exported so renderer code never
// imports an engine path itself.
export type {
  ApplyResult,
  BusinessProfile,
  Calendar,
  Company,
  CompanyRole,
  Employment,
  EngineEvent,
  Entity,
  EventScope,
  FoundingResult,
  GearSlot,
  GoodDefinition,
  Household,
  HouseholdMember,
  HouseholdProfile,
  InventoryLine,
  JobRecord,
  JobSlot,
  LedgerSummary,
  MarketActivity,
  MarketActivityFilter,
  MarketActivityKind,
  MarketGood,
  MarketHistoryPoint,
  MarketListing,
  MarketOverview,
  MarketPackLine,
  MarketSeller,
  MarketTradeRequest,
  Needs,
  NewGameConfig,
  PersonalMarketListing,
  PersonProfile,
  PlayerHome,
  PlayerProfile,
  PresentEntity,
  QueuedAction,
  Relation,
  RoutinePreferences,
  Site,
  SkillRecord,
  StaffMember,
  StartingItem,
  StartupOutlay,
  TenureKind,
  WealthBand,
  WornGear,
};

export type Speed = 'paused' | 1 | 4 | 16;
export const SPEEDS: readonly Speed[] = ['paused', 1, 4, 16];

// Which SQLite implementation the simulation process runs on.
export type StorageBackend = 'native' | 'sqljs';

// --- Session and saves ---------------------------------------------------

export interface SessionInfo {
  playerId: string;
  playerName: string;
  // Needed to turn ticks into dates on the renderer side (gameRules'
  // deriveCalendar) — e.g. log timestamps — without a round trip.
  startSeasonIndex: number;
  tick: number;
  calendar: Calendar;
  speed: Speed;
  backend: StorageBackend;
}

export type SaveKind = 'autosave' | 'manual' | 'import' | 'backup';

// Lives in each save folder's metadata.json — wall-clock times and versions
// stay out of the simulation database (MASTERPLAN.md §4.2's determinism).
export interface SaveMetadata {
  id: string;
  kind: SaveKind;
  displayName: string;
  characterName: string;
  tick: number;
  year: number;
  season: string;
  day: number;
  worldSeed: string;
  createdAt: string;
  updatedAt: string;
  gameVersion: string;
  saveFormatVersion: number;
}

export interface SaveListing {
  saves: SaveMetadata[];
  // The save the running game lives in, if a game is running.
  activeSaveId: string | null;
}

// --- Views -----------------------------------------------------------------

export interface HudView {
  calendar: Calendar;
  tick: number;
  balance: number;
  needs: Needs | null;
  wornGear: WornGear[];
  activeActions: QueuedAction[];
}

export interface CharacterView {
  profile: PlayerProfile;
  currentAction: QueuedAction | null;
  routine: RoutinePreferences;
  history: EngineEvent[];
}

export interface HomeView {
  home: PlayerHome;
  routine: RoutinePreferences;
  purse: number;
  lodgingName: string | null;
}

export interface SettlementView {
  sites: Site[];
  households: Household[];
  companies: Company[];
}

export interface SiteHolder {
  holderId: string;
  holderName: string;
  kind: 'freehold' | 'lease';
}

export interface LocationView {
  site: Site;
  listings: MarketListing[];
  present: PresentEntity[];
  holder: SiteHolder | null;
}

export type JobOpening = JobSlot & { vacancies: number };

export interface JobsView {
  openings: JobOpening[];
  employment: Employment | null;
}

export type StaffedJobSlot = JobSlot & { filled: number };

export interface BusinessView {
  profile: BusinessProfile;
  company: Company;
  slots: StaffedJobSlot[];
  log: EngineEvent[];
  playerJob: Employment | null;
  playerJobCompanyName: string | null;
  // The player owns or manages it: its books are theirs to read.
  ownBooks: boolean;
}

export interface MarketView {
  overview: MarketOverview;
  balance: number;
}

export type BusinessTypeInfo = {
  id: string;
  siteKind: string;
  skill: string;
  jobTitle: string;
  toolGoodType: string | null;
  wageMin: number;
  wageMax: number;
  startingMaxPositions: number;
  inputGood: string | null;
  minimumInputUnits: number;
};

export interface FoundingView {
  types: BusinessTypeInfo[];
  // The type the estimate is for (the requested one, else the first).
  typeId: string | null;
  // Vacant parcels of that type's kind, and the one the estimate is for
  // (the requested parcel if still vacant, else the first).
  sites: Site[];
  chosenSiteId: string | null;
  outlay: StartupOutlay | null;
  balance: number;
  owned: { companyId: string; companyName: string; open: boolean }[];
  // Market stock of the chosen type's input good, if it has one.
  inputAvailable: number;
}

export type PlayerFoundingPlan = Omit<FoundingPlan, 'founderId' | 'payerId' | 'details'>;

// --- The method table ------------------------------------------------------
//
// method name → [params, result]. Views are read-only; everything else may
// change the world or the session.

export interface ViewMethods {
  'view.hud': [void, HudView];
  'view.log': [{ scope: EventScope; limit: number }, EngineEvent[]];
  'view.character': [void, CharacterView];
  'view.home': [void, HomeView | null];
  'view.settlement': [void, SettlementView];
  'view.location': [{ siteId: string }, LocationView | null];
  'view.jobs': [void, JobsView];
  'view.person': [{ entityId: string }, PersonProfile | null];
  'view.household': [{ householdId: string }, HouseholdProfile | null];
  'view.business': [{ companyId: string }, BusinessView | null];
  'view.market': [{ siteId: string }, MarketView];
  'view.marketHistory': [{ siteId: string; goodType: string; windowDays: number }, MarketHistoryPoint[]];
  'view.marketActivity': [{ siteId: string; filter: MarketActivityFilter }, MarketActivity[]];
  'view.founding': [
    { typeId: string; siteId: string | null; tenure: TenureKind; inputs: number },
    FoundingView,
  ];
}

export interface CommandMethods {
  'player.queueAction': [{ type: string }, void];
  'player.queueMarketTrade': [MarketTradeRequest, void];
  'player.interruptAction': [void, void];
  'player.applyForJob': [{ jobSlotId: string; haggle: boolean }, ApplyResult];
  'player.quitJob': [void, void];
  'player.setRoutinePreferences': [RoutinePreferences, void];
  'player.equipItem': [{ itemId: string }, void];
  'player.unequipSlot': [{ slot: GearSlot }, void];
  'player.foundCompany': [PlayerFoundingPlan, FoundingResult];
  'clock.setSpeed': [{ speed: Speed }, void];
  'clock.skipToMorning': [void, void];
  'clock.skipToActionComplete': [void, void];
}

export interface SessionMethods {
  'session.get': [void, SessionInfo | null];
  'session.newGame': [NewGameConfig, SessionInfo];
  'session.continue': [void, SessionInfo];
  'session.load': [{ saveId: string }, SessionInfo];
  // Saves the running game and ends it (back to the title screen).
  'session.close': [void, void];
  'saves.list': [void, SaveListing];
  // Autosaves the running game now (e.g. as the Save screen opens).
  'saves.autosave': [void, void];
  'saves.create': [{ name: string; overwriteId: string | null }, SaveMetadata];
  'saves.delete': [{ saveId: string }, void];
}

export type SimulationMethods = ViewMethods & CommandMethods & SessionMethods;
export type MethodName = keyof SimulationMethods;
export type ParamsOf<M extends MethodName> = SimulationMethods[M][0];
export type ResultOf<M extends MethodName> = SimulationMethods[M][1];
export type ViewName = keyof ViewMethods;

// Every method the renderer may call. The preload refuses anything else
// before it leaves the renderer, and the host validates again.
export const METHOD_NAMES = [
  'view.hud',
  'view.log',
  'view.character',
  'view.home',
  'view.settlement',
  'view.location',
  'view.jobs',
  'view.person',
  'view.household',
  'view.business',
  'view.market',
  'view.marketHistory',
  'view.marketActivity',
  'view.founding',
  'player.queueAction',
  'player.queueMarketTrade',
  'player.interruptAction',
  'player.applyForJob',
  'player.quitJob',
  'player.setRoutinePreferences',
  'player.equipItem',
  'player.unequipSlot',
  'player.foundCompany',
  'clock.setSpeed',
  'clock.skipToMorning',
  'clock.skipToActionComplete',
  'session.get',
  'session.newGame',
  'session.continue',
  'session.load',
  'session.close',
  'saves.list',
  'saves.autosave',
  'saves.create',
  'saves.delete',
] as const satisfies readonly MethodName[];

export function isMethodName(value: unknown): value is MethodName {
  return typeof value === 'string' && (METHOD_NAMES as readonly string[]).includes(value);
}

// --- Change domains and notifications --------------------------------------
//
// After each batch of ticks (or a command) the host reports which parts of
// the world may have changed; the renderer re-fetches only the views that
// depend on them. Coarse by design (MigrationPlan.md Phase 7): within a day
// only the player's own actions run per tick, while the NPC economy moves
// at day boundaries, which invalidate everything.
export type Domain = 'clock' | 'player' | 'market' | 'world' | 'logs';
export const ALL_DOMAINS: readonly Domain[] = ['clock', 'player', 'market', 'world', 'logs'];

export const VIEW_DOMAINS: Record<ViewName, readonly Domain[]> = {
  'view.hud': ['clock', 'player'],
  'view.log': ['logs'],
  'view.character': ['player', 'logs'],
  'view.home': ['player', 'world'],
  'view.settlement': ['world'],
  // Who's at a place depends on the hour.
  'view.location': ['clock', 'world', 'market'],
  'view.jobs': ['player', 'world'],
  'view.person': ['player', 'world', 'logs'],
  'view.household': ['player', 'world'],
  'view.business': ['player', 'world', 'market', 'logs'],
  'view.market': ['player', 'market'],
  'view.marketHistory': ['market'],
  'view.marketActivity': ['market'],
  'view.founding': ['player', 'world', 'market'],
};

export type SimulationNotification =
  | {
      type: 'simulation.updated';
      tick: number;
      calendar: Calendar;
      domains: Domain[];
      // How many in-game minutes this update covers, and how many logged
      // events they produced (for the renderer's own bookkeeping/metrics).
      ticks: number;
      events: number;
    }
  | { type: 'clock.changed'; speed: Speed }
  | { type: 'session.changed'; session: SessionInfo | null }
  | { type: 'saves.changed' }
  | { type: 'host.error'; message: string };

// --- Main-process mediated file operations ---------------------------------
//
// Export and import need a native file dialog, which only the main process
// can show; the chosen path goes from the main process straight to the
// simulation host, never through the renderer.
export type ExportSaveResult =
  { status: 'saved'; fileName: string } | { status: 'cancelled' } | { status: 'failed'; message: string };
export type ImportSaveResult =
  | { status: 'imported'; save: SaveMetadata }
  | { status: 'cancelled' }
  | { status: 'failed'; message: string };

// window.wyrnlands — everything the preload exposes to the renderer.
export interface WyrnlandsBridge {
  readonly host: 'electron';
  readonly versions: { electron: string; chrome: string };
  request(method: MethodName, params: unknown): Promise<unknown>;
  onNotification(listener: (notification: SimulationNotification) => void): () => void;
  exportSave(): Promise<ExportSaveResult>;
  importSave(): Promise<ImportSaveResult>;
}
