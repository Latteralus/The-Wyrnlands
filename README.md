# The Wyrnlands

Offline medieval life-simulation / economic sandbox, played as a desktop app. Read [MASTERPLAN.md](./Documents/MASTERPLAN.md) for the design and [DECISIONS.md](./Documents/DECISIONS.md) for where the code diverges from or refines it. [SETTLEMENT_ACTIVITIES.md](./SETTLEMENT_ACTIVITIES.md) records the implemented timed NPC/business activities, cadence audit and performance/economy comparisons. [PERFORMANCE_AUDIT.md](./Documents/PERFORMANCE_AUDIT.md) and [STAGE5_AUDIT.md](./Documents/Archive/STAGE5_AUDIT.md) record earlier performance and economy work. Other documents and archived plans are under ./Documents/.

[Documentation guide](./Documents/README.md) distinguishes current desktop references, future gameplay plans and historical browser-era records. [Player validation](./Documents/PLAYER_VALIDATION.md) records the latest desktop coverage; the archived Stage 5 audit records earlier economy findings, not the current implementation status.

## Stack

Electron 44 desktop app. React 19 + TypeScript interface (renderer), a pure-TypeScript simulation engine (`src/engine/`, no React/DOM/Electron dependency) running in its own process, SQLite as the world state: native, file-backed SQLite (Node's built-in `node:sqlite`) in the game, sql.js (WebAssembly) in tests and as a fallback. Vite, Vitest, electron-builder.

```text
Electron main process      window, app:// protocol, file dialogs, simulation process lifecycle
  └─ renderer (sandboxed)  React screens — talks only to window.wyrnlands (src/electron/preload.ts)
        │  typed protocol over a MessagePort: views, commands, notifications (src/shared/protocol.ts)
        ▼
  simulation process       Electron utility process: Engine, clock, RNG, saves (src/sim-host/)
        ▼
  <userData>/saves/<save>/world.sqlite (+ metadata.json)
```

## Commands

Install dependencies with `npm ci`, then use `npm run dev` to open the Electron game with Vite hot reload. Vite alone serves the renderer and does not provide the simulation/preload bridge; opening its URL in a normal browser does not run the game. Electron is installed with the development dependencies, including its bundled Node runtime.

```
npm run dev              # the desktop game with hot reload (Vite renderer + Electron, restarts on main/sim changes)
npm run build            # typecheck + renderer build + Electron bundles (dist/, dist-electron/)
npm run electron         # start the built app (after npm run build)
npm run package          # build + package for this OS → release/win-unpacked/
npm run package:installer   # build + Windows installer (NSIS) → release/
npm run typecheck        # tsc -b only
npm run lint             # ESLint (type-aware)
npm run lint:fix         # ESLint --fix
npm run format           # Prettier --write
npm run format:check     # Prettier --check
npm test                 # engine, host and protocol tests on your Node (Vitest; sql.js)
npm run test:native      # the same suite on Electron's own Node, including the native-SQLite tests
npm run test:watch       # Vitest in watch mode
npm run test:electron    # desktop smoke test of the built app (Playwright's Electron driver)
npm run test:packaged    # the same smoke test against the packaged executable
npm run validate         # typecheck + lint + format:check + test + test:native + build
npm run validate:desktop # validate + test:electron + package + test:packaged
npm run sim:headless     # run N ticks of the engine outside the app (src/engine/headless-runner.ts)
npm run sim:perf -- --days 730 --sample 30 [--no-player] [--named-player] [--econ out/prefix]
                         # long-run harness: timing, row counts, SQL profile, determinism
                         # fingerprint, optional economy report CSV/JSON (src/engine/perf/longRun.ts)
npm run sim:perf:electron -- --backend native [--db-file world.sqlite] --days 365 …
                         # the harness on Electron's Node, on native SQLite (in memory, or file-backed like the game)
npm run bench:app        # the running game at 1×/4×/16×: frame gaps, input latency, CPU, memory per process
npm run sim:activities   # clock-sized activity batches at three population/business sizes and 1×/4×/16×
npm run bench:renderer   # the engine inside a Chromium page, as it ran before the desktop migration
```

`npm test` and the engine never need Electron to be built or packaged. `test:native` and `sim:perf:electron` use the installed Electron binary as a Node runtime without opening a window. Native-only tests skip when the system Node lacks the required SQLite APIs; they run on Electron's bundled runtime.

For a production-backend throughput comparison, use `--checkpoint 0 --commit day` with `--db-file`: the harness otherwise commits per scripted action, and native checkpoint rehydration switches to memory. The game's clock commits each batch, rather than once per simulated day. See [PERFORMANCE_AUDIT.md §9](./Documents/PERFORMANCE_AUDIT.md#9-desktop-migration--2026-10-06) for methodology. In Windows PowerShell, use `npm.cmd` for commands that forward `--flags` if `npm.ps1` consumes them; the direct Node commands in [PLAYER_VALIDATION.md](./Documents/PLAYER_VALIDATION.md) avoid that forwarding issue.

The smoke tests use fresh temporary profiles (`--user-data-dir`) and never touch real saves. `node scripts/electron-smoke.mjs --executable "C:\path\The Wyrnlands.exe"` tests an installed build with the same flow; add `--sim-backend sqljs` to test the fallback. `npm run electron -- --sim-backend=sqljs` (or the same flag on the packaged app) runs the simulation on sql.js instead of native SQLite.

`npm run package:installer` produces `release/The Wyrnlands Setup 0.1.0.exe` and the unpacked build. The installer is currently unsigned and uses Electron's default icon; signing, a custom icon and disabling inspect arguments remain public-release tasks. Simulation diagnostics appear in the dev terminal and rotate under `<userData>/logs/simulation.log`.

## Layout

- `src/engine/` — the simulation. Pure TypeScript; runs identically in Node (tests, headless runner) and in the simulation process. Modules: `time`, `needs`, `skills`, `gear`, `goods`, `actions`, `jobs`, `production`, `inventory`, `market`, `households`, `companies`, `population`, `logs`, `ui-api`, `db`, `seed`, `scenarios`, `reports`, `perf`. Communicate only via the DB and `eventBus.ts`.
- `src/engine/db/` — the `Database` interface every engine module uses (`sqlite.ts`), its sql.js implementation, and the native one (`sqlite.native.ts`, Node-only); migrations.
- `src/engine/ui-api/` — the engine's read/command façade for the interface; the simulation host builds the renderer's views from it.
- `src/sim-host/` — the simulation host: owns the running game (Engine, clock, autosave, the save library) and serves the protocol. Plain Node, no Electron — tested in Vitest.
- `src/shared/` — the typed protocol (`protocol.ts`), RPC envelope and pure game data the interface displays (`gameRules.ts`). Shared display data may import an explicitly approved set of pure engine data/formulas; the renderer graph is checked by the boundary tests.
- `src/electron/` — the main process (`main.ts`), the sandboxed preload bridge (`preload.ts`), and the simulation process entry (`simProcess.ts`).
- `src/renderer/` — React: `App.tsx`, `screens/`, `components/`, `hooks/`, `data/`, and `sim/` (the protocol client, live state store, `useView` hooks). No direct imports of Engine, database, simulation host, Electron or Node; approved pure game data flows through shared modules (enforced by ESLint and `src/shared/boundary.test.ts`).
- `src/engine/seed/` — one-time world bootstrap (demo/starting data).
- `src/engine/reports/` — read-only statistical snapshots of the world (the economy report behind the §17 balance harness).
- `src/engine/perf/` — measurement tooling (SQL profiler, phase timer, benchmark core, the `sim:perf` harness). Nothing in the simulation depends on it.
- `src/engine/scenarios/` — headless multi-tick scenario tests (the stage exit tests).
- `scripts/` — dev/build/packaging/smoke/benchmark scripts.

## Player flow and persistence

The app opens at a title screen. New Game creates a named character and household using Standard or Custom starting resources. Character and Home show your own possessions, skills, employment, history and routine preferences. Businesses exposes transactional founding on available parcels; the Market lists tools and goods.

Saves are files in the app's data folder (`%APPDATA%\The Wyrnlands\saves` on Windows): one folder per save, each with `world.sqlite` (a complete SQLite database — the world) and `metadata.json` (what the save list shows). With native SQLite, the game you're playing *is* `saves/autosave/world.sqlite`: every batch of ticks and every action commits with its RNG state. A process crash preserves the last committed batch; an OS crash or power loss can lose recent commits with WAL's `synchronous=NORMAL`. The sql.js fallback persists on autosave and orderly close. The metadata refreshes every minute; a native safety copy (`world.sqlite.backup`) is taken every ten minutes of changing play and restored automatically if the live file is damaged. Manual saves are snapshots in their own folders; loading one copies it into the autosave slot (the previous autosave is kept once as "Autosave backup"). Continue resumes the most recently saved valid life.

Export and Import (Save/Load screen) use the system's file dialogs and plain `.sqlite` files, portable between machines and between the native and sql.js backends. Schema-22+ saves migrate forward on load; newer unsupported schemas/formats and damaged files are refused with a message. Saves from the old browser version lived in that browser's IndexedDB: export them from a browser build of an earlier version and import the `.sqlite` here.
