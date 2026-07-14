# The Wyrnlands

Offline medieval life-simulation / economic sandbox. Read [MASTERPLAN.md](./MASTERPLAN.md) for the design; [DECISIONS.md](./DECISIONS.md) for where the code diverges from or refines it.

## Stack

React 18/19 + TypeScript UI, a pure-TypeScript simulation engine (`src/engine/`, zero React/DOM dependency), SQLite via sql.js as world state, Vite, Vitest.

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
```

## Layout

- `src/engine/` — the simulation. Runs identically in Node (tests, headless runner) and the browser. Modules: `time`, `needs`, `actions`, `jobs`, `production`, `inventory`, `market`, `households`, `companies`, `construction`, `housing`, `transport`, `population`, `logs`, `ui-api`, `db`, `seed`. Communicate only via the DB and `eventBus.ts`.
- `src/engine/ui-api/` — the only surface React is allowed to import from the engine (re-exports the engine types components need, too).
- `src/engine/seed/` — one-time world bootstrap (demo/starting data), called directly against `Engine` before `ui-api` is created — not a runtime UI operation.
- `src/screens/` — top-level views (settlement, location panel) that `App.tsx` switches between.
- `src/components/` — reusable UI pieces (HUD, log panel, time controls, scene header, action queue).
- `src/hooks/` — React hooks (the game clock: pause/1×/4×/16×, skip controls).
- `src/data/` — static UI-side content keyed by engine data (e.g. per-site-kind icon/description/actions) — not engine state itself.
- React screens/components consume `ui-api` only, never `db` or `Engine` directly.
