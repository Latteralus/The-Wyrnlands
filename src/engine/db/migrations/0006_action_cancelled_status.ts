import type { Migration } from './types';

export const migration_0006_action_cancelled_status: Migration = {
  id: '0006_action_cancelled_status',
  up: `
    -- 0002's actions.status CHECK constraint never included 'cancelled',
    -- even though ActionStatus (actions/types.ts) grew that value for
    -- cancelQueuedActions (§Stage 2 collapse handling — §6). Every collapse
    -- with a queued action behind the current one hit this CHECK constraint
    -- violation, which corrupted the connection badly enough that a later,
    -- unrelated query would crash with a wasm "memory access out of bounds"
    -- — the actual constraint error was real, catchable, and immediate;
    -- what followed was a side effect of leaving the DB in that state and
    -- continuing to use it. SQLite has no ALTER TABLE for CHECK constraints,
    -- so this recreates the table (§19: "schema changes via migrations
    -- only" — fixing 0002 in place instead would rewrite already-applied
    -- history for any existing save).
    CREATE TABLE actions_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_id TEXT NOT NULL REFERENCES entities (id),
      type TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('queued', 'in_progress', 'complete', 'failed', 'interrupted', 'cancelled')),
      queued_at_tick INTEGER NOT NULL,
      started_at_tick INTEGER,
      ends_at_tick INTEGER,
      duration_ticks INTEGER NOT NULL,
      progress_ticks INTEGER NOT NULL DEFAULT 0,
      outcome TEXT,
      sequence INTEGER NOT NULL
    );

    INSERT INTO actions_new SELECT id, actor_id, type, status, queued_at_tick, started_at_tick, ends_at_tick, duration_ticks, progress_ticks, outcome, sequence FROM actions;

    DROP TABLE actions;
    ALTER TABLE actions_new RENAME TO actions;

    CREATE INDEX idx_actions_actor_sequence ON actions (actor_id, sequence);
    CREATE INDEX idx_actions_status ON actions (status);
  `,
};
