import { migration_0001_init } from './0001_init';
import { migration_0002_entities_and_actions } from './0002_entities_and_actions';
import { migration_0003_sites } from './0003_sites';
import { migration_0004_inventory_and_audit } from './0004_inventory_and_audit';
import { migration_0005_survival } from './0005_survival';
import { migration_0006_action_cancelled_status } from './0006_action_cancelled_status';
import { migration_0007_jobs_and_companies } from './0007_jobs_and_companies';
import { migration_0008_npcs_and_households } from './0008_npcs_and_households';
import { migration_0009_rng_state } from './0009_rng_state';
import { migration_0010_production_chains } from './0010_production_chains';
import { migration_0011_company_growth } from './0011_company_growth';
import { migration_0012_company_closure } from './0012_company_closure';
import { migration_0013_items_container_type_index } from './0013_items_container_type_index';
import { migration_0014_event_log_actor_index } from './0014_event_log_actor_index';
import { migration_0015_rolled_starting_conditions } from './0015_rolled_starting_conditions';
import type { Migration } from './types';

export type { Migration };

// Ordered oldest-first; applyMigrations() applies whichever of these
// a given DB hasn't recorded in schema_migrations yet.
export const migrations: Migration[] = [
  migration_0001_init,
  migration_0002_entities_and_actions,
  migration_0003_sites,
  migration_0004_inventory_and_audit,
  migration_0005_survival,
  migration_0006_action_cancelled_status,
  migration_0007_jobs_and_companies,
  migration_0008_npcs_and_households,
  migration_0009_rng_state,
  migration_0010_production_chains,
  migration_0011_company_growth,
  migration_0012_company_closure,
  migration_0013_items_container_type_index,
  migration_0014_event_log_actor_index,
  migration_0015_rolled_starting_conditions,
];
