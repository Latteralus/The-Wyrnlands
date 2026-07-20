import type { Migration } from './types';

export const migration_0014_event_log_actor_index: Migration = {
  id: '0014_event_log_actor_index',
  up: `
    -- §14.3 "Business logs (the ledger as narrative)": the new business-view
    -- screen queries event_log by actor_id (a company's whole history,
    -- across both 'business' and 'settlement' scopes) rather than by scope
    -- alone, a query shape event_log had no index for. Added proactively
    -- this time, not found the hard way like items(container_id, type,
    -- status) was (migration 0013) — same lesson applied before shipping.
    CREATE INDEX idx_event_log_actor ON event_log (actor_id);
  `,
};
