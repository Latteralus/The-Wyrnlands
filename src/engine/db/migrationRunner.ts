import type { Database } from 'sql.js';
import { migrations } from './migrations';

export function applyMigrations(db: Database): string[] {
  // No wall-clock timestamp here: same DB + same seed must export identical
  // bytes (MASTERPLAN.md §4.2), and "when" a migration ran isn't simulation
  // state — git history already tells that story.
  db.run(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY
    );
  `);

  const appliedRows = db.exec('SELECT id FROM schema_migrations');
  const applied = new Set(appliedRows[0]?.values.map((row) => String(row[0])) ?? []);

  const newlyApplied: string[] = [];
  for (const migration of migrations) {
    if (applied.has(migration.id)) continue;
    db.run(migration.up);
    db.run('INSERT INTO schema_migrations (id) VALUES (?)', [migration.id]);
    newlyApplied.push(migration.id);
  }

  return newlyApplied;
}
