import type { Migration } from './types';

export const migration_0001_init: Migration = {
  id: '0001_init',
  up: `
    CREATE TABLE world_meta (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      tick INTEGER NOT NULL DEFAULT 0,
      rng_seed TEXT NOT NULL,
      scenario_roll TEXT,
      schema_version INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE event_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tick INTEGER NOT NULL,
      scope TEXT NOT NULL CHECK (scope IN ('personal', 'business', 'settlement', 'world')),
      actor_id TEXT,
      type TEXT NOT NULL,
      message TEXT NOT NULL,
      data TEXT
    );

    CREATE INDEX idx_event_log_scope_tick ON event_log (scope, tick);
  `,
};
