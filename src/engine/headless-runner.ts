import { createDatabase } from './db/sqlite';
import { loadSqlJs } from './db/sqlite.node';
import { Engine } from './engine';

const TICKS = 10_000;

async function main() {
  const seed = process.argv[2] ?? 'headless-dev-seed';
  const SQL = await loadSqlJs();
  const db = createDatabase(SQL);
  const engine = Engine.bootstrap(db, { seed });

  const start = Date.now();
  engine.advanceTicks(TICKS);
  const elapsedMs = Date.now() - start;

  console.log(`Advanced ${TICKS} ticks -> tick=${engine.tick} in ${elapsedMs}ms (seed="${seed}")`);
  console.log('Calendar:', engine.calendar);
  console.log('World log:', engine.queryLog('world', 5));

  engine.dispose();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
