import type { Migration } from './types';

export const migration_0007_jobs_and_companies: Migration = {
  id: '0007_jobs_and_companies',
  up: `
    -- §9 Businesses & Companies. A company is an entity (so it can own a
    -- wallet and hold items in its own inventory, same as a person) plus
    -- these business-specific fields. NPC-run for now — player-owned
    -- companies with full ledger/upgrade screens arrive Stage 6 (§9.1).
    CREATE TABLE companies (
      id TEXT PRIMARY KEY REFERENCES entities (id),
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      site_id TEXT NOT NULL REFERENCES sites (id)
    );

    -- §9.8 job slots: the posted wage band, hours, skill ask, and the
    -- company-owned tool (§9.4) a worker needs to do the job. IDs are
    -- code-assigned TEXT (like sites.id), not autoincrement, so seed code
    -- can register the matching work_shift_<id> action type unconditionally
    -- on every fresh Engine, before world content exists to look it up —
    -- the same reason buy_<good>/sell_<good> actions are keyed by fixed
    -- strings rather than DB ids (market.ts; see DECISIONS.md's Stage 2
    -- entry on registerDemoActionTypes running before world-content seeding).
    CREATE TABLE job_slots (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies (id),
      title TEXT NOT NULL,
      skill TEXT NOT NULL,
      wage_min INTEGER NOT NULL,
      wage_max INTEGER NOT NULL,
      shift_duration_ticks INTEGER NOT NULL,
      tool_good_type TEXT
    );

    -- One active row per (entity, job_slot); wage is fixed at hire (§9.8:
    -- "labor inertia... nobody quits over one coin" — mid-tenure
    -- renegotiation is a later refinement, not v1).
    CREATE TABLE employment (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_id TEXT NOT NULL REFERENCES entities (id),
      job_slot_id TEXT NOT NULL REFERENCES job_slots (id),
      company_id TEXT NOT NULL REFERENCES companies (id),
      wage INTEGER NOT NULL,
      hired_at_tick INTEGER NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('active', 'terminated')),
      terminated_at_tick INTEGER
    );

    CREATE INDEX idx_employment_entity_status ON employment (entity_id, status);
  `,
};
