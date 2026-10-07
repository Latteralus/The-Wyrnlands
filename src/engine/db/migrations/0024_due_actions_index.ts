import type { Migration } from './types';

export const migration_0024_due_actions_index: Migration = {
  id: '0024_due_actions_index',
  up: `
    -- Due-driven action processing (actions/actionQueue.ts's
    -- listActorsWithDueActions; Documents/ScheduledActivityPlan.md §3):
    -- each tick finds only the actors whose action ends now (or who have
    -- one waiting to start), rather than visiting every actor with any open
    -- action. Indexes over just the open rows, by end tick and by actor, so
    -- the lookup costs what happens this minute, not how many actors are
    -- mid-activity.
    --
    -- Every in-progress action has always been given its end tick when it
    -- started; this only guards a hand-edited or partial row.
    UPDATE actions SET ends_at_tick = started_at_tick + duration_ticks
      WHERE status = 'in_progress' AND ends_at_tick IS NULL;

    CREATE INDEX idx_actions_in_progress_due ON actions (ends_at_tick) WHERE status = 'in_progress';
    CREATE INDEX idx_actions_queued_actor ON actions (actor_id) WHERE status = 'queued';
  `,
};
