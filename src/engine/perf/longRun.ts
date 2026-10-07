import { createHash } from 'node:crypto';
import { rmSync, writeFileSync } from 'node:fs';
import { registerGameActions } from '../actions/gameActions';
import { createDatabase, queryRow, queryRows, type Database } from '../db/sqlite';
import { NativeDatabase } from '../db/sqlite.native';
import { loadFreshSqlJs, loadSqlJs } from '../db/sqlite.node';
import { Engine } from '../engine';
import { getGoodDefinition } from '../goods/catalog';
import { createNewGame } from '../player/newGame';
import {
  collectEconomySnapshot,
  economySnapshotsToCsv,
  summarizeEconomyRun,
  type EconomySnapshot,
} from '../reports/economySnapshot';
import { collectEntrepreneurshipReport, formatEntrepreneurshipReport } from '../reports/entrepreneurship';
import { runScriptedPlayerUntil } from '../scenarios/scriptedPlayer';
import { seedDemoWorld } from '../seed/demoWorld';
import { MINUTES_PER_DAY } from '../time/clock';
import { canonicalState } from './benchmark';
import { PhaseTimer } from './phaseTimer';
import { attachSqlProfiler, type SqlProfiler, type SqlStat } from './sqlProfiler';
import type { PhaseStat } from './phaseTimer';

// The long-run performance harness (`npm run sim:perf -- [flags]`). Node-only
// (it reads process memory and writes a report file) — the engine itself
// stays platform-neutral; this is measurement tooling around it.
//
// Runs the real seeded demo world (every NPC household, company, market,
// production chain, audit — nothing disabled) for N in-game days, sampling
// every S days: wall-clock per interval, row counts per major table, DB
// size, process memory, checkpoint cost, per-phase engine time, and the
// most expensive SQL statements of the interval (with per-call averages, so
// a query whose per-call cost grows with history is visible directly).
//
// Flags:
//   --days N          simulated days (default 90)
//   --sample S        sample interval in days (default 15)
//   --checkpoint C    checkpoint interval in days, 0 = never (default 15)
//   --seed X          world seed (default 'perf-baseline')
//   --named-player    create the typed named-player household instead of the legacy fixture
//   --no-player       run the world only, no scripted player
//   --no-profile      skip SQL/phase profiling (pure wall-clock)
//   --top K           SQL statements to report per sample (default 8)
//   --out FILE        write the full JSON report here
//   --econ PREFIX     also collect an economy snapshot (reports/
//                     economySnapshot.ts) every sample; writes PREFIX.csv
//                     and PREFIX.json
//   --backend B       sqljs (default) or native (node:sqlite — needs Node
//                     22.16+/24, e.g. npm run sim:perf:electron)
//   --db-file FILE    native only: run on a file-backed database (WAL), as
//                     the desktop game does; otherwise in memory
//   --commit day      one transaction per simulated day (the game commits
//                     once per batch of ticks); default: whatever each
//                     engine call commits — every scripted action is its
//                     own transaction
//
// Every run ends by printing a logical state fingerprint (a hash over
// wallets, items, employment, companies, households, needs, listings, row
// counts and RNG state — not raw DB bytes, which legitimately differ
// between physical write histories). Two runs of the same seed must print
// the same fingerprint whatever their checkpoint interval.

interface Options {
  days: number;
  sampleDays: number;
  checkpointDays: number;
  seed: string;
  player: boolean;
  namedPlayer: boolean;
  profile: boolean;
  top: number;
  out: string | null;
  econ: string | null;
  backend: 'sqljs' | 'native';
  dbFile: string | null;
  commitPerDay: boolean;
}

function parseArgs(argv: string[]): Options {
  const opts: Options = {
    days: 90,
    sampleDays: 15,
    checkpointDays: 15,
    seed: 'perf-baseline',
    player: true,
    namedPlayer: false,
    profile: true,
    top: 8,
    out: null,
    econ: null,
    backend: 'sqljs',
    dbFile: null,
    commitPerDay: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const next = () => {
      const value = argv[++i];
      if (value === undefined) throw new Error(`Missing value for ${flag}`);
      return value;
    };
    switch (flag) {
      case '--days':
        opts.days = Number(next());
        break;
      case '--sample':
        opts.sampleDays = Number(next());
        break;
      case '--checkpoint':
        opts.checkpointDays = Number(next());
        break;
      case '--seed':
        opts.seed = next();
        break;
      case '--named-player':
        opts.namedPlayer = true;
        break;
      case '--no-player':
        opts.player = false;
        break;
      case '--no-profile':
        opts.profile = false;
        break;
      case '--top':
        opts.top = Number(next());
        break;
      case '--out':
        opts.out = next();
        break;
      case '--econ':
        opts.econ = next();
        break;
      case '--backend': {
        const backend = next();
        if (backend !== 'sqljs' && backend !== 'native') throw new Error(`Unknown backend: ${backend}`);
        opts.backend = backend;
        break;
      }
      case '--db-file':
        opts.dbFile = next();
        break;
      case '--commit': {
        const unit = next();
        if (unit !== 'day') throw new Error(`Unknown commit unit: ${unit}`);
        opts.commitPerDay = true;
        break;
      }
      default:
        throw new Error(`Unknown flag: ${flag}`);
    }
  }
  return opts;
}

const COUNTED_TABLES = [
  'event_log',
  'provenance_events',
  'items',
  'actions',
  'company_ledger_entries',
  'employment',
  'audits',
  'entities',
] as const;

interface Sample {
  day: number;
  intervalMs: number;
  cumulativeMs: number;
  msPerSimDay: number;
  rows: Record<string, number>;
  activeItems: number;
  dbBytes: number;
  rssMb: number;
  heapUsedMb: number;
  externalMb: number;
  auditsFailed: number;
  checkpoint: { exportMs: number; reloadMs: number; bytes: number } | null;
  phases: PhaseStat[];
  topSql: (SqlStat & { avgUs: number })[];
}

function countRows(engine: Engine): { rows: Record<string, number>; activeItems: number } {
  const rows: Record<string, number> = {};
  for (const table of COUNTED_TABLES) {
    rows[table] = Number(queryRow(engine.db, `SELECT COUNT(*) FROM ${table}`)?.[0] ?? 0);
  }
  const activeItems = Number(
    queryRow(engine.db, "SELECT COUNT(*) FROM items WHERE status = 'active'")?.[0] ?? 0,
  );
  return { rows, activeItems };
}

function dbBytes(engine: Engine): number {
  const pages = Number(queryRow(engine.db, 'PRAGMA page_count')?.[0] ?? 0);
  const pageSize = Number(queryRow(engine.db, 'PRAGMA page_size')?.[0] ?? 0);
  return pages * pageSize;
}

const mb = (bytes: number) => Math.round((bytes / 1024 / 1024) * 10) / 10;

// The logical-state fingerprint (perf/benchmark.ts's canonicalState(): RNG
// state synced first).
function stateFingerprint(engine: Engine): string {
  return createHash('sha256').update(canonicalState(engine)).digest('hex').slice(0, 16);
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  console.log(
    `Long-run harness (${opts.backend}${opts.dbFile ? ` file ${opts.dbFile}` : ''}, Node ${process.versions.node}${opts.commitPerDay ? ', one commit per day' : ''}): ${opts.days} days, sample every ${opts.sampleDays}, checkpoint every ${opts.checkpointDays || 'never'}, seed "${opts.seed}", player ${opts.player ? 'scripted' : 'none'}, profiling ${opts.profile ? 'on' : 'off'}`,
  );

  const SQL = await loadSqlJs();
  if (opts.dbFile && opts.backend !== 'native') throw new Error('--db-file needs --backend native');
  if (opts.dbFile)
    for (const suffix of ['', '-wal', '-shm']) rmSync(`${opts.dbFile}${suffix}`, { force: true });
  const openDatabase = (): Database =>
    opts.backend === 'sqljs'
      ? createDatabase(SQL)
      : new NativeDatabase(opts.dbFile ?? ':memory:', { durable: opts.dbFile !== null });
  let engine = opts.namedPlayer
    ? createNewGame(openDatabase(), {
        world: { seed: opts.seed },
        character: { firstName: 'Edda', lastName: 'Hale', preset: 'standard' },
      })
    : Engine.bootstrap(openDatabase(), { seed: opts.seed });
  if (!opts.namedPlayer) seedDemoWorld(engine);

  const phaseTimer = new PhaseTimer();
  const profiling: { sql: SqlProfiler | null } = { sql: null };
  const instrument = (e: Engine) => {
    if (!opts.profile) return;
    e.phaseTimer = phaseTimer;
    profiling.sql = attachSqlProfiler(e.db);
  };
  instrument(engine);

  const samples: Sample[] = [];
  const econSnapshots: EconomySnapshot[] = [];
  const runStart = performance.now();
  let lastCheckpointDay = 0;

  for (let sampleIndex = 1; sampleIndex <= Math.ceil(opts.days / opts.sampleDays); sampleIndex++) {
    const day = Math.min(sampleIndex * opts.sampleDays, opts.days);
    const intervalDays = day - (samples.at(-1)?.day ?? 0);
    const intervalStart = performance.now();
    runScriptedPlayerUntil(engine, day * MINUTES_PER_DAY, {
      player: opts.player,
      commitDaily: opts.commitPerDay,
    });
    const intervalMs = performance.now() - intervalStart;

    // Read the profilers before the measurement queries below pollute them.
    const phases = phaseTimer.snapshot();
    const topSql = (profiling.sql?.snapshot() ?? []).slice(0, opts.top).map((s) => ({
      ...s,
      avgUs: Math.round((s.totalMs / s.calls) * 1000 * 10) / 10,
    }));

    const { rows, activeItems } = countRows(engine);
    const bytes = dbBytes(engine);
    const mem = process.memoryUsage();
    const auditsFailed = Number(
      queryRow(engine.db, 'SELECT COUNT(*) FROM audits WHERE passed = 0')?.[0] ?? 0,
    );
    if (opts.econ) {
      const econ = collectEconomySnapshot(
        engine.db,
        engine.tick,
        intervalDays * MINUTES_PER_DAY,
        MINUTES_PER_DAY,
      );
      econSnapshots.push(econ);
      console.log(
        `    econ: pop ${econ.population} (employed ${econ.employed}) households ${econ.households} (+${econ.householdsArrived} arrived, -${econ.householdsDeparted} left) | ` +
          `unfed ${econ.peopleUnfed} hungry-days ${econ.hungryHouseholdDaysInWindow} destitute ${econ.householdsDestitute} | wealth median ${econ.householdWealthMedian} total ${econ.householdWealthTotal} | coin ${econ.totalCoin} | ` +
          `firms ${econ.companies.map((c) => `${c.id.split('_')[0]}:${c.status[0]}${c.employees}/${c.capacity}$${c.cash}`).join(' ')} | ` +
          `bread ${econ.prices.bread ?? '-'}c x${econ.marketQuantity.bread ?? 0} imported ${econ.merchantImportsInWindow.bread ?? 0} spoiled ${econ.spoiledInWindow.bread ?? 0} | ` +
          `wages ${econ.wagesInWindow} draws ${econ.ownerDrawsInWindow} parish ${econ.parishFund} | ` +
          `faucets ${JSON.stringify(econ.faucetsInWindow)} sinks ${JSON.stringify(econ.sinksInWindow)} exported ${JSON.stringify(econ.exportedInWindow)}`,
      );
    }

    let checkpoint: Sample['checkpoint'] = null;
    if (opts.checkpointDays > 0 && day - lastCheckpointDay >= opts.checkpointDays && day < opts.days) {
      // Same steps as checkpoint.ts's checkpointEngine(), split apart so
      // serialization and fresh-module rehydration are timed separately.
      profiling.sql?.detach();
      const exportStart = performance.now();
      const exported = engine.export();
      const exportMs = performance.now() - exportStart;
      const reloadStart = performance.now();
      engine.dispose();
      engine = Engine.bootstrap(
        opts.backend === 'sqljs'
          ? createDatabase(await loadFreshSqlJs(), exported)
          : NativeDatabase.fromBytes(exported),
        { seed: opts.seed },
      );
      registerGameActions(engine); // registration only; checkpoints never seed world content
      const reloadMs = performance.now() - reloadStart;
      instrument(engine);
      checkpoint = {
        exportMs: Math.round(exportMs),
        reloadMs: Math.round(reloadMs),
        bytes: exported.length,
      };
      lastCheckpointDay = day;
    }

    const sample: Sample = {
      day,
      intervalMs: Math.round(intervalMs),
      cumulativeMs: Math.round(performance.now() - runStart),
      msPerSimDay: Math.round(intervalMs / intervalDays),
      rows,
      activeItems,
      dbBytes: bytes,
      rssMb: mb(mem.rss),
      heapUsedMb: mb(mem.heapUsed),
      externalMb: mb(mem.external),
      auditsFailed,
      checkpoint,
      phases,
      topSql,
    };
    samples.push(sample);
    phaseTimer.reset();
    profiling.sql?.reset();

    console.log(
      `day ${String(day).padStart(4)} | interval ${String(sample.intervalMs).padStart(7)}ms (${String(sample.msPerSimDay).padStart(5)}ms/day) | ` +
        `events ${rows.event_log} prov ${rows.provenance_events} items ${rows.items} (active ${activeItems}) actions ${rows.actions} ledger ${rows.company_ledger_entries} | ` +
        `db ${mb(bytes)}MB rss ${sample.rssMb}MB | audits failed ${auditsFailed}` +
        (checkpoint ? ` | ckpt export ${checkpoint.exportMs}ms reload ${checkpoint.reloadMs}ms` : ''),
    );
    if (opts.profile) {
      console.log(
        '    phases: ' +
          phases
            .slice(0, 6)
            .map((p) => `${p.phase}=${Math.round(p.totalMs)}ms`)
            .join(' '),
      );
      for (const s of topSql.slice(0, opts.top)) {
        console.log(
          `    ${String(Math.round(s.totalMs)).padStart(7)}ms ${String(s.calls).padStart(8)} calls ${String(s.avgUs).padStart(8)}us  ${s.sql.slice(0, 110)}`,
        );
      }
    }
  }

  const totalMs = Math.round(performance.now() - runStart);
  console.log(
    `\nTotal: ${totalMs}ms for ${opts.days} days (${Math.round(totalMs / opts.days)}ms/day average)`,
  );
  const finalAudit = engine.runConservationAudit();
  console.log(`Final conservation audit: ${finalAudit.passed ? 'PASSED' : 'FAILED'}`, finalAudit);
  const fingerprint = stateFingerprint(engine);
  console.log(`State fingerprint: ${fingerprint}`);
  for (const line of formatEntrepreneurshipReport(collectEntrepreneurshipReport(engine.db, engine.tick)))
    console.log(line);
  const eventMix = queryRows(
    engine.db,
    'SELECT scope, type, COUNT(*) AS n FROM event_log GROUP BY scope, type ORDER BY n DESC LIMIT 12',
  );
  console.log('Largest event_log categories (scope/type: rows):');
  for (const [scope, type, n] of eventMix) console.log(`    ${String(scope)}/${String(type)}: ${Number(n)}`);

  if (opts.econ) {
    const verdict = summarizeEconomyRun(econSnapshots, getGoodDefinition('bread').basePrice);
    if (verdict) {
      console.log('Economy verdict:');
      for (const c of verdict.checks)
        console.log(`    [${c.passed ? 'PASS' : 'MISS'}] ${c.name}: ${c.detail}`);
      console.log(
        `    migration: +${verdict.householdsArrived} households arrived, -${verdict.householdsDeparted} left; bread price ${verdict.breadPriceMin}-${verdict.breadPriceMax}; closed businesses ${verdict.businessesClosedAtEnd}`,
      );
    }
    writeFileSync(`${opts.econ}.csv`, economySnapshotsToCsv(econSnapshots));
    writeFileSync(`${opts.econ}.json`, JSON.stringify(econSnapshots, null, 2));
    console.log(`Economy report written to ${opts.econ}.csv / .json`);
  }

  if (opts.out) {
    writeFileSync(
      opts.out,
      JSON.stringify({ options: opts, totalMs, finalAudit, fingerprint, samples }, null, 2),
    );
    console.log(`Report written to ${opts.out}`);
  }
  engine.dispose();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
