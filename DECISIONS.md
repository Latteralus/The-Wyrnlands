# DECISIONS.md

Tracks where the implementation diverges from, or makes a specific choice within, MASTERPLAN.md. Append-only; newest entries at the top.

---

## 2026-07-14 — Project scaffold (Stage 0, partial)

**What was built:**
- Vite + React 19 + TypeScript shell (`npm run dev` / `npm run build`), Vitest for headless engine tests (`npm test`).
- `src/engine/` — pure TypeScript, zero React/DOM dependency, per §4.2:
  - `db/` — sql.js bootstrap split into `sqlite.ts` (shared wrapper), `sqlite.node.ts` (Node/tsx/Vitest, locates the wasm binary via `require.resolve`), `sqlite.browser.ts` (Vite app, fetches `/sql-wasm.wasm` from `public/`).
  - `db/migrations/` + `migrationRunner.ts` — ordered migrations, tracked in a `schema_migrations` table, applied idempotently. Schema v1 so far only has `world_meta` and `event_log` (§16's full data model — entities, items/provenance, actions, inventories, etc. — lands incrementally, one module per session per §19).
  - `eventBus.ts` — the event bus modules communicate through (§4.2's "DB + event bus only" rule).
  - `rng.ts` — seeded deterministic RNG (mulberry32 + FNV-1a string hashing) so "same DB + same seed = same result" (§4.2) is actually testable.
  - `time/clock.ts` — tick → minute/day/season/year derivation (§4.3 calendar).
  - `logs/logger.ts` — subscribes to the event bus, writes to `event_log`, exposes scoped queries (personal/business/settlement/world, §14.3).
  - `engine.ts` — the `Engine` class: bootstrap (migrate + seed world_meta), `advanceTicks`, `export`/save bytes, log queries. The tick loop itself is currently a no-op counter increment; module cadence hooks (needs, actions, market, ...) attach here as each module is built.
  - `ui-api/` — the narrow engine↔UI surface (`createUiApi`) React is meant to consume instead of reaching into `Engine`/`db` directly.
  - `headless-runner.ts` — `npm run sim:headless [seed]`, runs 10,000 ticks and prints tick/calendar/world-log, per the Stage 0 exit test.
- Directories created (currently empty, populated as each module is built): `needs`, `actions`, `jobs`, `production`, `inventory`, `market`, `households`, `companies`, `construction`, `housing`, `transport`, `population`.

**Decisions:**
- **`schema_migrations` stores no timestamp.** A wall-clock `applied_at` column made two identical-seed runs export different DB bytes, which directly violates the §4.2 determinism invariant. Migration provenance already lives in git history; the DB only needs to know *which* migrations have run, not *when*.
- **sql.js bootstrap is split by platform (`sqlite.node.ts` / `sqlite.browser.ts`), not unified with a runtime check.** Locating the wasm binary is inherently platform-specific (Node `require.resolve` vs. a `fetch`-able `public/` path); trying to unify it behind one `typeof window` branch risks bundlers pulling `node:module`/`node:path` into the browser chunk. The actual engine logic (schema, migrations, tick loop) is unaffected and shared.
- **`tsconfig.app.json` includes `"node"` in `types`**, even though it's the browser app's tsconfig. `tsc -b`'s `include: ["src"]` pulls in `sqlite.node.ts`/`headless-runner.ts`/tests transitively regardless of any `exclude`, so they need Node's ambient types to type-check; this doesn't add any actual Node runtime dependency to the browser bundle.
- **Calendar model:** 30 days/season × 4 seasons = 120-day year, tick = 1 in-game minute (§4.3). No leap logic, no partial seasons — reassess if the balance harness (§17) needs finer control.
- **`sqlite.browser.ts` imports `sql.js/dist/sql-wasm.js` directly, not the bare `sql.js` specifier.** Found by actually driving the app in a browser (Playwright): Vite's `browser` export condition resolves the bare specifier to `dist/sql-wasm-browser.js`, whose companion binary is `sql-wasm-browser.wasm` — a second wasm file to keep in sync in `public/`, and one that silently 404s into the SPA's `index.html` fallback if you only copy `sql-wasm.wasm`. Pinning both platforms (`sqlite.node.ts` and `sqlite.browser.ts`) to the same explicit build keeps there being exactly one wasm file (`public/sql-wasm.wasm`) to remember to update if `sql.js` is upgraded. `vite build` prints harmless "node:fs/node:crypto externalized for browser compatibility" warnings for this same file — those paths are guarded by Node-only feature checks that never execute in the browser bundle; confirmed clean (no runtime errors, tick/log UI works) via an actual Playwright-driven browser run.

**Exit-test status (Stage 0, §Stage 0):** 10,000 deterministic headless ticks ✅, save→load→resave identical bytes ✅ (both covered by `src/engine/engine.test.ts`). Not yet done: timed-action framework with failure outcomes, grid-coordinate world model, conservation audit, provenance recording — these are separate module sessions per §19.
