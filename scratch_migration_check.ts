import { createDatabase } from './src/engine/db/sqlite';
import { loadSqlJs } from './src/engine/db/sqlite.node';
import { Engine } from './src/engine/engine';
import { seedDemoWorld } from './src/engine/seed/demoWorld';
import { MINUTES_PER_DAY } from './src/engine/time/clock';

async function main() {
  const SQL = await loadSqlJs();
  const db = createDatabase(SQL);
  const engine = Engine.bootstrap(db, { seed: 'migration-real-check' });
  seedDemoWorld(engine);

  const days = 90;
  const start = Date.now();
  engine.advanceTicks(days * MINUTES_PER_DAY);
  console.log(`Ran ${days} days in ${Date.now() - start}ms`);

  const households = engine.listHouseholds();
  const departed = households.filter((h) => h.departedAtTick !== null);
  const arrived = households.filter((h) => h.id.startsWith('household-immigrant-'));
  console.log(`Total households: ${households.length}`);
  console.log(`Departed (emigrated): ${departed.map((h) => `${h.name} @ tick ${h.departedAtTick}`).join(', ') || 'none'}`);
  console.log(`Immigrant-origin households: ${arrived.map((h) => h.name).join(', ') || 'none'}`);

  const migrationEvents = engine
    .queryLog('settlement', 2000)
    .filter((e) => e.type.startsWith('household.migration.'));
  console.log(`Migration events logged: ${migrationEvents.length}`);
  for (const e of migrationEvents) console.log(`  [${e.tick}] ${e.message}`);

  engine.dispose();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
