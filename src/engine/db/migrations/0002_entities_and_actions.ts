import type { Migration } from './types';

export const migration_0002_entities_and_actions: Migration = {
  id: '0002_entities_and_actions',
  up: `
    -- Minimal for now: id + name. Household, portrait, skills, traits, etc.
    -- (MASTERPLAN.md §16) arrive as their own modules land.
    CREATE TABLE entities (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL
    );

    -- Every timed action (§4.3): work shifts, gathering, resting, travel, ...
    -- One actor has at most one 'in_progress' row at a time; 'queued' rows
    -- behind it form that actor's committed action chain.
    CREATE TABLE actions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_id TEXT NOT NULL REFERENCES entities (id),
      type TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('queued', 'in_progress', 'complete', 'failed', 'interrupted')),
      queued_at_tick INTEGER NOT NULL,
      started_at_tick INTEGER,
      ends_at_tick INTEGER,
      duration_ticks INTEGER NOT NULL,
      progress_ticks INTEGER NOT NULL DEFAULT 0,
      outcome TEXT,
      sequence INTEGER NOT NULL
    );

    CREATE INDEX idx_actions_actor_sequence ON actions (actor_id, sequence);
    CREATE INDEX idx_actions_status ON actions (status);
  `,
};
