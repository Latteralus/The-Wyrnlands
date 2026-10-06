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