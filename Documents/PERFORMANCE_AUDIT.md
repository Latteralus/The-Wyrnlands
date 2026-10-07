# Performance Audit — long-run simulation

**Date:** 2026-10-06 · **Scope:** why long headless runs slowed down and crashed as world history grew, what was fixed, and what remains.
**Bottom line:** two distinct defects explained every historical symptom. Both are fixed. The original 730-day stress scenario now completes in **~155–165 s** in a single sql.js module with **no checkpointing**, flat per-day cost, every nightly conservation audit passing, and a deterministic final state. (It previously reached day 301 in 30 minutes and timed out.)

All numbers below were measured with the new harness (`npm run sim:perf`), seed `stage5-scale-stress` (the seed the original stress test used), on the same Windows 11 / Node machine. Nothing is extrapolated unless marked as such.

---

## 1. Current architecture (as found)

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
After 730 days `event_log` holds ~212,000 rows and the DB is ~47 MB. Inserts stay ~35 µs (B-tree, log n), so this does not slow the simulation. But the database grows ~23 MB/in-game year — which matters for browser memory, save-file size and IndexedDB autosave over *generations*. Sources: the scripted player's `action.started`/`action.completed` pairs dominate; item `produced/transferred/consumed` events duplicate `provenance_events`.

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

## 6. Remaining items and proposals

**Safe / local (not done; low value now)**
- Cache `world_meta.tick` in memory (write-through) — removes 2 of ~7 per-tick statements.
- A per-DB prepared-statement cache for hot queries. Must be invalidated on `export()` (sql.js frees every statement on export/close).

**Archival / history (recommended before multi-generation runs)**
DB growth is ~23 MB per in-game year with this workload. Options, least invasive first:
1. Stop writing item `produced/transferred/consumed` events for `business` scope to `event_log` — `provenance_events` already records them (the bus emit can stay for live listeners). Business-log screens would read provenance instead.
2. Don't persist `action.started` (the `actions` table already records start ticks).
3. Year-end compaction: move `event_log` rows older than N in-game years for `personal`/`business` scopes into an `event_archive` table (or a summary) — still queryable for chronicles/debugging; `settlement`/`world` scopes (the chronicle) kept in place.
4. Consumed/destroyed items + their provenance could likewise move to archive tables; active-state queries already use status-leading or partial indexes, so this is about file size, not speed.

None of these is needed for 2-year runs; all preserve "history is append-only and queryable."

**sql.js suitability.** Keep it. After avoiding `exec()`, one module handled 1M+ ticks and 7M+ statements at flat per-statement cost, and the offline/browser single-file save model is intact. Native SQLite for headless would be faster per statement but isn't needed and would split the codepath.

**Browser.** The stack leak was the browser's real exposure and is fixed for every platform. `sqlite.browser.ts`'s non-working `loadFreshSqlJs` is no longer needed for long sessions. Not yet verified with a multi-hour real browser session.

---

## 7. Risks

| Area | Risk | Mitigation / status |
|---|---|---|
| Determinism | Query-path changes could reorder results | Identical final fingerprint across checkpointed/uncheckpointed 730-day runs; orderings unchanged (`queryLog` order proven equivalent; `buyFromMarket` orders by rowid). |
| Saves | New migrations on old saves | 0017 adds indexes only. 0018 adds a table and backfills consignments from provenance; unmatched old stock is treated as merchant-owned (previous behavior). |
| Conservation | Market change moves goods differently | Unit tests assert goods are moved not duplicated and coin per unit goes to the right party; nightly audit passed every day of every run. |
| Provenance | Chains now longer for local goods | Tests updated to the truthful shape: `produced → transferred* → consumed`. |
| Gameplay | Market fix stops paying the bakery for merchant-import bread | Intended (it was revenue for goods it never made). This and the wage fix change economic outcomes — see `STAGE5_AUDIT.md`. |
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

**Storage is now the leading long-run cost** at ~65 MB per in-game year. The day-730 `event_log` breakdown:
- `action.started` / `action.completed`: 106k each (the scripted player);
- business-scope `item.transferred` / `item.produced` / `item.consumed` / `item.exported`: 161k combined (38% of rows), each duplicating a `provenance_events` row.

§6's archival options 1 and 2 would remove about 60% of event rows without losing any provenance; they were not applied in the balancing pass because they change log content. Recommended before multi-generation runs or browser autosave.

## Player experience follow-up — 2026-10-06

Foreground simulation now selects `entities.simulation_mode`, independently of household membership. The new named player belongs to a household without entering coarse NPC feeding/wages/needs. Background immigration and NPC cadence retain their explicit mode.

PlayerPlan validation ran 730 days with a real player household both continuously and with a fresh-module checkpoint at day 365. Both reached tick 1,051,200, zero failed nightly audits, and fingerprint `a04078a6373f24b4`. Runtime was 217.3 s continuous and 224.1 s checkpointed (other validation processes overlapped); interval cost stayed about 295–310 ms/day rather than increasing with history. Final DB size was 162.3 MB under the deliberately busy scripted-player stress workload. Exports measured about 41 ms at 80.8 MB; earlier sampling observed 21 ms at 40 MB and 90 ms at 160 MB. Browser autosave runs once a real minute when state changed, plus safe transitions; it never serializes each tick. History growth/archival remains follow-up work.

The harness now supports `--named-player` and processes a final partial sample. Previously `--days 730 --sample 180` actually stopped at day 720 while labeling its result as 730 days. The corrected 730-day results above use `--sample 365`; older measurements should be interpreted by their final tick/sample, not only the requested duration.
