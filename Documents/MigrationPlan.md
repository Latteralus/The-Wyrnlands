# Migration status report — 2026-10-06

**State in one line:** the desktop migration is complete within its scope. React is in a sandboxed Electron renderer; the Engine, clock, RNG and saves run in a separate simulation process on native, file-backed SQLite. Phases 1–15 and 22–30 are implemented, documented and validated; 16–21 are groundwork plus the detailed `Documents/Archive/ScheduledActivityPlan.md`, as the scope rule allows. Native and checkpointed sql.js 1,095-day completion runs match the pre-migration fingerprint. The NSIS installer builds, installs, passes the full smoke flow on both backends, and uninstalls. Nothing is committed; all work remains in the working tree for review.

## Where each phase stands

| Phase | Status |
|---|---|
| 1 Electron shell | Done. Electron 44.6.0 (Chromium 152, Node 24.21). Vite builds the renderer and three Node bundles (`scripts/build-electron.mjs`); this was chosen because electron-vite did not support the installed Vite 8 during migration. UI moved to `src/renderer/`. |
| 2 Security | Done. `contextIsolation`, `sandbox`, `nodeIntegration: false`, strict CSP (scripts `'self'` only, no wasm/eval), `app://wyrnlands` protocol instead of `file://`, navigation and `window.open` blocked, permissions denied, IPC sender checks, single-instance lock, fuses. The preload exposes only `host, versions, request, onNotification, exportSave, importSave`. |
| 3–4 Protocol | Done. `src/shared/protocol.ts`: view snapshots per screen, player commands, session/save methods, notifications with change domains. Method names are allow-listed in the preload and the host; every parameter is shape-validated (`src/sim-host/validate.ts`); there is no way to send SQL. |
| 5–7 Simulation process, clock, notifications | Done. Electron utility process (`src/electron/simProcess.ts` → `src/sim-host/`). The clock runs there on a fixed 200 ms grid, with the same pacing as before. The renderer refetches views only for changed domains; `useView` keeps one request in flight per view. No window → paused and saved; a reloaded window reconnects. |
| 8 sql.js parity | Done. Same fingerprints in Node, the Electron renderer, Chrome and Electron's Node. |
| 9 DB adapter | Done. A small `Database` interface (`run`/`query`/`export`/`close`) in `src/engine/db/sqlite.ts`; 45 engine modules only changed a type import. |
| 10–11 Native SQLite and save lifecycle | Done. `node:sqlite` (built into Electron; no native module to rebuild). Binding mirrors sql.js (32-bit ints as INTEGER). Statement cache. The live save *is* the DB file (WAL, `synchronous=NORMAL`); manual saves and exports are `VACUUM INTO` snapshots. sql.js remains as a fallback: `--sim-backend=sqljs`. |
| 12–13 Save directory, portable saves | Done. `%APPDATA%\The Wyrnlands\saves\<id>\{world.sqlite, metadata.json}`, plus an `autosave-backup` slot. Export/Import go through native dialogs in the main process; paths never come from the renderer. |
| 14 Migrations | Done. `openGame(db)` validates and migrates inside one transaction. New migration `0024_due_actions_index`. Legacy schema-22 saves migrate identically on both backends. |
| 15 Headless tests | Done. `npm test` runs on system Node (sql.js) with no Electron; `npm run test:native` runs the suite on Electron's Node, including the native backend. |
| 16–20 Scheduling | Groundwork only, as the scope rule allows. Actions are now processed only when due (indexed by `ends_at_tick`); fingerprints are unchanged. Follow-up plan: `Documents/Archive/ScheduledActivityPlan.md`. |
| 21 DB growth | Reviewed. No per-minute NPC history is written. About 80 MB per 365 simulated days (~26 MB per 120-day game year) under the scripted-player stress workload: provenance with its index ~50%, items ~23%, event_log ~13%, actions ~8%. Archival options remain in PERFORMANCE_AUDIT.md §6. |
| 22 IPC | Measured. Round trips 0.2–1 ms; the largest view payload is 8.6 KB; tick notifications are under 400 bytes. |
| 23–24 Shutdown and crash safety | Done. Orderly shutdown on quit; every batch commits with its RNG state; the app survives being killed at 16× (tested); 10-minute `world.sqlite.backup` with automatic restore if the live file is damaged; a crashed renderer reloads; a crashed simulation process restarts. |
| 25 Dev ergonomics | Done. Vite HMR plus Electron restart on main/sim changes. Startup readiness is initialized only in `start()`; utility-process stdout/stderr are piped through main. The actual dev launcher loads the renderer and forwards simulation diagnostics without the startup rejection. |
| 26 Packaging | Done. Unpacked and NSIS-installed applications pass the full smoke flow on both backends. `npm run package:installer` produces `release/The Wyrnlands Setup 0.1.0.exe` (~112 MB). Silent per-user installation in an isolated workspace directory and uninstall both exit 0; test files and registration are removed. |
| 27 Tests | Done. See "Test results" below. |
| 28 Benchmarks | Done. See "Measurements" below. |
| 29 Behaviour survives | Verified. The Electron smoke test covers creation, character pages, equipment, routine, jobs, profiles, market purchase, founding, saves, export/import and relaunch. Long runs pass every nightly audit with unchanged fingerprints. |
| 30 Documentation | Done. DECISIONS.md records architecture, IPC, SQLite, saves, security, recovery and measured tradeoffs; PERFORMANCE_AUDIT.md §9 records method, results, commit/checkpoint costs and storage limits. README, MASTERPLAN and this report are current. `ScheduledActivityPlan.md` remains the next gameplay slice. |

## Completion work after resuming

1. Replaced the eager rejected readiness promise with `null`; `whenReady()` rejects only when called before startup. Added four lifecycle regression tests (idle startup, readiness/output forwarding, fatal initialization, restart readiness).
2. Switched utility-process output to pipes and relayed both streams through main with `{ end: false }`, preserving terminal output after a child exits. Verified the actual dev launcher with a disposable profile.
3. Initial validation stopped at the late native-adapter change's formatting. Formatted it and reran validation after the WAL and `endSession` changes; both backends and build pass. Final counts are below.
4. Built NSIS, installed to `release/installed-smoke`, ran the full smoke flow on native and sql.js, and uninstalled it. Verified the executable and temporary uninstall registration were removed. The installer remains under `release/`.
5. Added the desktop decision and performance audit, and clarified save durability in README. Corrected benchmark units: the calendar has four 30-day seasons, so 365-day samples are not game years.
6. Added `--executable PATH` to the smoke harness so installed builds can be tested directly. All smoke profiles are disposable; real saves were not used.

The Windows execution sandbox's AppContainer ACLs prevented initial GUI launches. Local runtime read access was corrected, and GUI/dev checks ran outside that execution sandbox; the Electron renderer sandbox, isolation and Node restrictions stayed enabled and were asserted by the smoke tests.

## Remaining release and gameplay follow-up

- Configure code signing and a custom application icon before public distribution. `EnableNodeCliInspectArguments` remains enabled for packaged smoke automation; disable it for a signed public release.
- Implement scheduled NPC/business operations as a separate slice using `Documents/Archive/ScheduledActivityPlan.md`; retain strategic cadence, LOD and meaningful history boundaries.
- Adopt an archival policy before very long/multi-generation saves; native SQLite does not remove disk growth or snapshot costs.
- Optional: inspect and remove the old `%APPDATA%\the-wyrnlands` folder from early dev runs. It was left untouched.
- Review and commit the working tree when ready. Existing staged renames are preserved; new migration files remain untracked.

## Measurements

Same machine throughout (Windows 11, 24 threads, 32 GB). Named-player world, seed `stage5-scale-stress`, scripted player (the busiest workload), 1,095 days.

| Host / backend | ms per sim-day (intervals ending at day 365 / 730 / 1,095) | Total | Peak RSS | Fingerprint |
|---|---|---|---|---|
| Pre-migration: Node 22, sql.js | 298 / 299 / 297 | 326 s | 383 MB | `5d3dfc2e9813e2aa` |
| After migration: Node 22, sql.js | 299 / 306 / 297 | ~330 s | 389 MB | `5d3dfc2e9813e2aa` |
| Electron's Node 24, sql.js | 295 / 265 / 264 | ~300 s | 378 MB | `5d3dfc2e9813e2aa` |
| Electron's Node 24, native in memory | 61 / 55 / 56 | ~63 s | 382 MB | `5d3dfc2e9813e2aa` |
| **Electron's Node 24, native file-backed (the game's configuration), one commit per day** | 104 / 108 / 116 | **120 s** | **157 MB, flat** | `5d3dfc2e9813e2aa` |

- **In a Chromium renderer, 365 days** (how the game ran before): Electron renderer 259 ms/day, system Chrome 270 ms/day. Both give the same 365-day fingerprint as Node, `56ccb03711d3a18e`.
- **World only** (no player, seed `econ-alpha`, 365 days): pre-migration sql.js 173 ms/day; native file-backed 74 ms/day; both `d6ba890fc120ce8d`.
- **Database size:** 80.8 / 162.3 / 240.9 MB at days 365 / 730 / 1,095 (stress workload); world only, 66.7 MB at day 365. This is ~26 MB per 120-day game year under stress.
- **Commit cost on Windows:** a file-backed commit costs about 0.6 ms. SQLite's default WAL autocheckpoint (every ~4 MB) made daily commits average 69 ms; raising it to 64 MB (the host checkpoints at each autosave anyway) brought world-only runs from 181 to 74 ms/day.
- **Harness commit pattern:** the default (one commit per scripted action, about 240 per day) is much slower on a file. `--commit day` approximates batched throughput for comparisons; the game commits every clock batch/command, not once per simulated day. Native checkpoint rehydration in the harness switches to memory, so file-backed benchmarks use `--checkpoint 0`.

**The running app** (`npm run bench:app`; 20 s per speed, new game):

| | Phase 1 (simulation in the renderer) | Final (simulation process, native SQLite) |
|---|---|---|
| Long tasks at 16× | 6 (356 ms total, max 66 ms) | 0 |
| Max frame gap at 16× | 61 ms | 12 ms |
| Skip to morning (1 day) | 184–215 ms, window frozen up to 189 ms | 108–138 ms, max frame 6 ms |
| Game minutes/s at 1× / 4× / 16× | 25 / 100 / 402 | 24.8 / 99.8 / 400 |
| Tab switch median | 43 ms | 47–58 ms |
| Memory | renderer 163–173 MB | renderer 173–177 MB + simulation process 66–74 MB |

Reading the memory row: early in a game, total memory rises by roughly one Node process (~70 MB). Over a long game, the simulation's memory stays flat on native SQLite (157 MB at 1,095 days in the harness), where the old in-memory database grew to ~390 MB. The 365-day measurement intervals are retained for comparison with the pre-migration baseline; the game's actual year is 120 days.

**IPC round trips** (renderer → simulation process → renderer): median 0.2–1.0 ms. Payloads: hud 0.5 KB, character 8.6 KB, business 7.8 KB, settlement 5.5 KB.

## Test results

- **Before the migration:** `npm run validate` passed; 253 tests passed, 1 skipped.
- **Validation after resuming:** passed. 283 passed / 10 skipped on Node 22 (native-only tests skip there); 307 passed / 1 skipped on Electron's Node 24; typecheck, lint, formatting and build passed. Includes the late WAL and shutdown changes and the four new process-lifecycle regressions.
- **New tests:**
  - host sessions, views, commands, validation, clock pacing, reconnects, autosave, backup and recovery, saves, export/import, damaged files and IPC payloads, on both backends;
  - backend equivalence (binding, a 4-day world, schema, legacy migration, rollbacks, portability);
  - the renderer/simulation import boundary, plus a bundle check;
  - window security options.
- **Electron smoke** (`npm run test:electron`, `npm run test:packaged`): passed unpackaged and packaged on both backends, with no renderer console errors. The NSIS-installed executable also passed both backends through `node scripts/electron-smoke.mjs --executable PATH`.
- **Native completion stress run:** 1,095 days, named player, `stage5-scale-stress`, file-backed WAL, `--commit day`, no profiling/checkpoints. 118,960 ms total; interval means 99 / 111 / 115 ms/day; RSS 156.3 / 156.9 / 157.4 MB; DB 80.8 / 162.3 / 240.9 MB. Zero failed nightly audits, final goods 1,269 and coin 60,414 conserved, fingerprint `5d3dfc2e9813e2aa`. Report: `logs/migration-validation/native-1095.json` (ignored local evidence). Installer/build/smoke checks partly overlapped this rerun, so the original comparison table remains the performance baseline.
- **sql.js checkpoint completion run:** same named player, seed and 1,095-day workload on system Node, fresh-module save/reload at days 365 and 730. 349,612 ms total; interval means 342 / 324 / 291 ms/day. Zero failed nightly audits; final tick 1,576,800, goods 1,269, coin 60,414 and fingerprint `5d3dfc2e9813e2aa` match native and the original baseline. Report: `logs/migration-validation/sqljs-checkpoint-1095.json` (ignored local evidence). RSS reaches 546.6 MB with repeated WASM modules, consistent with the checkpoint memory overhead already documented in PERFORMANCE_AUDIT.md §5; this is not the production backend. Validation and GUI checks overlapped, so this rerun is determinism/save evidence rather than a controlled speed comparison.

## Key files

`src/electron/` (main, preload, simProcess, simulationProcess, windowOptions, contentSecurity) · `src/sim-host/` (simulationHost, views, validate, clock, domains, saveLibrary, storage, rpcServer, testing/) · `src/shared/` (protocol, rpc, rpcClient, gameRules, boundary.test) · `src/renderer/sim/` (client, hooks, context, SimulationProvider) · `src/engine/db/sqlite.native.ts`, `backends.test.ts`, migration `0024` · `scripts/` (build-electron, electron-dev, electron-smoke, electron-node, bench-electron, bench-renderer, after-pack) · `electron-builder.yml`.

## Observations outside the migration's scope

- **Duplicate NPC names.** Seeding can give two NPCs in one household the same name: "Mira Dunmoor" is both `npc-3` and `npc-4` for seed `electron-smoke`. This predates the migration.
- **Browser-era saves.** Saves from the browser version are still in that browser's IndexedDB. They have to be exported from an older build and imported here.

---

# Original plan

**Historical migration request.** This records the browser-era starting point and staged work that is now complete. Old `src/App.tsx`, `src/main.tsx`, `src/hooks/` and other UI paths below now live under `src/renderer/`; IndexedDB persistence has been replaced by the simulation host's file saves. Use [the project README](../README.md), [current player validation](./PLAYER_VALIDATION.md) and the completion report above for present setup/results. The original inspection lists and temporary migration steps below are not current architecture instructions.

Work in the current `Latteralus/The-Wyrnlands` repository.

I want to migrate The Wyrnlands from its current browser/Vite application into a proper Electron desktop application.

This is an architectural migration, not a rewrite of the game.

The existing simulation engine, economy, tests, deterministic behavior, React screens, player systems, and game rules should be preserved unless a change is specifically required by the desktop architecture.

The long-term architecture should allow us to:

- run React only as the user interface;
- run the simulation independently of the renderer;
- eventually replace `sql.js` with native/file-backed SQLite;
- save games directly to files;
- support autosaves/manual saves;
- support significantly richer real-time NPC/business activity;
- keep the renderer responsive while the simulation is busy;
- preserve headless simulation testing.

Do NOT immediately rewrite the engine or replace every persistence system at once.

Use a staged migration with validation after every major step.

Before changing anything, thoroughly inspect the current repository.

Read at minimum:

- `README.md`
- `MASTERPLAN.md`
- `DECISIONS.md`
- `PERFORMANCE_AUDIT.md`
- `package.json`
- Vite config
- TypeScript configs
- `src/App.tsx`
- `src/main.tsx`
- `src/hooks/useGameClock.ts`
- `src/engine/engine.ts`
- `src/engine/index.ts`
- `src/engine/checkpoint.ts`
- `src/engine/db/`
- `src/engine/ui-api/`
- `src/engine/seed/demoWorld.ts`
- action registry/action queue code
- current save/load work if it now exists
- existing test configuration
- headless runner
- any browser-specific assumptions throughout the project

Run the full existing validation suite before edits and record the baseline.

# High-level target

The eventual desktop architecture should look approximately like:

```text
Electron Application

┌──────────────────────────────────────┐
│ Renderer Process                     │
│                                      │
│ React                                │
│ Screens                              │
│ HUD                                  │
│ Character / Business / Market UI     │
│                                      │
│ No direct simulation DB ownership    │
└────────────────┬─────────────────────┘
                 │
                 │ typed IPC
                 ▼
┌──────────────────────────────────────┐
│ Simulation Process                   │
│ Electron utility process or worker   │
│                                      │
│ Engine                               │
│ Clock                                │
│ Actions                              │
│ NPCs                                 │
│ Companies                            │
│ Markets                              │
│ Households                           │
│ RNG                                  │
│ Persistence                          │
└────────────────┬─────────────────────┘
                 │
                 ▼
          SQLite save/database
```

However, do NOT jump immediately to the final architecture if doing so makes the migration unsafe.

First establish Electron while keeping the existing game working.

Then move boundaries cleanly.

# Core migration principles

Preserve these existing architectural rules:

1. The simulation engine remains independent of React.
2. The database remains the authoritative simulation state.
3. Same state + same RNG state must remain deterministic.
4. React must not directly manipulate SQLite.
5. Engine code must remain runnable headlessly in Node tests.
6. Simulation behavior must not change merely because the host platform changed.
7. Existing migrations must continue working.
8. Conservation/provenance audits must remain valid.
9. Player and NPC rules must remain shared where currently shared.
10. Do not introduce Electron APIs into pure engine modules.

# Phase 1 — Introduce Electron without changing the simulation architecture

First convert the application into a working Electron app while keeping the existing React/Vite frontend.

Set up an appropriate Electron structure.

For example:

```text
src/
  renderer/
  electron/
    main.ts
    preload.ts
  engine/
```

or another clean structure suited to the existing repository.

Do not unnecessarily move every existing file simply to fit this exact folder layout.

The important separation is:

```text
Electron main/preload
Renderer
Engine
```

The renderer should continue using React.

Use the current Vite setup where practical.

Choose a modern Electron + Vite integration that is maintainable and does not require unnecessary framework replacement.

Update:

- `package.json`
- build scripts
- development scripts
- production packaging scripts
- TS configuration as necessary

Add convenient commands such as conceptually:

```text
npm run dev
npm run build
npm run electron
npm run package
npm run validate
```

Use sensible actual names based on existing conventions.

Acceptance for Phase 1:

- Electron window opens.
- Current game UI renders.
- Current game still plays.
- No new console errors.
- Existing tests pass.
- Production build succeeds.

Do not continue into major architectural changes until this is working.

# Phase 2 — Electron security model

Use a safe Electron architecture.

Renderer must NOT run with unrestricted Node access.

Use:

```text
contextIsolation: true
nodeIntegration: false
```

Expose only explicitly approved functionality through `preload.ts`.

Do not expose:

```text
fs
child_process
raw ipcRenderer
arbitrary Node execution
```

directly to React.

Create a narrow typed bridge.

Conceptually:

```ts
window.wyrnlands = {
  ...
}
```

with a deliberately small API.

Follow Electron security best practices.

# Phase 3 — Separate the game session from React lifecycle

Currently `App.tsx` creates and owns an Engine instance directly.

That must eventually stop.

React should not be the simulation host.

Create a simulation-host abstraction.

Initially this may still run in-process while interfaces are established.

Conceptually:

```ts
interface SimulationClient {
  newGame(config): Promise<...>
  loadGame(...): Promise<...>
  advance(...)
  pause()
  setSpeed(...)
  query...
  command...
  subscribe(...)
}
```

Do NOT simply expose the entire Engine object over IPC.

The boundary should consist of:

```text
queries
commands
notifications
```

This is important because actual objects/functions cannot safely be shared across Electron process boundaries.

# Phase 4 — Design a typed simulation protocol

Create a clear protocol between renderer and simulation host.

Examples:

## Commands

```text
newGame
loadGame
saveGame
setSpeed
pause
queueAction
interruptAction
applyForJob
quitJob
foundCompany
changePlayerPolicy
```

## Queries

```text
getPlayer
getCalendar
getSettlement
getCharacterProfile
getHouseholdProfile
getBusinessProfile
listBusinesses
listMarket
listJobs
getCurrentActions
```

## Notifications

```text
simulation.updated
clock.changed
event.created
player.changed
market.changed
business.changed
save.completed
```

Do not create dozens of tiny IPC calls for individual DB fields if snapshots/batched queries are more appropriate.

Do not allow renderer code to send arbitrary SQL.

Use TypeScript definitions shared between renderer, preload, and simulation host.

# Phase 5 — Move simulation execution out of the renderer

Once the protocol exists and the renderer no longer depends directly on Engine internals, move the simulation into a dedicated execution context.

Preferred target:

- Electron utility process;

or, if there is a strong compatibility reason:

- Node worker thread.

Use the option that gives the simulation a separate execution context without breaking engine/test portability.

The Electron renderer should no longer own:

- the Engine;
- sql.js database instance;
- game clock;
- RNG;
- simulation tick loop.

The simulation process should own all of these.

Conceptually:

```text
Renderer
   │
   │ command: setSpeed(4)
   ▼
Simulation Process
   │
   │ advances world
   ▼
Renderer receives state/event updates
```

# Phase 6 — Move the game clock to the simulation process

Currently `useGameClock.ts` drives the simulation from React/browser timers.

That architecture should change.

The simulation host should own:

- paused state;
- current speed;
- tick advancement;
- time skipping.

The renderer should only request:

```text
Pause
1×
4×
16×
Skip to morning
Skip to action completion
```

and display the resulting simulation state.

Do not let React rendering delays control simulation progression.

Preserve deterministic simulation semantics.

Real-world timer scheduling should determine when batches are requested/run, but simulation results must remain based on game ticks rather than wall-clock timestamps.

# Phase 7 — Renderer updates should be event/state driven

Do not force the renderer to query the entire simulation state continuously every 200ms.

Introduce a sensible notification model.

Possible pattern:

```text
Simulation advances batch
↓
determines changed domains
↓
renderer receives invalidation/event notification
↓
renderer refreshes relevant snapshots
```

or sends a compact updated snapshot directly.

Examples of changed domains:

```text
clock
player
market
businesses
households
location-presence
logs
```

Avoid premature micro-optimization.

The immediate goal is simply to stop treating React rerenders as the simulation clock.

# Phase 8 — Keep sql.js temporarily

Do NOT replace sql.js in the same first migration step unless it is trivial after inspection.

First prove:

```text
Electron
+
separate simulation process
+
existing Engine
+
existing sql.js
```

works correctly.

This gives us an apples-to-apples behavioral baseline.

Run deterministic simulations and compare against pre-Electron results.

Only after the Electron/process boundary is stable should the database backend change.

# Phase 9 — Introduce a database abstraction boundary if necessary

Inspect how tightly the engine relies on sql.js-specific APIs.

Create the smallest DB adapter/interface necessary to allow both:

```text
sql.js
```

and:

```text
native SQLite
```

without rewriting economic systems.

Do not create an enormous generic ORM.

The existing engine has straightforward operations such as:

```text
db.run
prepared statements
queryRow
queryRows
transactions
savepoints
export
```

Build around actual needs.

Keep existing helper APIs where practical so the rest of the engine barely notices the backend change.

# Phase 10 — Native/file-backed SQLite

After the Electron migration is stable, implement a native/file-backed SQLite backend for the Electron simulation process.

Evaluate appropriate choices available in the project's Electron/Node version.

Possible options include:

- Node's native `node:sqlite`;
- another mature native SQLite library if compatibility/performance/testing strongly favors it.

Choose based on actual Electron/Node support, packaging reliability, transaction support, prepared statements, migrations, and performance.

Document the choice in `DECISIONS.md`.

The simulation process should operate against an actual save file such as:

```text
<userData>/saves/<save-id>/world.sqlite
```

rather than keeping the entire production game database only in WASM memory.

Preserve the SQLite schema and migration system where practical.

# Phase 11 — Do not blindly carry `engine.export()` semantics into native SQLite

With sql.js:

```text
save = export DB bytes
```

With native file-backed SQLite:

```text
database file itself = live save
```

Design the save lifecycle appropriately.

Manual Save / Save As may copy or checkpoint the database safely.

Autosave may primarily mean ensuring committed DB state and maintaining save metadata/backups.

Do not repeatedly serialize a massive DB unnecessarily merely because the browser implementation had to.

Keep portable export/import functionality.

# Phase 12 — Save directory

Use Electron's application user-data directory.

Do not hardcode OS-specific paths.

Conceptually:

```text
app.getPath('userData')
  / saves
      / <save-id>
          world.sqlite
          metadata.json
          thumbnail.png   optional later
```

Metadata can contain:

```text
saveId
characterName
worldSeed
simulationTick
year
season
day
createdAt
updatedAt
gameVersion
saveFormatVersion
```

Wall-clock metadata must remain outside deterministic simulation state where appropriate.

# Phase 13 — Portable saves

Retain player ownership of saves.

Support:

```text
Export Save
Import Save
```

A portable `.sqlite` save is preferable if possible.

Use native Electron file dialogs through the preload/main-process API.

React should not directly call `fs`.

# Phase 14 — Migrations

Existing SQLite migrations must continue working.

Loading an older save should:

```text
open DB
→ inspect migration state
→ apply required migrations
→ start simulation
```

Do not create special migrations that only work with sql.js.

Add tests proving the same save can migrate under the new backend.

# Phase 15 — Headless tests must remain

Do not make the Engine depend on Electron.

The existing Node/Vitest/headless simulation must continue working.

Ideally support:

```text
Engine + test DB backend
```

without starting Electron.

Electron-specific process code should be a host around the engine, not inside the engine.

# Phase 16 — Real-time NPC/business architecture groundwork

Once Electron + simulation process + native SQLite are stable, evaluate moving the active settlement toward real scheduled actions.

Do NOT immediately rewrite every NPC.

First establish a generic simulation scheduler.

The desired future model is:

```text
NPC starts activity
→ activity has start tick
→ activity has end tick
→ nothing expensive happens until needed
→ completion resolves consequences
→ NPC chooses/schedules next activity
```

For example:

```text
Katla Oster
06:20 starts farm shift
12:20 shift completes
```

At 12:20:

```text
production resolves
wage transfers
skill XP applies
tool wears
next activity scheduled
```

This is preferable to evaluating every NPC every minute.

# Phase 17 — Event-driven simulation, not brute-force per-minute AI

The long-term goal is NOT:

```ts
every minute:
  for every NPC:
    think()
```

Instead:

```text
priority queue / scheduled action table

next events:
08:20 household shopping finishes
09:00 baker shift begins
10:30 merchant arrives
12:20 farm shift finishes
13:00 logging shift finishes
```

Only process events when their simulation time becomes due.

The simulation can still advance minute ticks for the player and clock where required, but expensive actor decisions should occur at meaningful boundaries.

Design this so it could eventually handle:

- work shifts;
- shopping;
- eating;
- sleeping;
- travel;
- business production;
- merchant arrival/departure;
- deliveries;
- construction;
- social activity.

Do not fully implement all those systems now.

# Phase 18 — Current action state

If appropriate, introduce a persistent scheduled/current-action model for NPC/background actors.

Conceptually:

```text
scheduled_actions

id
actor_id
action_type
start_tick
end_tick
location_id
status
parameters
```

Before adding a new table, inspect the existing actions architecture and determine whether it can be generalized instead.

Do NOT create duplicate action frameworks if the existing one can be extended cleanly.

The player and NPCs should ultimately use compatible action semantics where practical.

# Phase 19 — Strategic decisions remain lower frequency

Do not confuse real-time operations with constant strategic thinking.

Businesses may operate continuously while strategic decisions remain:

```text
daily
weekly
fortnightly
```

For example:

```text
Operational:
worker shifts
production
delivery
sales

Strategic:
hiring
wages
expansion
pricing policy
capital investment
founding
closure
```

This avoids wasting CPU while creating a world that visibly moves.

# Phase 20 — NPC LOD remains important

Electron/native SQLite does NOT mean abandoning simulation LOD.

The intended future hierarchy should remain roughly:

```text
Active settlement
  real scheduled individual actions

Nearby/regional settlements
  hourly/daily simulation

Distant settlements
  daily/weekly aggregation
```

Do not design the active-settlement improvements in a way that forces every future regional NPC to run at full fidelity.

# Phase 21 — Database/log growth

Desktop/native SQLite gives more headroom, but does not make wasteful history free.

Review the existing known event-log/storage growth problem.

Do NOT persist every visual/action heartbeat.

Distinguish:

```text
CURRENT STATE
Katla is working until 12:20

HISTORY
Katla completed a farm shift.

EPHEMERAL PRESENTATION
Katla swings an axe.
```

Only meaningful state/history should be persisted.

Do not write one DB event per simulated minute for every NPC.

Maintain provenance where economically meaningful.

# Phase 22 — IPC performance

Do not stream thousands of tiny IPC messages for every trivial event.

Batch when appropriate.

For example:

```text
simulation batch result:
  tick advanced to X
  14 events occurred
  market changed
  3 businesses changed
  player state changed
```

The renderer can refresh those domains.

Measure IPC overhead rather than assuming it is free.

# Phase 23 — Shutdown safety

On application close:

- pause simulation;
- finish/rollback any active DB transaction safely;
- persist current deterministic RNG state if needed;
- close SQLite cleanly;
- update save metadata;
- then allow app exit.

Avoid corrupted saves if the user closes the window during high-speed simulation.

Use Electron lifecycle hooks appropriately.

# Phase 24 — Crash/recovery safety

If practical, add simple defensive persistence:

```text
world.sqlite
world.sqlite.backup
```

or SQLite-safe snapshot/backups at reasonable intervals.

Do not build a huge journaling system.

Native SQLite's own transactional guarantees should do most of the work.

Document actual failure semantics.

# Phase 25 — Development ergonomics

Maintain:

- fast renderer hot reload;
- useful simulation logging;
- Vitest;
- headless scenario scripts;
- production build;
- packaged Electron app.

Avoid forcing developers to rebuild/package Electron just to run engine tests.

# Phase 26 — Packaging

Set up a reliable packaging flow for at least the current development OS.

Prefer an established Electron packaging solution.

Include required native SQLite dependencies correctly.

Do not assume a native module works after packaging—test the packaged application.

Make sure:

- preload loads;
- renderer assets resolve;
- SQLite can create/open saves;
- writable save path is outside packaged application resources;
- imports/exports work.

# Phase 27 — Tests

Add significant tests around the migration.

At minimum:

## Platform boundary

1. Engine remains runnable without Electron.
2. Renderer does not import Engine/database modules directly after process separation.
3. Renderer communicates through typed bridge/protocol.
4. Node integration remains disabled.
5. preload exposes only approved API.

## Simulation process

6. New game can be created through the simulation host.
7. Commands modify simulation correctly.
8. queries return correct snapshots.
9. event notifications reach the client.
10. pause/speed changes work.
11. renderer disconnect/reconnect does not corrupt state.

## Determinism

12. Same seed produces same simulation result as before migration.
13. Batched vs incremental advancement remains deterministic.
14. simulation-process execution matches headless Engine execution.
15. save/reload resumes RNG correctly.

## SQLite migration

16. Existing sql.js-backed tests still pass during Phase 1.
17. Native SQLite produces equivalent logical results.
18. migrations work.
19. transactions/savepoints work.
20. conservation audit passes.
21. provenance remains valid.

## Saves

22. game persists to a real file.
23. reload restores player/world state.
24. manual save works.
25. autosave works.
26. export/import works.
27. app shutdown leaves a valid save.
28. malformed save errors gracefully.

## Electron smoke

29. app launches.
30. React renderer loads.
31. game can start.
32. game can advance.
33. app can save/load.
34. no renderer console errors.
35. packaged application can load/create saves.

# Phase 28 — Benchmarks

Before and after each major architecture step, measure:

- 1 simulated day;
- 30 simulated days;
- 365 simulated days;
- 1,095 simulated days where practical;
- memory usage;
- DB file growth;
- renderer responsiveness;
- simulation process memory;
- CPU usage at 1×/4×/16×;
- long-run deterministic outcomes.

Record results in the appropriate audit/decision document.

Especially compare:

```text
browser + sql.js
Electron renderer + sql.js
Electron simulation process + sql.js
Electron simulation process + native SQLite
```

where practical.

Do not claim a performance improvement without measuring it.

# Phase 29 — Existing game behavior must survive

After migration, confirm:

- world creation;
- player creation;
- player autonomous routine;
- character screens;
- needs;
- skills;
- jobs;
- job haggling;
- household simulation;
- NPC business founding;
- company production;
- market activity;
- merchant imports/exports;
- land tenure;
- business closure;
- business growth;
- entrepreneurship;
- conservation audit;
- save/load;
- deterministic checkpoints/tests.

No simulation feature should disappear merely because the host changed.

# Phase 30 — Documentation

Update `DECISIONS.md` with:

- why Electron was chosen;
- process architecture;
- IPC boundary;
- renderer responsibilities;
- simulation-process responsibilities;
- SQLite backend decision;
- save location/format;
- event-driven simulation direction;
- security decisions;
- measured performance/memory differences;
- remaining migration risks.

Update `MASTERPLAN.md` where architecture changed.

Update README with desktop development/build instructions.

# Important scope rule

Do NOT combine this migration with a giant gameplay rewrite.

The priority order is:

```text
1. Electron shell works
2. Existing game works unchanged
3. Renderer/simulation boundary established
4. Simulation moved out of renderer
5. Persistence works
6. Native SQLite works
7. Performance/determinism proven
8. THEN richer real-time NPC scheduling
```

If real-time NPC actions cannot safely fit into this migration after the platform work, stop at a clean architectural boundary and provide a detailed follow-up plan.

Do not leave half of the game using direct Engine access while another half uses IPC unless this is a temporary intermediate state inside the implementation and fully removed before final completion.

# Final validation

Run the entire validation suite after migration.

Run browser-independent engine tests.

Run Electron smoke tests.

Run packaged-app smoke tests.

Run deterministic save/load tests.

Run long simulations.

Run conservation audits.

Then provide a final report covering:

- pre-migration baseline;
- Electron version/tooling chosen;
- final process architecture;
- renderer/simulation separation;
- whether sql.js remains or native SQLite is complete;
- save-file architecture;
- IPC API;
- security configuration;
- performance before/after;
- memory before/after;
- test results;
- packaged-app results;
- remaining known risks;
- recommended next step for real scheduled NPC/business actions.

The guiding architectural goal is:

> Electron is not merely a wrapper around the existing website. It should become a desktop host in which React presents the world, a dedicated simulation process runs the world, and SQLite persists the world.

The guiding simulation goal after the migration is:

> NPCs and businesses should eventually be capable of performing real timed activities throughout the day without requiring every NPC to execute expensive AI logic every simulated minute.
