# Performance Audit — long-run simulation

**Current reference:** [§9 — Desktop migration](#9-desktop-migration--2026-10-06) records Electron/native SQLite performance and validation. Sections 1–5, 7–8 and the player follow-up retain historical browser/sql.js measurements; §6 tracks which proposals remain after later changes. The calendar has 120 days per game year; 365-day sampling intervals are benchmark intervals, not calendar years. Current setup and commands are in [the project README](../README.md).

**Date:** 2026-10-06 · **Scope:** why long headless runs slowed down and crashed as world history grew, what was fixed, and what remains.
**Historical result:** two defects explained the early slowdown/crashes. After fixing them, the then-current 730-day stress scenario completed in **~155–165 s** in a single sql.js module with no checkpointing, flat per-day cost, passing nightly audits and deterministic state. These timings predate later economic/player changes and are not the current Electron benchmark. It previously reached day 301 in 30 minutes and timed out.

Measurements in each section belong to its stated code/workload and runtime. The original audit used the sql.js harness, seed `stage5-scale-stress`, on Windows 11/system Node; §9 distinguishes native/file-backed and renderer measurements. Estimated future scheduling costs are not part of these measured results.

---

## 1. Historical browser architecture (as found before the fixes)

This is the audit's original snapshot. Player identity is now independent of household membership, NPC labor runs daily, detailed bus events can be omitted from the log, due-action indexing is implemented, and production persistence is native/file-backed. See §9 and the current source; the snapshot below is retained to explain the original defects.

**Ticks.** `Engine.advanceTicks(n)` runs `n` one-minute ticks inside one SQL transaction. Each tick (`stepOneTick`): read+write `world_meta.tick`; per-tick needs decay for *foreground* entities only (anyone not in `household_members` — in practice just the player); per-tick action-queue processing for every actor with an open action.

**Cadence.** Staggered per §4.2, all hung off the minute tick:
- *daily* (tick % 1440 = 0): household feeding/budgets/adaptation ladder (`population/cadence.ts`), smoothed price drift (`market/pricing.ts`), company decisions — restock inputs/tools, sell surplus, upgrade, insolvency/closure (`companies/decisions.ts`), nightly conservation audit;
- *weekly* (day % 7 = 0): NPC labor (wages, XP, production in one batched pass per employment), NPC job-seeking, migration.

**NPC activity.** NPCs never touch the per-tick action queue. Their needs, wages, skill gain, consumption and production are resolved in the daily/weekly passes above — a handful of statements per household/employment per day/week. This "background aggregation" design was already correct and is not where the cost was.

**Companies.** Daily, Management-weighted (restock interval/batch size scale with the owner's Management level); weekly production via NPC labor; upgrades gated on full staffing + trailing-30-day profit + cash; closure after a Management-weighted insolvency grace period, with liquidation to auction.

**Items & provenance.** Every unit of every good is an `items` row (single-container rule, status lifecycle). Every produce/transfer/destroy writes a `provenance_events` row *and* emits a bus event that the logger writes to `event_log`. Running counters on `world_meta` back the nightly audit (counters vs. live `COUNT`/`SUM`).

**Event logging.** `logs/logger.ts` subscribes to the bus and inserts every event into `event_log` (indexed by `(scope, tick)` and `actor_id`).

**Persistence.** sql.js (SQLite compiled to WASM). The database *is* the game state; a save is `db.export()` bytes. sql.js keeps the DB file in Emscripten's in-memory filesystem.

**Checkpointing.** `checkpointEngine()` exports the DB, disposes the engine, loads a *genuinely fresh* sql.js WASM module (Node only, via `require.cache` invalidation), and rehydrates — with RNG state persisted in `world_meta.rng_state` so determinism survives. It existed solely to escape the "memory ceiling" (§3, cause 1).

---

## 2. Observed scaling problem (before)

Measured on the unmodified code (HEAD `73a4da0`), 90 days, scripted player, checkpoint every 15 days, SQL profiling on:

| Day | Interval runtime | ms / sim-day | `actions` rows | `event_log` rows | `items` (active) | DB size | Checkpoint export / reload | `getCurrentAction` per call |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 15 | 3,368 ms | 225 | 292 | 3,603 | 1,115 (454) | 1.3 MB | 1 / 11 ms | 46.8 µs |
| 30 | 3,588 ms | 239 | 472 | 7,280 | 2,116 (979) | 2.4 MB | 2 / 11 ms | 66.6 µs |
| 45 | 9,993 ms | 666 | 2,674 | 13,832 | 2,828 (1,467) | 4.1 MB | 2 / 11 ms | 210.9 µs |
| 60 | 18,005 ms | 1,200 | 4,897 | 19,904 | 3,396 (1,927) | 5.5 MB | 3 / 11 ms | 473.3 µs |
| 75 | 25,992 ms | 1,733 | 7,096 | 25,848 | 3,926 (2,367) | 7.0 MB | 4 / 13 ms | 735.5 µs |
| 90 | 34,072 ms | 2,271 | 9,296 | 31,620 | 4,396 (2,797) | 8.3 MB | — | 1,002.2 µs |

Total: **95.1 s for 90 days**, interval cost up **10×** in 75 days. By day 90 one query — `getCurrentAction` — was **89%** of interval time (30.4 s of 34.1 s); every other query's per-call cost was flat (e.g. the per-tick needs query stayed 18–21 µs). Checkpoint cost stayed flat at a few ms, confirming the prior session's finding that checkpoints were not the cause.

A second failure, separate from speed: the same harness run for 180 days with checkpoints every **30** days instead of 15 crashed with `RuntimeError: memory access out of bounds` inside its second WASM module — the historical "sql.js memory ceiling."

Historical context (from DECISIONS.md): the 730-day stress run reached day 301 in 30 minutes; Stage 4's 90-day exit test took 165 s before Stage 5 and 380–500 s after; the full test suite took **177 s** at the start of this session (Stage 4 test alone: 174 s).

---

## 3. Root causes (ranked)

### Critical 1 — sql.js `exec()` leaks the WASM stack (the "memory ceiling")
**Evidence.** sql.js 1.14.1's `Database.prototype.exec` calls `stackAlloc(4)` for its `pzTail` out-parameter and never calls `stackSave()`/`stackRestore()`. Each call permanently consumes 16 bytes (stack-aligned) of the module's fixed 5 MB stack. Microbenchmark, fresh module each:

| Path | Result |
|---|---|
| `db.exec('SELECT ?', [i])`, debug build | `Aborted(stack overflow (Attempt to set SP to 0x000149f0, with stack limits [0x00014a00 - 0x00514a00]))` after **327,481** calls |
| `db.exec(...)`, release build (the one the game ships) | `memory access out of bounds` after **328,904** calls (with or without params) |
| `prepare` / `bind` / `step` / `free`, release build | **3,000,000 calls, no failure** |

5 MB / 16 B = 327,680. Every SELECT in the engine went through `queryRows` → `db.exec`. This single defect explains every historical observation: the ceiling "scaled with distinct operation volume, not data"; varied workloads crashed sooner (more queries per tick); requesting more WASM memory did nothing (it's the stack, not the heap); a fresh module "fixed" it (fresh stack); and the browser had no fix (no module reload in ESM).

### Critical 2 — the per-tick action lookup scanned the actor's whole history
**Evidence.** `getCurrentAction` = `WHERE actor_id = ? AND status IN ('queued','in_progress') ORDER BY sequence LIMIT 1`. `EXPLAIN QUERY PLAN`: `SEARCH actions USING INDEX idx_actions_actor_sequence (actor_id=?)` — SQLite walks every action the actor ever took, in sequence order, checking status row by row, until it reaches the one open action at the end. It runs 2–3× per tick for the player (the action processor, plus any scripted/UI poll). Per-call cost was linear in history (table above: 47 µs → 1,002 µs as rows went 292 → 9,296), making the run quadratic. The scripted player queues a 5-tick `read_notices` whenever idle, so the actions table grows ~110 rows/day — at day 730 it holds 82,000 rows, which would have meant ~9 ms per call.

### Medium — other full scans / sorts over growing tables
- `countActiveEmploymentsForSlot` / `listActiveEmploymentsForSlot`: `SCAN employment` (no index on `job_slot_id`). Employment history only grows (terminated rows are kept). Called by job-seeking, labor, growth, closure and immigration — weekly/daily, so cheap today, quadratic in principle.
- `queryLog(scope)`: `ORDER BY id DESC` with only a `(scope, tick)` index → `USE TEMP B-TREE FOR ORDER BY` — a sort of the scope's *entire* history on every call. The UI's `LogPanel` calls this on every render.

### Medium — storage growth (write amplification), not a speed problem at 2 years
After 730 days the historical `event_log` held ~212,000 rows and the DB was ~47 MB. Inserts stayed ~35 µs (B-tree, log n). Growth was ~23 MB per 365 simulated days (~7.6 MB per 120-day game year), relevant to the old browser memory/save model. At that time, scripted `action.started`/`action.completed` pairs dominated and item movement events duplicated provenance. Later logging changes suppress bookkeeping details; current growth is measured in §9.6.

### Medium — goods duplication in the market (correctness, with a growth side-effect)
Nothing ever moved an item *out* of a market's stock container. Every purchase conjured a new item for the buyer while the producer's sold units stayed in `market-stock` forever: duplicated goods, active items growing without bound (2,797 at day 90), and broken provenance (a household's loaf never traced to the bakery). It also misallocated money (§4.4). Not a speed problem at 2 years; a pillar-1 correctness problem.

### Low — constant per-tick overhead
~7 statements per tick even when nothing happens: read/write `world_meta.tick`, the foreground-entity scan, worn-gear lookup, the open-actions scan. ≈ 100–170 µs/tick, i.e. ~140–250 ms per simulated day with the scripted player. Flat with history after the fixes; 730 days ≈ 2.6 min. Not worth restructuring now.

### Ruled out (with evidence)
- **Checkpoint/serialization cost**: 1–4 ms export at 1–8 MB; 29 ms export / 48 ms reload at 47 MB.
- **Event/provenance table size**: insert cost flat (~35 µs) from 3.6k to 212k `event_log` rows.
- **Missing item indexes**: `idx_items_container_type_status` (added in slice 3) is used by every hot item query.
- **sql.js/WASM generally**: once `exec()` is avoided, one module instance ran 1,051,200 ticks and more than 7M statements (the profiler's count for just the six hottest statements) with flat per-statement cost.
- **NPC/company cadence**: daily+weekly phases total < 0.3 s per 30 simulated days.

---

## 4. Fixes applied

### 4.1 Never call `db.exec()` (Critical 1)
`db/sqlite.ts`'s `queryRows`/`queryRow` now use `prepare` → `bind` → `step` → `get` → `free`. It was the only `exec()` call site. Verified: 90 days in a single module with no checkpoint (previously died ~day 30–40), then 730 days in a single module. This also **fixes the browser**, which never had a working fresh-module escape hatch — the leak itself is gone. `db.run()` was already safe (`prepare` path with params; `sqlite3_exec` via `ccall` without).

### 4.2 Partial index for open actions (Critical 2) — migration `0017_open_actions_index`
`CREATE INDEX idx_actions_open_actor_sequence ON actions (actor_id, sequence) WHERE status IN ('queued','in_progress')`. It only ever contains the handful of open actions, so lookups are O(1) in history; completed history stays in the same table, fully queryable. `getCurrentAction` and `listActiveActions` now plan as `SEARCH actions USING INDEX idx_actions_open_actor_sequence (actor_id=?)`; per-call cost is flat at ~17 µs from day 30 to day 720. No schema split, no query changes.

### 4.3 Index + query fixes (Medium)
- Same migration: `idx_employment_slot_status ON employment (job_slot_id, status)` → `SEARCH ... USING COVERING INDEX`.
- `queryLog` orders by `tick DESC, id DESC` (identical order; ids are emitted in tick order) so it walks `idx_event_log_scope_tick` backwards and stops at `limit` — no full-scope sort.

### 4.4 Market physical stock (correctness) — migration `0018_market_consignments`
New `market/market.ts` `buyFromMarket()` is the single exit for goods leaving a market: it takes real units from stock **oldest first** (keeping their ids and provenance), and only the shortfall is produced fresh as a merchant import. Payment follows the units: a unit consigned by a company (`market_consignments`, written by `sellSurplusToMarket`) pays that company; merchant-owned units and imports sink the coin (the designed faucet/sink). Household bread, the player's `buy_*` actions and company restocking all go through it, settling coin in one lump per seller. The migration backfills consignments for existing saves from provenance. `producer_company_id` is now informational only.

### 4.5 Tooling
- `npm run sim:perf -- --days N --sample S --checkpoint C [--no-player] [--econ PREFIX] [--out FILE]` (`src/engine/perf/longRun.ts`): wall-clock per interval, row counts, DB size, RSS, checkpoint export/reload split, per-phase engine time (`Engine.phaseTimer`, null in normal play), the top SQL statements with per-call averages (`perf/sqlProfiler.ts`), an economy report (§6), and a **logical state fingerprint** for determinism checks.
- `scenarios/scriptedPlayer.ts`: the scripted-player policy shared by the harness (same policy as the stage4/stress tests, so measurements compare like with like).

---

## 5. Results (after)

### 730-day stress scenario, single module, no checkpointing (performance fixes 4.1–4.3 only)

| Day | ms / sim-day | `actions` | `event_log` | `items` (active) | DB size | RSS |
|---:|---:|---:|---:|---:|---:|---:|
| 30 | 160 | 472 | 7,280 | 2,116 (979) | 2.4 MB | 106 MB |
| 90 | 242 | 9,296 | 31,620 | 4,396 (2,797) | 8.3 MB | 105 MB |
| 180 | 238 | 18,553 | 58,931 | 7,393 (5,516) | 15.1 MB | 111 MB |
| 360 | 235 | 41,084 | 116,772 | 9,153 (3,701) | 28.1 MB | 124 MB |
| 540 | 238 | 59,587 | 160,837 | 9,153 (3,691) | 36.7 MB | 158 MB |
| 720 | 231 | 82,105 | 212,621 | 9,153 (3,691) | 46.8 MB | 171 MB |

**Total 154.7 s** (212 ms/day average), 0 failed audits, final audit PASSED. Per-day cost is flat across the run; the recurring ~140 ms/day intervals (days 150, 270, 390, …) are a seasonal dip in the scripted player's own action volume, not engine variance. With the market fix (4.4) added: 162.9 s, flat, all audits passing. World only (no scripted player; the player entity still exists and collapses/recovers idle): **87.0 s** for 730 days (116–128 ms/day, flat), DB 14.3 MB at day 730 — i.e. roughly two-thirds of the 47 MB in the scripted run is the scripted player's own action/event history.

### Before → after summary

| Measure | Before | After |
|---|---:|---:|
| 90-day run (harness) | 95.1 s | 20.1 s |
| ms per sim-day at day 90 | 2,271 | 245 |
| `getCurrentAction` per call at ~9.3k actions | 1,002 µs | 18 µs |
| 730-day run | did not finish (day 301 at 30 min, historical) | **155–163 s** |
| Longest run in one WASM module | ~30–40 days, then crash | 730 days, no crash |
| Full test suite | 177 s | 27 s |
| Stage 4 90-day exit test | 174 s | 24 s |
| Stage 5 60-day test | 57 s | 13 s |

### Determinism and save/checkpoint integrity
Same seed, 730 days: no checkpoints → fingerprint `6a9b0d35194aed9d`; checkpoint every 30 days (24 checkpoints) → **`6a9b0d35194aed9d`**. Identical logical state (wallets, every item, employment, companies, households, needs, skills, listings, row counts, RNG state). `checkpoint.test.ts` and `engine.test.ts` (save → load → resave byte-identical) still pass.

**New finding:** checkpointing now *costs* memory — RSS reached 325 MB with 24 checkpoints vs 174 MB without (discarded WASM modules aren't fully released). Since the leak it existed to escape is gone, long runs should not checkpoint; `checkpointEngine` stays as a tested facility (it is exactly a save/reload).

---

## 6. Proposal status and remaining storage work

The original sql.js audit proposed several optimizations. Their status after later economy work and the desktop migration is:

| Proposal | Current status |
|---|---|
| Cache `world_meta.tick` | Not implemented; reassess against current native profiles before changing engine state handling |
| Prepared-statement cache | Implemented in `sqlite.native.ts` with a bounded cache; sql.js still prepares/frees through its adapter |
| Suppress duplicated item movement log rows | Implemented through `EngineEvent.detail` and `logs/logger.ts`; economic provenance remains in `provenance_events` |
| Suppress routine `action.started` bookkeeping | Implemented for starts without an authored start message; meaningful start narration can still be persisted |
| Archive old personal/business history | Not implemented; consider an archive table or queryable summary policy before multi-generation saves |
| Archive destroyed/consumed items and old provenance | Not implemented; preserve provenance queryability and conservation when designing it |

Native/file-backed SQLite is the production backend; sql.js remains for headless tests, portability comparisons and fallback. The old recommendation to keep the browser-only save model is superseded. Browser bootstrap helpers are legacy/benchmark tooling, not a production renderer dependency.

Current stress growth is ~80 MB per 365 simulated days (~26 MB per 120-day game year), dominated by provenance/items (§9.6). More RAM and a disk-backed DB do not eliminate snapshot or storage costs. Future archival must retain meaningful history, portable save compatibility and deterministic outcomes; no archive tables or retention policy were added in the migration.

---

## 7. Risks

| Area | Risk | Mitigation / status |
|---|---|---|
| Determinism | Query-path changes could reorder results | Identical final fingerprint across checkpointed/uncheckpointed 730-day runs; orderings unchanged (`queryLog` order proven equivalent; `buyFromMarket` orders by rowid). |
| Saves | New migrations on old saves | 0017 adds indexes only. 0018 adds a table and backfills consignments from provenance; unmatched old stock is treated as merchant-owned (previous behavior). |
| Conservation | Market change moves goods differently | Unit tests assert goods are moved not duplicated and coin per unit goes to the right party; nightly audit passed every day of every run. |
| Provenance | Chains now longer for local goods | Tests updated to the truthful shape: `produced → transferred* → consumed`. |
| Gameplay | Market fix stops paying the bakery for merchant-import bread | Intended (it was revenue for goods it never made). This and the wage fix change economic outcomes — see [the historical Stage 5 audit](./Archive/STAGE5_AUDIT.md). |
| Checkpoint | Still relied on by tests | Still correct and deterministic; just no longer needed for memory. |

---

## 8. Addendum — after the economy balancing pass (2026-10-06, later)

The balancing pass (DECISIONS.md) made the economy physically busy: NPCs work daily shifts, every loaf moves farm → mill → bakery → market → household as a real item, and the merchant imports, exports and spoils goods. Re-measured on the same seed with the scripted player:

| Measure | Before balancing | After balancing |
|---|---:|---:|
| 730-day run (scripted player) | 155–163 s | **198 s** |
| ms per sim-day | 140–260, flat | 262–289, flat |
| World only (no scripted player) | 730 days in 87 s | 1,825 days in 237–250 s — 130–137 ms/day, flat (two runs in parallel) |
| `event_log` rows at day 730 | 212,621 | 419,857 |
| `provenance_events` rows at day 730 | 18,305 | 161,739 |
| DB size at day 730 | 46.8 MB | **130.6 MB** |
| RSS at day 730 | ~171 MB | ~258 MB |

Speed is still flat with history: no per-tick or per-day work grows with accumulated rows. Determinism holds: identical fingerprint over 360 days with and without 12 checkpoints.

**Storage was the leading long-run cost in this snapshot**, at ~65 MB per 365 simulated days (~21 MB per 120-day game year). The then-current day-730 `event_log` breakdown:
- `action.started` / `action.completed`: 106k each (the scripted player);
- business-scope `item.transferred` / `item.produced` / `item.consumed` / `item.exported`: 161k combined (38% of rows), each duplicating a `provenance_events` row.

At that time, suppressing bookkeeping item/action events was estimated to remove about 60% of log rows without losing provenance. It was not applied in the balancing pass, but later storytelling/log changes implemented detail suppression; §6 records current status. Old-row archival remains future work.

## Historical player experience follow-up — 2026-10-06, before Electron

Foreground simulation now selects `entities.simulation_mode`, independently of household membership. The new named player belongs to a household without entering coarse NPC feeding/wages/needs. Background immigration and NPC cadence retain their explicit mode.

The original [player plan](./Archive/PlayerPlan.md) validation ran 730 days with a real player household both continuously and with a fresh-module checkpoint at day 365. Both reached tick 1,051,200, zero failed nightly audits, and fingerprint `a04078a6373f24b4`. Runtime was 217.3 s continuous and 224.1 s checkpointed (other validation processes overlapped); interval cost stayed about 295–310 ms/day. Final DB size was 162.3 MB. sql.js exports measured about 41 ms at 80.8 MB; earlier sampling observed 21 ms at 40 MB and 90 ms at 160 MB. The browser autosave then serialized changed state once a real minute and at safe transitions. Native desktop autosave now checkpoints the live file instead; §9 and [current player validation](./PLAYER_VALIDATION.md) record that behavior.

The harness now supports `--named-player` and processes a final partial sample. Previously `--days 730 --sample 180` actually stopped at day 720 while labeling its result as 730 days. The corrected 730-day results above use `--sample 365`; older measurements should be interpreted by their final tick/sample, not only the requested duration.

---

## 9. Desktop migration — 2026-10-06

### 9.1 Method and behavioral baseline

The paused migration report in `MigrationPlan.md` records measurements on one Windows 11 machine (24 threads, 32 GB). The busiest workload is a named-player world, seed `stage5-scale-stress`, with the scripted player, no SQL profiling, 1,095 simulated days sampled at days 365, 730 and 1,095. These samples cover about nine 120-day game years. They must not be interpreted as three game years. Totals and memory below are the recorded migration measurements; fresh completion checks are tracked separately in MigrationPlan.md.

Pre-migration validation passed 253 tests with one skip. Long-run logical fingerprint `5d3dfc2e9813e2aa` matches all five backend/host configurations below, with nightly conservation audits passing. Native binding preserves sql.js integer behavior, and ordered queries and RNG consumption remain unchanged. The browser/renderer comparisons at 365 days agree on `56ccb03711d3a18e`; world-only runs agree on `d6ba890fc120ce8d`.

### 9.2 Headless throughput and memory

| Configuration | ms/day, intervals ending at 365 / 730 / 1,095 days | Total | Peak RSS |
|---|---|---|---|
| Before migration: system Node 22, sql.js | 298 / 299 / 297 | 326 s | 383 MB |
| After migration: system Node 22, sql.js | 299 / 306 / 297 | ~330 s | 389 MB |
| Electron's Node 24, sql.js | 295 / 265 / 264 | ~300 s | 378 MB |
| Electron's Node 24, native in memory | 61 / 55 / 56 | ~63 s | 382 MB |
| Electron's Node 24, native file-backed, one commit/day | 104 / 108 / 116 | 120 s | 157 MB, flat |

The production-backend harness is about 2.7× faster than the original Node/sql.js baseline, with 59% less peak RSS. Native in-memory runs are faster but retain the growing database in process memory; they are not the game's save configuration. After migration, sql.js on system Node is essentially unchanged: moving hosts preserved behavior rather than concealing an economic rewrite.

In Chromium, the previous renderer-owned engine took 259 ms/day in Electron and 270 ms/day in system Chrome over 365 days. World-only (`econ-alpha`, no scripted player) took 173 ms/day before migration on sql.js and 74 ms/day on native file-backed SQLite, with matching fingerprints.

### 9.3 Running-app responsiveness

`npm run bench:app` drives a fresh game for 20 real seconds at each speed, then measures one-day skipping and IPC. Phase 1 ran simulation in the renderer; the final app uses the utility process and native SQLite.

| Measure | Renderer-owned simulation | Final desktop architecture |
|---|---|---|
| Renderer long tasks at 16× | 6; 356 ms total, maximum 66 ms | 0 |
| Maximum frame gap at 16× | 61 ms | 12 ms |
| Skip to morning, one day | 184–215 ms; window frozen up to 189 ms | 108–138 ms; maximum frame gap 6 ms |
| Game minutes/s at 1× / 4× / 16× | 25 / 100 / 402 | 24.8 / 99.8 / 400 |
| Tab-switch median | 43 ms | 47–58 ms |
| Early-game memory | Renderer 163–173 MB | Renderer 173–177 MB plus simulation 66–74 MB |

The measurable benefit is a responsive renderer during simulation and skips; tab switching is not faster. Early-game combined memory rises by roughly one Node process. The long-run harness shows why file-backed SQLite helps later: simulation memory stays flat while the database grows on disk. Renderer/app totals and harness RSS are different measures and must not be compared as if they were the same process. The harness's daily commits approximate batching for throughput comparisons; the actual clock commits each 200 ms batch. These figures do not predict tick throughput on every machine or at future NPC scale.

### 9.4 IPC

Renderer → simulation → renderer median round trips were 0.2–1 ms. Recorded payload sizes: HUD 0.5 KB, character 8.6 KB, business 7.8 KB, settlement 5.5 KB; tick notifications under 400 bytes. Screen-sized snapshots and domain invalidations avoid per-field calls. Each view keeps one request in flight, preventing accumulating requests while a batch runs.

### 9.5 Windows commits and WAL checkpoints

A file-backed commit measured about 0.6 ms on the test machine. The default WAL autocheckpoint (~4 MB) made daily commits average 69 ms including checkpoint work. Raising it to 16,384 pages (~64 MB at the default 4 KB page size), with explicit host checkpoints on each changed autosave and orderly close, brought world-only native runs from 181 to 74 ms/day. WAL uses `synchronous=NORMAL`: a process crash preserves committed batches, but power loss or an OS crash can lose recent commits. This setting was chosen for the measured write cost and is not a claim of power-loss durability.

The scripted harness normally commits per player action, about 240 times/day. `--commit day` wraps that work in one daily transaction for the file-backed comparison; omitting it measures a much heavier commit workload than the app. Fresh-module checkpoint/reload benchmarks also need careful interpretation: native rehydration in the harness uses `NativeDatabase.fromBytes`, switching to an in-memory database; it does not reopen the original live save file.

### 9.6 Storage and follow-up

Stress database sizes at days 365 / 730 / 1,095 were 80.8 / 162.3 / 240.9 MB; world-only was 66.7 MB at day 365. The stress rate is roughly 80 MB per 365 simulated days, or 26 MB per game year. Provenance and its index account for ~50%, items ~23%, event_log ~13%, actions ~8%. SQLite removes the WASM memory ceiling but leaves disk growth, snapshot cost and archival work.

No per-minute NPC history was added. Current state, economically meaningful provenance, readable history and ephemeral presentation remain distinct. Detail suppression predates the migration; §6's remaining old-row archival proposals were not implemented here. The native statement cache is implemented.

Due-driven action processing and migration 0024 skip actors whose open action is not ready; all recorded fingerprints remain unchanged. Scheduled NPC shifts, actual location presence, errands and travel remain follow-up work in `Archive/ScheduledActivityPlan.md`; strategy keeps its daily/weekly cadence and distant settlements retain aggregation. The follow-up must measure behavior and balance anew because moving completion times changes RNG order.

### 9.7 Completion validation

Resumed baseline validation stopped at an existing formatting issue in the late `sqlite.native.ts` change. After formatting and the startup/logging fixes, `npm run validate` passed typecheck, lint, formatting, both suites and the build: system Node 283 passed/10 skipped; Electron's Node 307 passed/one existing skip. Four new tests cover idle startup without an unhandled rejection, readiness and output forwarding, fatal initialization, and a fresh readiness promise on restart. Native-only skips on system Node reflect runtime capabilities; they execute on Electron's Node.

The built, packaged and NSIS-installed applications each pass the full GUI smoke flow on both backends (six runs), including saves, export/import, relaunch and forced process termination. The real dev launcher loads Vite, forwards simulation output and has no startup rejection. Temporary NSIS installation and uninstall both exit 0; test files and registration are removed.

Completion runs reach 1,095 days on native file-backed SQLite continuously and on sql.js with fresh-module checkpoints at days 365 and 730. Both have zero failed nightly audits, final tick 1,576,800, conserved goods 1,269 and coin 60,414, and fingerprint `5d3dfc2e9813e2aa`. Native takes 119.0 s with ~157 MB sampled RSS; checkpointed sql.js takes 349.6 s and reaches 546.6 MB RSS, consistent with §5's repeated-WASM-module overhead. Other checks overlapped these reruns; §9.2 remains the controlled migration comparison. Reports and commands are described in MigrationPlan.md.

Packaging is unsigned, uses the default icon and retains inspect arguments for automation; public release hardening remains separate.
