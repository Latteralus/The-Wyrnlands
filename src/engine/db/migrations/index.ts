import { migration_0001_init } from './0001_init';
import { migration_0002_entities_and_actions } from './0002_entities_and_actions';
import { migration_0003_sites } from './0003_sites';
import { migration_0004_inventory_and_audit } from './0004_inventory_and_audit';
import type { Migration } from './types';

export type { Migration };

// Ordered oldest-first; applyMigrations() applies whichever of these
// a given DB hasn't recorded in schema_migrations yet.
export const migrations: Migration[] = [
  migration_0001_init,
  migration_0002_entities_and_actions,
  migration_0003_sites,
  migration_0004_inventory_and_audit,
];
