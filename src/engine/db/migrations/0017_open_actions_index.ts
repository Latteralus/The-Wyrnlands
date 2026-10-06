import type { Migration } from './types';

export const migration_0017_open_actions_index: Migration = {
  id: '0017_open_actions_index',
  up: `
    -- The dominant long-run cost, measured rather than guessed (see
    -- PERFORMANCE_AUDIT.md): actionQueue.ts's getCurrentAction — "this
    -- actor's first queued/in-progress action by sequence" — ran several
    -- times every tick, and SQLite answered it via idx_actions_actor_sequence,
    -- walking the actor's ENTIRE action history in sequence order (checking
    -- each row's status) until it reached the one unresolved row at the end.
    -- Per-call cost grew linearly with history (47us at 292 actions, 1,002us
    -- at 9,296), making a long run quadratic overall: 89% of all wall-clock
    -- time by day 90.
    --
    -- A partial index over only the open rows stays a handful of entries
    -- forever, however much history accumulates. SQLite uses it for any
    -- query whose WHERE implies status IN ('queued', 'in_progress') —
    -- getCurrentAction, listActiveActions, processActiveActions' "which
    -- actors have work" scan, and needs.ts's collapse-recovery EXISTS check.
    -- Completed/failed/cancelled history stays in the same table, untouched
    -- and fully queryable (listActorActions, the action log).
    CREATE INDEX idx_actions_open_actor_sequence ON actions (actor_id, sequence)
      WHERE status IN ('queued', 'in_progress');

    -- jobs.ts's countActiveEmploymentsForSlot/listActiveEmploymentsForSlot
    -- (job-seeking, weekly labor, company growth/closure, immigration) were
    -- full scans of employment, which only ever grows (terminated rows are
    -- kept as job history).
    CREATE INDEX idx_employment_slot_status ON employment (job_slot_id, status);
  `,
};
