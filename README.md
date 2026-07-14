# The Wyrnlands

Offline medieval life-simulation / economic sandbox. Read [MASTERPLAN.md](./MASTERPLAN.md) for the design; [DECISIONS.md](./DECISIONS.md) for where the code diverges from or refines it.

## Stack

React 18/19 + TypeScript UI, a pure-TypeScript simulation engine (`src/engine/`, zero React/DOM dependency), SQLite via sql.js as world state, Vite, Vitest.

## Commands

```
npm run dev           # start the Vite dev server
npm run build          # typecheck + production build
npm test               # run engine tests headlessly (Vitest)
npm run test:watch     # Vitest in watch mode
npm run sim:headless   # run N ticks of the engine outside the browser (see src/engine/headless-runner.ts)
npm run lint            # oxlint
```

## Layout

- `src/engine/` — the simulation. Runs identically in Node (tests, headless runner) and the browser. Modules: `time`, `needs`, `actions`, `jobs`, `production`, `inventory`, `market`, `households`, `companies`, `construction`, `housing`, `transport`, `population`, `logs`, `ui-api`, `db`. Communicate only via the DB and `eventBus.ts`.
- `src/engine/ui-api/` — the only surface React is allowed to import from the engine.
- React screens live at `src/` root (`App.tsx`, etc.) and consume `ui-api` only, never `db` or `Engine` directly.
