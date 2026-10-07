# The Wyrnlands

Offline medieval life-simulation / economic sandbox. Read [MASTERPLAN.md](./MASTERPLAN.md) for the design; [DECISIONS.md](./DECISIONS.md) for where the code diverges from or refines it. [PERFORMANCE_AUDIT.md](./PERFORMANCE_AUDIT.md) and [STAGE5_AUDIT.md](./STAGE5_AUDIT.md) record the long-run performance work and the current state of the Stage 5 economy. (All Documents now moved to ./Documents/ )

## Stack

React 19 + TypeScript UI, a pure-TypeScript simulation engine (`src/engine/`, zero React/DOM dependency), SQLite via sql.js as world state, Vite, Vitest.

## Commands

```
npm run dev           # start the Vite dev server
npm run build          # typecheck + production build
npm run typecheck       # tsc -b only
npm run lint            # ESLint (type-aware)
npm run lint:fix        # ESLint --fix
npm run format          # Prettier --write
npm run format:check    # Prettier --check
npm test               # run engine tests headlessly (Vitest)
npm run test:watch     # Vitest in watch mode
npm run validate        # typecheck + lint + format:check + test + build, in order
npm run sim:headless   # run N ticks of the engine outside the browser (see src/engine/headless-runner.ts)
npm run sim:perf -- --days 730 --sample 30 [--no-player] [--econ out/prefix]
                       # long-run harness: timing, row counts, SQL profile, determinism
                       # fingerprint, optional economy report CSV/JSON (src/engine/perf/longRun.ts)
```

## Layout

- `src/engine/` — the simulation. Runs identically in Node (tests, headless runner) and the browser. Modules: `time`, `needs`, `skills`, `gear`, `goods`, `actions`, `jobs`, `production`, `inventory`, `market`, `households`, `companies`, `construction`, `housing`, `transport`, `population`, `logs`, `ui-api`, `db`, `seed`, `scenarios`, `reports`, `perf`. Communicate only via the DB and `eventBus.ts`.
- `src/engine/ui-api/` — the only surface React is allowed to import from the engine (re-exports the engine types components need, too).
- `src/engine/seed/` — one-time world bootstrap (demo/starting data), called directly against `Engine` before `ui-api` is created — not a runtime UI operation.
- `src/engine/reports/` — read-only statistical snapshots of the world (the economy report behind the §17 balance harness).
- `src/engine/perf/` — measurement tooling (SQL profiler, phase timer, the `sim:perf` long-run harness). Nothing in the simulation depends on it.
- `src/engine/scenarios/` — headless multi-tick scenario tests (the exit-test scripts each stage's plan requires — e.g. a scripted actor surviving N days) rather than single-module unit tests.
- `src/screens/` — top-level views (settlement, location panel) that `App.tsx` switches between.
- `src/components/` — reusable UI pieces (HUD, needs bar, log panel, time controls, scene header, action queue).
- `src/hooks/` — React hooks (the game clock: pause/1×/4×/16×, skip controls).
- `src/data/` — static UI-side content keyed by engine data (e.g. per-site-kind icon/description/actions) — not engine state itself.
- React screens/components consume `ui-api` only, never `db` or `Engine` directly.

## Player flow and persistence

The app opens at a title screen. New Game creates a named character and household using Standard or Custom starting resources. Character and Home show your own exact possessions, skills, employment, history, and routine preferences. Businesses exposes transactional founding on available parcels; the existing Market lists tools and goods.

Saves live in IndexedDB as raw SQLite bytes, with manual slots and a 60-second autosave while playing. Continue resumes the most recently saved valid life. Export/import `.sqlite` files from Save/Load for portable backups. Schema-22 playable saves migrate forward; newer unsupported schemas/formats and damaged files are rejected. See Documents/DECISIONS.md for the purse/control model and remaining management/housing scope.

Browser smoke: start Vite on `127.0.0.1:5186`, install Playwright (Chrome must be installed), then run `node scripts/player-smoke.mjs`. Set `WYRN_SMOKE_URL` for another server URL and `WYRN_PLAYWRIGHT_MODULE` for an existing Playwright installation. No browser-testing dependency is added to the production game. Long-run player household validation uses `npm run sim:perf -- --named-player --days 730 --sample 180 --checkpoint 0 --no-profile`.
