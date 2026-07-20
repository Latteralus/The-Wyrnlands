import { queryRow, queryRows } from '../db/sqlite';
import { addXp, getSuccessChance, TRADING_SKILL } from '../skills/skills';
import type { EventBus, EventScope } from '../eventBus';
import type { Database } from 'sql.js';

// §9.8 job slots: openings (wage band, hours, skill ask, employer,
// equipment quality — §14.2 Jobs screen). id is code-assigned (see the
// migration's comment on job_slots).
export interface JobSlot {
  id: string;
  companyId: string;
  companyName: string;
  title: string;
  skill: string;
  wageMin: number;
  wageMax: number;
  shiftDurationTicks: number;
  toolGoodType: string | null;
  capacity: number;
}

export interface CreateJobSlotParams {
  id: string;
  companyId: string;
  title: string;
  skill: string;
  wageMin: number;
  wageMax: number;
  shiftDurationTicks: number;
  toolGoodType?: string;
  capacity?: number;
}

export function createJobSlot(db: Database, params: CreateJobSlotParams): void {
  db.run(
    `INSERT INTO job_slots (id, company_id, title, skill, wage_min, wage_max, shift_duration_ticks, tool_good_type, capacity)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      params.id,
      params.companyId,
      params.title,
      params.skill,
      params.wageMin,
      params.wageMax,
      params.shiftDurationTicks,
      params.toolGoodType ?? null,
      params.capacity ?? 1,
    ],
  );
}

const JOB_SLOT_COLUMNS = `job_slots.id, job_slots.company_id, companies.name, job_slots.title, job_slots.skill,
  job_slots.wage_min, job_slots.wage_max, job_slots.shift_duration_ticks, job_slots.tool_good_type, job_slots.capacity`;
const JOB_SLOT_FROM = 'job_slots JOIN companies ON companies.id = job_slots.company_id';

function rowToJobSlot(row: unknown[]): JobSlot {
  return {
    id: String(row[0]),
    companyId: String(row[1]),
    companyName: String(row[2]),
    title: String(row[3]),
    skill: String(row[4]),
    wageMin: Number(row[5]),
    wageMax: Number(row[6]),
    shiftDurationTicks: Number(row[7]),
    toolGoodType: typeof row[8] === 'string' ? row[8] : null,
    capacity: Number(row[9]),
  };
}

export function getJobSlot(db: Database, id: string): JobSlot | null {
  const row = queryRow(db, `SELECT ${JOB_SLOT_COLUMNS} FROM ${JOB_SLOT_FROM} WHERE job_slots.id = ?`, [id]);
  return row ? rowToJobSlot(row) : null;
}

// §14.2 Jobs screen: every posted opening, in listing order. Excludes job
// slots belonging to a closed company (§9.6) — a defunct business doesn't
// post openings, and this is also what population/cadence.ts's weekly
// cadence and job-seeking iterate, so a closed company's (already-empty,
// post-termination) slots don't get pointlessly re-checked either.
export function listJobOpenings(db: Database): JobSlot[] {
  return queryRows(
    db,
    `SELECT ${JOB_SLOT_COLUMNS} FROM ${JOB_SLOT_FROM} WHERE companies.closed_at_tick IS NULL ORDER BY job_slots.id`,
  ).map(rowToJobSlot);
}

// §Stage 5: companies/decisions.ts's daily cadence needs to know what a
// company actually produces/consumes, derived from its job slots' skills
// (via production/recipes.ts) rather than a separate hand-maintained list.
export function listJobSlotsForCompany(db: Database, companyId: string): JobSlot[] {
  return queryRows(
    db,
    `SELECT ${JOB_SLOT_COLUMNS} FROM ${JOB_SLOT_FROM} WHERE job_slots.company_id = ? ORDER BY job_slots.id`,
    [companyId],
  ).map(rowToJobSlot);
}

// §9.5 "upgrade tiers expand job slots" — companies/decisions.ts's
// tryUpgrade is the only caller; it's responsible for the cost/tier side.
export function setJobSlotCapacity(db: Database, jobSlotId: string, capacity: number): void {
  db.run('UPDATE job_slots SET capacity = ? WHERE id = ?', [capacity, jobSlotId]);
}

export interface Employment {
  id: number;
  entityId: string;
  jobSlotId: string;
  companyId: string;
  wage: number;
  hiredAtTick: number;
  status: 'active' | 'terminated';
  terminatedAtTick: number | null;
}

const EMPLOYMENT_COLUMNS =
  'id, entity_id, job_slot_id, company_id, wage, hired_at_tick, status, terminated_at_tick';

function rowToEmployment(row: unknown[]): Employment {
  return {
    id: Number(row[0]),
    entityId: String(row[1]),
    jobSlotId: String(row[2]),
    companyId: String(row[3]),
    wage: Number(row[4]),
    hiredAtTick: Number(row[5]),
    status: row[6] as Employment['status'],
    terminatedAtTick: row[7] === null ? null : Number(row[7]),
  };
}

// A worker holds at most one active job at a time (v1 simplification — no
// part-time/multiple-employer modeling yet).
export function getActiveEmployment(db: Database, entityId: string): Employment | null {
  const row = queryRow(
    db,
    `SELECT ${EMPLOYMENT_COLUMNS} FROM employment WHERE entity_id = ? AND status = 'active' LIMIT 1`,
    [entityId],
  );
  return row ? rowToEmployment(row) : null;
}

export function getActiveEmploymentForSlot(
  db: Database,
  entityId: string,
  jobSlotId: string,
): Employment | null {
  const row = queryRow(
    db,
    `SELECT ${EMPLOYMENT_COLUMNS} FROM employment
     WHERE entity_id = ? AND job_slot_id = ? AND status = 'active' LIMIT 1`,
    [entityId, jobSlotId],
  );
  return row ? rowToEmployment(row) : null;
}

// §9.8: a job slot can hold more than one worker, up to its capacity —
// callers (the Jobs screen, NPC background hiring) check this before
// attempting to hire rather than relying on applyForJob's hard-stop below.
export function countActiveEmploymentsForSlot(db: Database, jobSlotId: string): number {
  const row = queryRow(db, `SELECT COUNT(*) FROM employment WHERE job_slot_id = ? AND status = 'active'`, [
    jobSlotId,
  ]);
  return Number(row?.[0] ?? 0);
}

export function listActiveEmploymentsForSlot(db: Database, jobSlotId: string): Employment[] {
  return queryRows(
    db,
    `SELECT ${EMPLOYMENT_COLUMNS} FROM employment WHERE job_slot_id = ? AND status = 'active'`,
    [jobSlotId],
  ).map(rowToEmployment);
}

// A haggle attempt costs the applicant nothing on failure (§18: "Harsh ≠
// opaque") — it just never beats the posted wage. §13.2 "each... attempt
// grants XP" generalized from labor-ticks to a haggling attempt.
const HAGGLE_XP = 15;

export interface ApplyForJobOptions {
  haggle: boolean;
  // Defaults to 'personal' — right for the player's own hire (§Stage 3).
  // NPC hiring (§Stage 4) passes 'settlement': a hiring is explicitly a
  // settlement-log category (§14.3), and nothing renders an NPC's
  // "personal" log, so leaving the default would silently swallow it.
  scope?: EventScope;
}

export interface ApplyResult {
  wage: number;
  haggleAttempted: boolean;
  haggleSucceeded: boolean;
  message: string;
}

// §9.8 Staffing & haggling; §11.3 "a green youth takes what's posted." The
// posted wage is always the band's floor — no work-history/reputation
// system exists yet (Stage 8) to justify starting anywhere above it for a
// first-time applicant. Haggling (Trading skill-gated) can move it partway
// toward the ceiling; it never moves it down.
export function applyForJob(
  db: Database,
  bus: EventBus,
  entityId: string,
  jobSlotId: string,
  tick: number,
  options: ApplyForJobOptions,
  rng: () => number,
): ApplyResult {
  const jobSlot = getJobSlot(db, jobSlotId);
  if (!jobSlot) throw new Error(`Unknown job slot: "${jobSlotId}"`);
  if (getActiveEmployment(db, entityId)) {
    throw new Error(`"${entityId}" already has a job — quit first.`);
  }
  if (countActiveEmploymentsForSlot(db, jobSlotId) >= jobSlot.capacity) {
    throw new Error(`"${jobSlotId}" has no open positions.`);
  }
  // §9.6: a closed company doesn't hire — enforced here, not just by
  // listJobOpenings()'s own filter, so every caller (seed content with a
  // hardcoded job-slot list, not just the Jobs screen/job-seeking cadence
  // that already read from listJobOpenings) gets the same guarantee.
  const companyRow = queryRow(db, 'SELECT closed_at_tick FROM companies WHERE id = ?', [jobSlot.companyId]);
  if (companyRow?.[0] !== null && companyRow?.[0] !== undefined) {
    throw new Error(`"${jobSlot.companyId}" has closed and isn't hiring.`);
  }

  let wage = jobSlot.wageMin;
  let haggleSucceeded = false;
  if (options.haggle) {
    addXp(db, entityId, TRADING_SKILL, HAGGLE_XP);
    haggleSucceeded = rng() < getSuccessChance(db, entityId, TRADING_SKILL);
    if (haggleSucceeded) {
      wage = jobSlot.wageMin + Math.ceil((jobSlot.wageMax - jobSlot.wageMin) / 2);
    }
  }

  db.run(
    `INSERT INTO employment (entity_id, job_slot_id, company_id, wage, hired_at_tick, status)
     VALUES (?, ?, ?, ?, ?, 'active')`,
    [entityId, jobSlotId, jobSlot.companyId, wage, tick],
  );

  const message = !options.haggle
    ? `${jobSlot.companyName} takes you on as ${jobSlot.title} at the posted ${wage} coin a shift.`
    : haggleSucceeded
      ? `${jobSlot.companyName} takes you on as ${jobSlot.title} — you talk them up to ${wage} coin a shift.`
      : `${jobSlot.companyName} takes you on as ${jobSlot.title} at ${wage} coin a shift — your haggling gets you nowhere.`;

  bus.emit({
    tick,
    scope: options.scope ?? 'personal',
    actorId: entityId,
    type: 'job.hired',
    message,
    data: { jobSlotId, companyId: jobSlot.companyId, wage, haggleAttempted: options.haggle, haggleSucceeded },
  });
  bus.emit({
    tick,
    scope: 'business',
    actorId: jobSlot.companyId,
    type: 'job.filled',
    message: `${jobSlot.companyName} hires a new ${jobSlot.title} at ${wage} coin a shift.`,
    data: { entityId, jobSlotId, wage },
  });

  return { wage, haggleAttempted: options.haggle, haggleSucceeded, message };
}

export interface QuitJobOptions {
  // Defaults to 'personal' (§Stage 3's player-initiated quit). §Stage 4's
  // scripted job loss passes 'settlement' — a job ending is exactly the
  // kind of NPC life event §14.3 names for that log.
  scope?: EventScope;
  // Overrides the default "You leave..." wording — §Stage 4 uses this for
  // an involuntary dismissal, which reads nothing like a voluntary quit.
  message?: string;
}

export function quitJob(
  db: Database,
  bus: EventBus,
  entityId: string,
  tick: number,
  options: QuitJobOptions = {},
): void {
  const employment = getActiveEmployment(db, entityId);
  if (!employment) return;

  db.run(`UPDATE employment SET status = 'terminated', terminated_at_tick = ? WHERE id = ?`, [
    tick,
    employment.id,
  ]);

  const jobSlot = getJobSlot(db, employment.jobSlotId);
  const defaultMessage = jobSlot
    ? `You leave your position at ${jobSlot.companyName}.`
    : 'You leave your position.';
  bus.emit({
    tick,
    scope: options.scope ?? 'personal',
    actorId: entityId,
    type: 'job.quit',
    message: options.message ?? defaultMessage,
    data: { jobSlotId: employment.jobSlotId },
  });
}

// §9.6 "permanent failure": a closing company lets every worker go at once
// — companies/decisions.ts's tryCloseCompany is the only caller. Reuses
// quitJob per entity (same event shape/log category as any other
// dismissal) rather than a bespoke bulk-update, so a laid-off worker shows
// up in the settlement log exactly like Stage 4's scripted job-loss test
// already expects.
export function terminateAllEmploymentsForCompany(
  db: Database,
  bus: EventBus,
  companyId: string,
  tick: number,
  message: string,
): void {
  for (const slot of listJobSlotsForCompany(db, companyId)) {
    for (const employment of listActiveEmploymentsForSlot(db, slot.id)) {
      quitJob(db, bus, employment.entityId, tick, { scope: 'settlement', message });
    }
  }
}
