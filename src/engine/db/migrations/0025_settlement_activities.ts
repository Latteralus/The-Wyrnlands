import type { Migration } from './types';

export const migration_0025_settlement_activities: Migration = {
  id: '0025_settlement_activities',
  up: `
    ALTER TABLE actions ADD COLUMN payload TEXT;
    ALTER TABLE actions ADD COLUMN transient INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE entities ADD COLUMN current_site_id TEXT REFERENCES sites(id);
    ALTER TABLE market_listings ADD COLUMN price_adjustment REAL NOT NULL DEFAULT 0;
    CREATE TABLE settlement_activity_state (
      actor_id TEXT PRIMARY KEY REFERENCES entities(id),
      last_shift_day INTEGER,
      last_meal_day INTEGER,
      fed_day INTEGER,
      last_rest_day INTEGER,
      last_visit_day INTEGER,
      last_budget_day INTEGER,
      last_distress_day INTEGER,
      offered_job_slot_id TEXT REFERENCES job_slots(id),
      offered_for_hardship INTEGER NOT NULL DEFAULT 0,
      last_supply_tick INTEGER NOT NULL DEFAULT -1440,
      last_delivery_tick INTEGER NOT NULL DEFAULT -1440
    );
    CREATE INDEX idx_entities_current_site ON entities(current_site_id);
    CREATE UNIQUE INDEX idx_actions_one_running ON actions(actor_id) WHERE status = 'in_progress';
  `,
};
