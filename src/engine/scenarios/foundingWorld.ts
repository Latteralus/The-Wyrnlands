import { createDatabase } from '../db/sqlite';
import { loadSqlJs } from '../db/sqlite.node';
import { Engine } from '../engine';
import { recordMarketDay, recordMarketFlow } from '../market/history';
import { setTrait } from '../population/traits';
import { FARMING_SKILL, MANAGEMENT_SKILL, MILLING_SKILL } from '../skills/skills';
import { MINUTES_PER_DAY } from '../time/clock';

// A small, hand-built world for business-founding tests (companies/
// founding.ts, population/entrepreneurship.ts): a market, land to found on,
// a would-be founder in a household with savings, and optional neighbours —
// a mill that needs grain nobody grows, unemployed people to hire. Every
// number is explicit, so a test can say exactly which signal it's testing.

export const FOUNDER_ID = 'founder';
export const FOUNDER_HOUSEHOLD_ID = 'house-founder';
export const PARCEL_ID = 'eastfield';

export interface FoundingWorldOptions {
  founderCoin?: number;
  founderManagementXp?: number;
  ambition?: number;
  riskTolerance?: number;
  // Land: a vacant farm parcel unless false.
  farmParcel?: boolean;
  hoeStock?: number;
}

export async function buildFoundingWorld(seed: string, options: FoundingWorldOptions = {}): Promise<Engine> {
  const engine = Engine.bootstrap(createDatabase(await loadSqlJs()), { seed });
  engine.createSite({ id: 'market', name: 'Market', kind: 'market', x: 0, y: 0 });
  engine.createSite({ id: 'tavern', name: 'Tavern', kind: 'tavern', x: 1, y: 0 });
  if (options.farmParcel !== false) {
    engine.createSite({ id: PARCEL_ID, name: 'Eastfield', kind: 'farm', x: 4, y: 2, landValue: 600 });
  }
  engine.seedMarketListing('market', 'hoe', 60, options.hoeStock ?? 3);
  engine.seedMarketListing('market', 'bread', 12, 80);

  engine.createHousehold({ id: FOUNDER_HOUSEHOLD_ID, name: 'The Hale Household', homeSiteId: 'tavern' });
  engine.createEntity(FOUNDER_ID, 'Tomas Hale');
  engine.ensureNeeds(FOUNDER_ID);
  engine.addHouseholdMember(FOUNDER_HOUSEHOLD_ID, FOUNDER_ID);
  if ((options.founderCoin ?? 5000) > 0) {
    engine.faucetCoin(FOUNDER_HOUSEHOLD_ID, options.founderCoin ?? 5000, 'savings', 'business');
  }
  engine.ensureSkill(FOUNDER_ID, MANAGEMENT_SKILL);
  const xp = options.founderManagementXp ?? 650; // level 3
  if (xp > 0) engine.addSkillXp(FOUNDER_ID, MANAGEMENT_SKILL, xp);
  setTrait(engine.db, FOUNDER_ID, 'ambition', options.ambition ?? 1);
  setTrait(engine.db, FOUNDER_ID, 'risk_tolerance', options.riskTolerance ?? 0.8);
  return engine;
}

// A mill run by its owner, with nobody growing the grain it needs — the
// downstream demand a farm would answer.
export function addHungryMill(engine: Engine): void {
  engine.createSite({ id: 'mill-site', name: 'The Mill', kind: 'mill', x: -2, y: 0, landValue: 1000 });
  engine.createCompany({ id: 'mill-co', name: 'The Mill', kind: 'mill', siteId: 'mill-site' });
  engine.grantSiteTenure('mill-site', 'mill-co');
  engine.faucetCoin('mill-co', 3000, 'capital');
  engine.createJobSlot({
    id: 'mill-job',
    companyId: 'mill-co',
    title: 'Miller',
    skill: MILLING_SKILL,
    wageMin: 20,
    wageMax: 35,
    shiftDurationTicks: 360,
    capacity: 2,
  });
  engine.createHousehold({ id: 'house-miller', name: 'The Miller Household', homeSiteId: 'tavern' });
  engine.createEntity('miller', 'Edda Millwright');
  engine.addHouseholdMember('house-miller', 'miller');
  engine.setCompanyOwner('mill-co', 'miller');
  engine.applyForJob('miller', 'mill-job', { haggle: false, scope: 'settlement' });
  engine.createEntity('miller-2', 'Finn Millwright');
  engine.addHouseholdMember('house-miller', 'miller-2');
  engine.applyForJob('miller-2', 'mill-job', { haggle: false, scope: 'settlement' });
}

// Households of unemployed people, `count` people in all.
export function addJobSeekers(engine: Engine, count: number): void {
  for (let i = 0; i < count; i++) {
    const household = `house-seeker-${i}`;
    engine.createHousehold({ id: household, name: `Seeker Household ${i}`, homeSiteId: 'tavern' });
    engine.createEntity(`seeker-${i}`, `Seeker ${i}`);
    engine.ensureNeeds(`seeker-${i}`);
    engine.addHouseholdMember(household, `seeker-${i}`);
  }
}

// A working farm with `workers` hands (hired from addJobSeekers � call it
// instead of, not as well as, addJobSeekers), its grain glutting the market:
// sold slowly, the rest exported by the merchant, for the last four weeks.
export function addGluttedGrainMarket(engine: Engine, workers: number) {
  engine.createSite({ id: 'old-farm', name: 'Old Farm', kind: 'farm', x: 9, y: 9, landValue: 800 });
  engine.createCompany({ id: 'farm-co', name: 'Old Farm', kind: 'farm', siteId: 'old-farm' });
  engine.grantSiteTenure('old-farm', 'farm-co');
  engine.createJobSlot({
    id: 'farm-job',
    companyId: 'farm-co',
    title: 'Farmhand',
    skill: FARMING_SKILL,
    wageMin: 20,
    wageMax: 35,
    shiftDurationTicks: 360,
    capacity: workers,
  });
  addJobSeekers(engine, workers);
  for (let i = 0; i < workers; i++) engine.applyForJob(`seeker-${i}`, 'farm-job', { haggle: false });
  engine.seedMarketListing('market', 'grain', 9, 120);
  for (let day = 1; day <= 28; day++) {
    recordMarketFlow(engine.db, 'market', 'grain', day * MINUTES_PER_DAY, 'sold', 2);
    recordMarketFlow(engine.db, 'market', 'grain', day * MINUTES_PER_DAY, 'exported', 6);
    recordMarketDay(engine.db, day * MINUTES_PER_DAY);
  }
}
