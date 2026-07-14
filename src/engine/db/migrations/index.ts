import { migration_0001_init } from './0001_init';
import { migration_0002_entities_and_actions } from './0002_entities_and_actions';
import type { Migration } from './types';

export type { Migration };

// Ordered oldest-first; applyMigrations() applies whichever of these
// a given DB hasn't recorded in schema_migrations yet.
export const migrations: Migration[] = [migration_0001_init, migration_0002_entities_and_actions];
