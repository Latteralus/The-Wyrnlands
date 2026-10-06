import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { createDatabase, queryRow, queryRows } from '../db/sqlite';
import { loadFreshSqlJs, loadSqlJs } from '../db/sqlite.node';
import { Engine } from '../engine';
import { getGoodDefinition } from '../goods/catalog';
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
//   --no-player       run the world only, no scripted player
//   --no-profile      skip SQL/phase profiling (pure wall-clock)
//   --top K           SQL statements to report per sample (default 8)
//   --out FILE        write the full JSON report here
//   --econ PREFIX     also collect an economy snapshot (reports/
//                     economySnapshot.ts) every sample; writes PREFIX.csv
//                     and PREFIX.json
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
  profile: boolean;
  top: number;
  out: string | null;
  econ: string | null;
}

function parseArgs(argv: string[]): Options {
  const opts: Options = {
    days: 90,
    sampleDays: 15,
    checkpointDays: 15,
    seed: 'perf-baseline',
    player: true,
    profile: true,
    top: 8,
    out: null,
    econ: null,
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

// Calls engine.export() first so world_meta.rng_state is current.
function stateFingerprint(engine: Engine): string {
  engine.export();
  const hash = createHash('sha256');
  const canonical = [
    'SELECT owner_id, balance FROM wallets ORDER BY owner_id',
    'SELECT id, type, quality_tier, container_id, status, durability, destroyed_at_tick FROM items ORDER BY id',
    'SELECT entity_id, job_slot_id, wage, hired_at_tick, status, terminated_at_tick FROM employment ORDER BY id',
    'SELECT id, owner_id, insolvent_since_tick, tier, closed_at_tick FROM companies ORDER BY id',
    'SELECT id, destitute_since_tick, departed_at_tick FROM households ORDER BY id',
    'SELECT entity_id, ROUND(hunger, 6), ROUND(thirst, 6), ROUND(energy, 6), ROUND(warmth, 6) FROM needs ORDER BY entity_id',
    'SELECT entity_id, skill, xp FROM skills ORDER BY entity_id, skill',
    'SELECT site_id, good_type, price, quantity, producer_company_id FROM market_listings ORDER BY site_id, good_type',
    'SELECT (SELECT COUNT(*) FROM event_log), (SELECT COUNT(*) FROM provenance_events), (SELECT COUNT(*) FROM actions), (SELECT COUNT(*) FROM company_ledger_entries)',
    'SELECT tick, rng_state, goods_created, goods_destroyed, coin_faucet_total, coin_sink_total FROM world_meta',
  ];
  for (const sql of canonical) hash.update(JSON.stringify(queryRows(engine.db, sql)));
  return hash.digest('hex').slice(0, 16);
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  console.log(
    `Long-run harness: ${opts.days} days, sample every ${opts.sampleDays}, checkpoint every ${opts.checkpointDays || 'never'}, seed "${opts.seed}", player ${opts.player ? 'scripted' : 'none'}, profiling ${opts.profile ? 'on' : 'off'}`,
  );

  const SQL = await loadSqlJs();
  let engine = Engine.bootstrap(createDatabase(SQL), { seed: opts.seed });
  seedDemoWorld(engine);

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

  for (let day = opts.sampleDays; day <= opts.days; day += opts.sampleDays) {
    const intervalStart = performance.now();
    runScriptedPlayerUntil(engine, day * MINUTES_PER_DAY, { player: opts.player });
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
        opts.sampleDays * MINUTES_PER_DAY,
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
      engine = Engine.bootstrap(createDatabase(await loadFreshSqlJs(), exported), { seed: opts.seed });
      seedDemoWorld(engine); // re-registers action types — see checkpoint.ts
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
      msPerSimDay: Math.round(intervalMs / opts.sampleDays),
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
