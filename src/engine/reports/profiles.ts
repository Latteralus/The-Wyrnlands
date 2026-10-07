import {
  getCompany,
  getCompanyManagerId,
  summarizeLedger,
  type Company,
  type LedgerSummary,
} from '../companies/companies';
import { getFoundingRecord } from '../companies/founding';
import { queryRows } from '../db/sqlite';
import { getEntityName } from '../entities';
import { getWornGear, type WornGear } from '../gear/gear';
import { getGoodDefinition } from '../goods/catalog';
import { getBalance } from '../inventory/wallet';
import { getNeeds, type Needs } from '../needs/needs';
import {
  CHARITY_THRESHOLD,
  EMIGRATION_GRACE_DAYS,
  HUNGER_EMIGRATION_DAYS,
  RESERVE_HEALTHY_THRESHOLD,
  TITHE_THRESHOLD,
  weeklyFoodCost,
} from '../population/cadence';
import { getHousehold, getHouseholdIdForMember, listHouseholdMembers } from '../population/households';
import { getActivitySnapshot, listPresentEntities, type ActivitySnapshot } from '../population/presence';
import { peekTrait } from '../population/traits';
import { listSkills, type SkillRecord } from '../skills/skills';
import { MINUTES_PER_DAY } from '../time/clock';
import { getOpenTenure, type TenureKind } from '../world/tenure';
import type { Database } from '../db/sqlite';

// Profiles (§11.2 NPC profile, §14.2 household screen and business view):
// everything the interface can show about a person, a household or a
// business, assembled in one read-only pass. Strictly no writes — reading a
// profile must never change the world (traits are peeked, not stored).
//
// Each profile is split by what a player could plausibly know (§8.1 rule 6,
// §9.3 "NPC businesses expose what an observer would plausibly know"):
//   - the top-level fields are public knowledge — someone's trade and
//     skill, where they've worked, who they live with, roughly how well off
//     a household is, who runs a business and how many it employs;
//   - `inspect` holds the rest — exact coin, belongings, personality
//     traits, a business's books and its founder's private reckoning.
// The interface shows `inspect` only when the player turns Inspect on.

export type WealthBand = 'destitute' | 'struggling' | 'getting by' | 'comfortable' | 'well-off' | 'wealthy';

// The thresholds the simulation itself acts on: charity, strain, tithing.
export function wealthBand(coin: number): WealthBand {
  if (coin < CHARITY_THRESHOLD) return 'destitute';
  if (coin < RESERVE_HEALTHY_THRESHOLD) return 'struggling';
  if (coin < TITHE_THRESHOLD) return 'getting by';
  if (coin < 1000) return 'comfortable';
  if (coin < 5000) return 'well-off';
  return 'wealthy';
}

export interface InventoryLine {
  goodType: string;
  count: number;
  // Average condition, 0-100%, for goods that wear (tools, gear); null otherwise.
  conditionPercent: number | null;
}

function listInventory(db: Database, containerId: string): InventoryLine[] {
  return queryRows(
    db,
    `SELECT type, COUNT(*), AVG(durability) FROM items
     WHERE container_id = ? AND status = 'active' GROUP BY type ORDER BY type`,
    [containerId],
  ).map((row) => {
    const goodType = String(row[0]);
    const max = getGoodDefinition(goodType).maxDurability;
    return {
      goodType,
      count: Number(row[1]),
      conditionPercent: max && row[2] !== null ? Math.round((Number(row[2]) / max) * 100) : null,
    };
  });
}

export interface JobRecord {
  companyId: string;
  companyName: string;
  title: string;
  skill: string;
  wage: number;
  hiredTick: number;
  endedTick: number | null; // null = current job
}

function listJobHistory(db: Database, entityId: string): JobRecord[] {
  return queryRows(
    db,
    `SELECT employment.company_id, companies.name, job_slots.title, job_slots.skill, employment.wage,
            employment.hired_at_tick, employment.terminated_at_tick
     FROM employment
     JOIN job_slots ON job_slots.id = employment.job_slot_id
     JOIN companies ON companies.id = employment.company_id
     WHERE employment.entity_id = ?
     ORDER BY employment.status = 'active' DESC, employment.hired_at_tick DESC, employment.id DESC`,
    [entityId],
  ).map((row) => ({
    companyId: String(row[0]),
    companyName: String(row[1]),
    title: String(row[2]),
    skill: String(row[3]),
    wage: Number(row[4]),
    hiredTick: Number(row[5]),
    endedTick: row[6] === null ? null : Number(row[6]),
  }));
}

export type RelationTarget = 'npc' | 'household' | 'business';

// A link from one profile to another — the relationships the world
// actually models today: household, employer and workmates, ownership,
// management, founding. (Marriage, kin and friendship are Stage 8.)
export interface Relation {
  relation: string;
  target: RelationTarget;
  id: string;
  name: string;
}

export interface CompanyRole {
  companyId: string;
  companyName: string;
  role: 'owner' | 'manager' | 'founder';
  open: boolean;
}

function companyRoles(db: Database, entityId: string): CompanyRole[] {
  const rows = queryRows(
    db,
    `SELECT id, name, closed_at_tick, owner_id = ?, COALESCE(manager_id, owner_id) = ?,
            EXISTS (SELECT 1 FROM company_foundings WHERE company_id = companies.id AND founder_id = ?)
     FROM companies WHERE owner_id = ? OR manager_id = ?
        OR id IN (SELECT company_id FROM company_foundings WHERE founder_id = ?)
     ORDER BY closed_at_tick IS NOT NULL, id`,
    [entityId, entityId, entityId, entityId, entityId, entityId],
  );
  const roles: CompanyRole[] = [];
  for (const row of rows) {
    const base = { companyId: String(row[0]), companyName: String(row[1]), open: row[2] === null };
    if (Number(row[3])) roles.push({ ...base, role: 'owner' });
    else if (Number(row[5])) roles.push({ ...base, role: 'founder' });
    if (Number(row[4]) && !Number(row[3])) roles.push({ ...base, role: 'manager' });
  }
  return roles;
}

// --- People ---

export interface PersonProfile {
  id: string;
  name: string;
  activity: ActivitySnapshot | null;
  householdId: string | null;
  householdName: string | null;
  householdWealth: WealthBand | null;
  condition: Needs | null;
  skills: SkillRecord[];
  jobs: JobRecord[];
  businesses: CompanyRole[];
  relations: Relation[];
  inspect: {
    purse: number;
    householdCoin: number | null;
    traits: { ambition: number; riskTolerance: number };
    inventory: InventoryLine[];
    gear: WornGear[];
  };
}

const MAX_WORKMATES = 8;

export function getPersonProfile(db: Database, entityId: string): PersonProfile {
  const householdId = getHouseholdIdForMember(db, entityId);
  const household = householdId ? getHousehold(db, householdId) : null;
  const householdCoin = householdId ? getBalance(db, householdId) : null;
  const jobs = listJobHistory(db, entityId);
  const businesses = companyRoles(db, entityId);
  const current = jobs.find((j) => j.endedTick === null);

  const relations: Relation[] = [];
  if (household) {
    relations.push({ relation: 'Household', target: 'household', id: household.id, name: household.name });
    for (const member of listHouseholdMembers(db, household.id)) {
      if (member !== entityId)
        relations.push({
          relation: 'Lives with',
          target: 'npc',
          id: member,
          name: getEntityName(db, member),
        });
    }
  }
  if (current) {
    relations.push({
      relation: 'Works for',
      target: 'business',
      id: current.companyId,
      name: current.companyName,
    });
    const company = getCompany(db, current.companyId);
    if (company?.ownerId && company.ownerId !== entityId)
      relations.push({
        relation: 'Answers to',
        target: 'npc',
        id: company.ownerId,
        name: getEntityName(db, company.ownerId),
      });
    const workmates = queryRows(
      db,
      `SELECT entity_id FROM employment WHERE company_id = ? AND status = 'active' AND entity_id != ?
       ORDER BY hired_at_tick, id LIMIT ?`,
      [current.companyId, entityId, MAX_WORKMATES],
    ).map((row) => String(row[0]));
    // Someone already listed (they live together, or it's the boss) isn't
    // repeated as a workmate.
    const listed = new Set(relations.map((r) => r.id));
    for (const mate of workmates) {
      if (!listed.has(mate))
        relations.push({
          relation: 'Works alongside',
          target: 'npc',
          id: mate,
          name: getEntityName(db, mate),
        });
    }
  }
  for (const role of businesses) {
    const label = role.role === 'owner' ? 'Owns' : role.role === 'manager' ? 'Manages' : 'Founded';
    relations.push({
      relation: role.open ? label : `${label} (closed)`,
      target: 'business',
      id: role.companyId,
      name: role.companyName,
    });
  }

  return {
    id: entityId,
    name: getEntityName(db, entityId),
    activity:
      household?.departedAtTick !== null && household?.departedAtTick !== undefined
        ? null
        : getActivitySnapshot(db, entityId),
    householdId,
    householdName: household?.name ?? null,
    householdWealth: householdCoin === null ? null : wealthBand(householdCoin),
    condition: getNeeds(db, entityId),
    skills: listSkills(db, entityId),
    jobs,
    businesses,
    relations,
    inspect: {
      purse: getBalance(db, entityId),
      householdCoin,
      traits: {
        ambition: peekTrait(db, entityId, 'ambition'),
        riskTolerance: peekTrait(db, entityId, 'risk_tolerance'),
      },
      inventory: listInventory(db, entityId),
      gear: getWornGear(db, entityId),
    },
  };
}

// --- Households ---

export interface HouseholdMember {
  id: string;
  name: string;
  jobTitle: string | null;
  companyId: string | null;
  companyName: string | null;
}

export interface HouseholdProfile {
  id: string;
  name: string;
  members: HouseholdMember[];
  wealth: WealthBand;
  // Plain-words circumstances the neighbours would notice.
  situation: string[];
  businesses: CompanyRole[];
  inspect: {
    coin: number;
    weeksOfFood: number | null;
    hungerDays: number;
    // The tally at which a hungry household leaves (§11.4).
    hungerDaysToLeave: number;
    destituteSinceTick: number | null;
    // Days destitute (with the parish unable to help) before they leave.
    destituteDaysToLeave: number;
    departedAtTick: number | null;
    inventory: InventoryLine[];
  };
}

export function getHouseholdProfile(db: Database, householdId: string): HouseholdProfile | null {
  const household = getHousehold(db, householdId);
  if (!household) return null;
  const coin = getBalance(db, householdId);
  const members = listHouseholdMembers(db, householdId).map((id): HouseholdMember => {
    const job = listJobHistory(db, id).find((j) => j.endedTick === null);
    return {
      id,
      name: getEntityName(db, id),
      jobTitle: job?.title ?? null,
      companyId: job?.companyId ?? null,
      companyName: job?.companyName ?? null,
    };
  });

  const situation: string[] = [];
  if (household.departedAtTick !== null) situation.push('They have left the settlement.');
  else {
    if (members.length > 0 && members.every((m) => m.jobTitle === null))
      situation.push('Nobody in the household has work.');
    if (household.hungerDays >= 7) situation.push('They have been going hungry.');
    if (household.destituteSinceTick !== null) situation.push('They are living on charity.');
  }
  const foodWeek = weeklyFoodCost(db, householdId);

  return {
    id: household.id,
    name: household.name,
    members,
    wealth: wealthBand(coin),
    situation,
    businesses: members.flatMap((m) => companyRoles(db, m.id)),
    inspect: {
      coin,
      weeksOfFood: foodWeek > 0 ? Math.round((coin / foodWeek) * 10) / 10 : null,
      hungerDays: household.hungerDays,
      hungerDaysToLeave: HUNGER_EMIGRATION_DAYS,
      destituteSinceTick: household.destituteSinceTick,
      destituteDaysToLeave: EMIGRATION_GRACE_DAYS,
      departedAtTick: household.departedAtTick,
      inventory: listInventory(db, householdId),
    },
  };
}

// --- Businesses ---

export interface StaffMember {
  id: string;
  name: string;
  title: string;
  hiredTick: number;
  wage: number;
}

export interface BusinessProfile {
  id: string;
  name: string;
  kind: string;
  tier: number;
  status: 'open' | 'struggling' | 'closed';
  ownerId: string | null;
  ownerName: string | null;
  managerId: string | null;
  managerName: string | null;
  siteId: string;
  siteName: string;
  tenure: { kind: TenureKind; weeklyRent: number } | null;
  foundedTick: number | null; // null = predates the game
  founderId: string | null;
  founderName: string | null;
  foundingReasons: string[];
  closedTick: number | null;
  staff: StaffMember[];
  activity: ActivitySnapshot | null;
  workersPresent: number;
  inTransit: InventoryLine[];
  // What's on the premises — goods anyone walking past could see.
  stock: InventoryLine[];
  inspect: {
    cash: number;
    lastFourWeeks: LedgerSummary;
    lifetime: LedgerSummary;
    investment: number | null;
    founderPurseBefore: number | null;
    // The founder's private reckoning when they committed (companies/
    // founding.ts's details: what they believed, the market as they read it).
    founderEstimate: Record<string, unknown> | null;
  };
}

function businessStatus(company: Company): BusinessProfile['status'] {
  if (company.closedAtTick !== null) return 'closed';
  return company.insolventSinceTick !== null ? 'struggling' : 'open';
}

export function getBusinessProfile(db: Database, companyId: string, tick: number): BusinessProfile | null {
  const company = getCompany(db, companyId);
  if (!company) return null;
  const founding = getFoundingRecord(db, companyId);
  const managerId = getCompanyManagerId(company);
  const tenure = getOpenTenure(db, company.siteId);
  const site = queryRows(db, 'SELECT name FROM sites WHERE id = ?', [company.siteId])[0];
  const reasons = founding?.details?.reasons;

  const staff = queryRows(
    db,
    `SELECT employment.entity_id, job_slots.title, employment.hired_at_tick, employment.wage
     FROM employment JOIN job_slots ON job_slots.id = employment.job_slot_id
     WHERE employment.company_id = ? AND employment.status = 'active'
     ORDER BY employment.hired_at_tick, employment.id`,
    [companyId],
  ).map((row) => ({
    id: String(row[0]),
    name: getEntityName(db, String(row[0])),
    title: String(row[1]),
    hiredTick: Number(row[2]),
    wage: Number(row[3]),
  }));

  const estimate = founding?.details ? { ...founding.details } : null;
  if (estimate) delete estimate.reasons;

  return {
    id: company.id,
    name: company.name,
    kind: company.kind,
    tier: company.tier,
    status: businessStatus(company),
    ownerId: company.ownerId,
    ownerName: company.ownerId ? getEntityName(db, company.ownerId) : null,
    managerId: managerId !== company.ownerId ? managerId : null,
    managerName: managerId && managerId !== company.ownerId ? getEntityName(db, managerId) : null,
    siteId: company.siteId,
    siteName: site ? String(site[0]) : company.siteId,
    tenure:
      tenure && tenure.holderId === company.id ? { kind: tenure.kind, weeklyRent: tenure.weeklyRent } : null,
    foundedTick: founding ? founding.tick : null,
    founderId: founding?.founderId ?? null,
    founderName: founding ? getEntityName(db, founding.founderId) : null,
    foundingReasons: Array.isArray(reasons) ? reasons.map(String) : [],
    closedTick: company.closedAtTick,
    staff,
    activity: company.closedAtTick === null ? getActivitySnapshot(db, companyId) : null,
    workersPresent: listPresentEntities(db, company.siteId, 0).filter((person) =>
      staff.some((member) => member.id === person.entityId),
    ).length,
    inTransit: listInventory(db, `freight:${companyId}`),
    stock: listInventory(db, companyId),
    inspect: {
      cash: getBalance(db, companyId),
      lastFourWeeks: summarizeLedger(db, companyId, Math.max(0, tick - 28 * MINUTES_PER_DAY)),
      lifetime: summarizeLedger(db, companyId, 0),
      investment: founding?.investment ?? null,
      founderPurseBefore: founding?.payerBalanceBefore ?? null,
      founderEstimate: estimate,
    },
  };
}
