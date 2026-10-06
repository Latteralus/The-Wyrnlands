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
