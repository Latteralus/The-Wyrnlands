# DECISIONS.md

Tracks where the implementation diverges from, or makes a specific choice within, MASTERPLAN.md. Append-only; newest entries at the top.

---

## 2026-07-14 — The Interface Shell (Stage 1 complete, §Stage 1)

**What was built:**
- `ui-api` grew a real query/command surface beyond tick/calendar/log: `listSites`, `getSite`, `queueAction`, `getActorActions`, `interruptAction`, `getBalance`, plus re-exports of `Site`, `QueuedAction`, `Calendar`, `EngineEvent`/`EventScope`, and `MINUTES_PER_DAY` — so every component imports engine types from `ui-api` only, closing a gap the Stage 0 scaffold had left (`App.tsx` previously imported `EngineEvent` straight from `engine/eventBus`).
- `src/engine/seed/demoWorld.ts` (`seedDemoWorld`, idempotent like `ensureWorldMeta`): one player entity + wallet + starting coin (a placeholder faucet, not a rolled starting condition), four sites (well, tavern, notice board, forest), and four dummy `ActionDefinition`s — including `chop_wood` at a flat 75% success rate, deliberately exercising both the success and failure outcome paths through the UI.
- `src/hooks/useGameClock.ts`: drives pause/1×/4×/16× as a real `setInterval` loop (placeholder pacing: 5 game-minutes per 200ms tick at 1×) plus `skipToMorning`/`skipToActionComplete`, computed from `getCalendar`/`getActorActions` — no new engine capability needed, just arithmetic over what `ui-api` already exposes.
- Components (`Hud`, `ActionQueuePanel`, `TimeControls`, `SceneHeader`, `LogPanel`) and screens (`SettlementScreen`, `LocationScreen`), wired together by `App.tsx`'s own `View` state (`{kind:'settlement'}` / `{kind:'location', siteId}` — no router library, the screen count doesn't warrant one yet).
- `src/data/locationContent.ts`: per-site-kind icon, atmospheric description, and available dummy actions — placeholder content (§14.1), not the budgeted writing pass itself.

**Decisions:**
- **Components call `uiApi` getters directly during render instead of mirroring every value into `useState`.** The getters are synchronous sql.js queries against a small DB — cheap enough to call on every render — so a single `bump()` counter in `App.tsx` (triggered by the clock's `onAdvance` and by action-queuing handlers) is enough to force the whole tree to re-derive fresh state. Duplicating `tick`/`calendar`/`actions` into parallel `useState` would just be cache invalidation with extra steps.
- **World seeding happens by calling `Engine` methods directly in `App.tsx`'s bootstrap effect, before `createUiApi` is ever called** — not through `ui-api`. Seeding is a one-time setup concern (same category as `Engine.bootstrap` itself, which `App.tsx` already called directly), not a running-game operation; putting `registerActionType`/`createSite` on the UI-facing surface would let screens re-seed the world at runtime, which nothing should ever do.
- **Placeholder illustrations are a season/time-tinted CSS gradient (`SceneHeader`), not static images.** MASTERPLAN.md §14.1 calls out "season/time-tinted" location art specifically — a gradient keyed off `calendar.season` and day/night is the cheapest possible version of that *specific* requirement, versus a generic placeholder image that would have to be redone anyway once real art exists.
- **The dummy `chop_wood` action has a real (if placeholder) failure rate, not 100% success.** Stage 0's exit test already proved the engine handles failed actions; Stage 1's job is proving the *interface* renders that path too. A 100%-success demo action would have silently left the failure-outcome UI unverified until Stage 2's real skill-gated actions arrived.
- **`index.css`'s `#root` lost its Vite-starter `text-align: center` / fixed `1126px` width.** Both were leftover boilerplate fighting a real HUD/settlement layout (centered game text, a hard-capped width) with no other page depending on them; changed to `text-align: left` and `max-width`, keeping the light/dark theme variables untouched.

**Verification:** `npm run validate` passes (33 tests, unchanged — Stage 1 is UI-only, no engine behavior changed except the additive `ui-api`/`Engine.listSites` surface). Browser smoke test (Playwright against the Vite dev server): navigated settlement → forest location → back → settlement log tab with zero console errors; queued `chop_wood`, watched it sit `Queued` while paused, start and show a live progress bar at 4× speed, and resolve — this run landed on the **failure** branch ("You misjudge the swing and ruin the cut"), confirming both outcome paths render correctly through the personal log and the HUD's action-queue panel.

**Exit-test status (Stage 1, §Stage 1): met** — every panel (settlement, location, settlement log, personal log) is reachable, and a dummy timed action runs end-to-end with progress UI and log entries. Stage 2 (Survival Loop, §Stage 2) is next.

---

## 2026-07-14 — Dev tooling audit: strict TypeScript, ESLint, Prettier

Not a MASTERPLAN.md module — a tooling/dependency audit of the whole project, per §4.2's "modular and testable" and §19's engine/UI separation rules being worth actually enforcing at the compiler/linter level, not just by convention.

**What was built:**
- Replaced `oxlint` with **ESLint 9.39.5 + typescript-eslint 8.64.0** (`eslint.config.js`, flat config): `recommendedTypeChecked` (unsafe-type rules, floating promises), `eslint-plugin-react`/`react-hooks`/`react-refresh`, `eslint-plugin-unused-imports` (autofixable dead imports, distinct from unused locals), `eslint-plugin-import-x` + `eslint-import-resolver-typescript` (import ordering/duplicates). oxlint can't do type-aware linting at all, and the ask specifically wanted unsafe-type/floating-promise detection.
- Added **Prettier 3.9.5** (`.prettierrc.json`, `.prettierignore`) for formatting, scoped to code/config — `*.md` is excluded (see Decisions).
- Extracted **`tsconfig.base.json`**, shared by `tsconfig.app.json`/`tsconfig.node.json`, carrying `strict`, `forceConsistentCasingInFileNames`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitReturns` (plus the pre-existing `noUnusedLocals`/`noUnusedParameters`).
- New scripts: `typecheck`, `lint` / `lint:fix`, `format` / `format:check`, `validate` (chains typecheck → lint → format:check → test → build).
- New shared helper `src/engine/optional.ts` (`withOptional`) and `db/sqlite.ts` gained `queryRow`/`queryRows` — both born directly out of fixing the strict-mode fallout below, not speculative additions.

**Decisions:**
- **TypeScript stays at 6.0.3, not the newly-released 7.0.2.** typescript-eslint@8.64.0's peer range is `>=4.8.4 <6.1.0`; 6.0.3 is already the latest version inside that range (6.1+ doesn't exist yet as a stable release). Upgrading to 7.x would have silently broken all type-aware linting.
- **ESLint pinned to the 9.x line (9.39.5), not the newly-released 10.x.** Every plugin in the stack declares `eslint: ... || ^10.0.0` support except `eslint-plugin-react@7.37.5`, which caps at `^9.7`. "Latest compatible," not just "latest."
- **`eslint-plugin-import-x` needs `eslint-import-resolver-typescript`, not `eslint-import-resolver-node`.** The node resolver produced a wall of "invalid interface loaded as resolver" errors on every `import-x/*` rule — a real resolver/plugin-version mismatch, not a code issue. Swapping resolvers cleared ~80 of the ~81 initial ESLint errors in one change.
- **`db.exec()` returns `[]`, not `[{columns, values: []}]`, when a SELECT matches zero rows** — confirmed empirically (not documented in sql.js's own types), and it's what made `noUncheckedIndexedAccess` errors so pervasive across every `result[0].values[...]` call site. `queryRow`/`queryRows` centralize that distinction once instead of re-deriving it at ~15 call sites.
- **`withOptional()` exists because `Partial<Opt>` alone isn't `exactOptionalPropertyTypes`-clean** — it still carries the `| undefined` from `Opt`'s own inferred value types, which is exactly what that flag rejects at a target like `actorId?: string`. The helper's return type explicitly excludes `undefined` from each optional value, matching what the function actually guarantees at runtime. The alternative (widening every optional prop across the codebase to `T | undefined`) would have defeated the flag's purpose everywhere just to satisfy it in a few places.
- **Prettier excludes `*.md`.** It reformatted `MASTERPLAN.md`'s prose (italics syntax, table padding) on first run — cosmetically harmless, but rewriting the user's authored design doc as a side effect of a code-formatting pass wasn't in scope. Docs keep their own formatting conventions; `format`/`format:check` only touch code and config.
- **`no-base-to-string` fixes use `typeof` narrowing, not `String()` + a suppression.** `SqlValue` includes `Uint8Array`, which the rule won't assume stringifies sanely — even though our schema never actually stores blobs in those columns. Narrowing with `typeof row[n] === 'string'` before parsing is strictly more correct than the blind `String(row[n])` it replaced, not just quieter.

**Verification:** `npm run validate` (typecheck → lint → format:check → test → build) passes clean; all 33 existing tests still pass unchanged (only type-level fixes, no behavior changes); a real browser smoke test confirmed the dev server still boots after the tsconfig/engine-file changes.

---

## 2026-07-14 — Item provenance + conservation audit (Stage 0 complete, §7.1/§8.1/§16)

**What was built:**
- Migration `0004_inventory_and_audit`: `items` (single-container rule, status lifecycle), `provenance_events` (one item's full history), `wallets` (one balance per entity), `audits` (a row per audit run), plus four running-total counter columns added to `world_meta` (`goods_created`, `goods_destroyed`, `coin_faucet_total`, `coin_sink_total`).
- `src/engine/inventory/` — `items.ts` (`produceItem`/`transferItem`/`destroyItem`/`getItem`/`getProvenanceChain`/`countActiveItems`), `wallet.ts` (`faucetCoin`/`sinkCoin`/`transferCoin`/`getBalance`/`sumWalletBalances`), `counters.ts` (the shared running totals both of the above update).
- `src/engine/audit/conservationAudit.ts` — `runConservationAudit`: compares the counters (what *should* be true) against live `COUNT`/`SUM` queries (what the tables *actually* contain), records a row in `audits`, and emits a `world`-scoped `audit.failed` log event on mismatch.
- `Engine` runs the audit automatically at every in-game midnight (`tick % MINUTES_PER_DAY === 0`) per §4.2's "nightly (conservation audit)" cadence, and exposes `runConservationAudit()` for manual/test invocation.

**Decisions:**
- **The audit compares counters against live tables, not "this audit's totals vs. the prior audit's totals."** Counters (`goods_created` etc.) are incremented only inside `produceItem`/`destroyItem`/`faucetCoin`/`sinkCoin` — so as long as all state changes go through those functions, counters and live tables always agree. If something ever bypasses them (a bug, a bad migration, a raw query), the two diverge and the audit catches it same-day, which is the actual point of §16's "drift = bug." `conservationAudit.test.ts` proves this by deliberately deleting an item row and mutating a wallet balance via raw SQL and confirming the audit flags both.
- **Transfers (`transferItem`, `transferCoin`) don't touch the counters.** Only creation/destruction and faucet/sink change how much exists in total; moving something that already exists between containers/owners is conservation-neutral by construction, matching §8.1 rule 1 ("every transfer transactional and logged" — logged via `provenance_events`/the event bus, not via the conservation counters).
- **`items.status` has no `'destroyed'` value distinct from `'consumed'`/`'spoiled'`/`'worn_out'`** — §8.1 rule 1 says "spoilage and wear are the only destruction," so those three specific reasons *are* the destruction vocabulary; a generic fourth status would just be an unused escape hatch.
- **One wallet per entity, no business ledgers yet.** Business ledgers (§9.3) are a Stage 5 concept with far more fields (revenue, wages, equipment upkeep); building that structure now, before companies exist, would be speculative. `wallets.owner_id` will grow to accept business IDs once that module lands.

**Exit-test status (Stage 0, §Stage 0): all five criteria now met** — 10,000 deterministic headless ticks, a scripted actor completing a queued chain including a failed attempt, save→load→resave byte-identical, the conservation audit passing (and, better than the exit test strictly requires, verified to actually *catch* drift), and a seeded item's provenance chain queryable end to end. Stage 1 (React interface shell, §Stage 1) is next.

---

## 2026-07-14 — Grid-coordinate world model (Stage 0, §5.1)

**What was built:**
- Migration `0003_sites`: a `sites` table (id, name, free-text `kind`, x, y) — every settlement/farm/resource site/business gets a row once its owning module exists to create one.
- `src/engine/world/grid.ts` — pure math, no DB: `gridDistance` (straight-line distance between coordinates) and `travelDurationTicks` (distance → ticks, modified by transport mode, road quality, cargo load, and season per §5.1/§8.1).
- `src/engine/world/sites.ts` — DB-backed `createSite`/`getSite`/`listSitesByKind`/`distanceBetweenSites`.
- `Engine` gained matching passthrough methods plus `travelDurationBetweenSites`.

**Decisions:**
- **`sites.kind` is free text, no CHECK constraint.** §16 treats locations as data ("goods, recipes, buildings, locations... as data (DB records + JSON packs) from day one"); a fixed enum would fight that the moment construction/settlement modules want a new kind.
- **Road quality, cargo load, and season are parameters `travelDurationTicks` accepts, not state it looks up.** There's no road-segment network or per-route condition tracking yet — that's Stage 7 territory (§Stage 7: "region screen... carts/wagons... freight capacity/speed by mode"). Stage 0's job is just the math primitive being correct and tested; callers supply real road/season data once transport/region modules exist to have it.
- **Speed constants (`BASE_SPEED_UNITS_PER_TICK`, road/cargo/season multipliers) are placeholder tuning**, not balanced numbers — flagged for the balance harness (§17) once actual settlement distances exist to calibrate against.

**Exit-test progress:** grid-coordinate world model ✅ (`src/engine/world/grid.test.ts`, `sites.test.ts`). Still open for Stage 0: conservation audit, item provenance recording.

---

## 2026-07-14 — Timed-action framework (Stage 0, §4.3)

**What was built:**
- Migration `0002_entities_and_actions`: an `entities` table (id + name only for now — household, portrait, skills, traits, etc. arrive with the modules that need them) and an `actions` table (one actor has at most one `in_progress` row; `queued` rows behind it are that actor's committed chain).
- `src/engine/actions/` — `types.ts` (`ActionDefinition`, `ActionOutcome`, `QueuedAction`), `registry.ts` (`ActionRegistry`, a type→definition map), `actionQueue.ts` (`enqueueAction`, `processActorActions`, `interruptCurrentAction`, `listActorActions`).
- `Engine` gained `registerActionType`, `createEntity`, `queueAction`, `getActorActions`, `interruptAction`, and a per-tick `processActiveActions` cadence hook that drives every actor with a pending action forward.

**Decisions:**
- **Action *definitions* are code (a `resolve: (rng) => ActionOutcome` function in a registry), not DB data**, unlike goods/recipes which §16 wants data-driven. Actions need arbitrary behavior (skill checks, later on); recipes/goods are the actual data-driven surface once the production module lands. Revisit if action definitions grow complex enough to want hot-reloading or modding (§16) before then.
- **No idle tick between chained actions.** `processActorActions` loops internally so a completion and the next action's start land in the *same* tick call, instead of "resolve this tick, start next tick." An actor with queued work is occupied every tick, matching §4.3 ("occupying the character exclusively") — an idle gap would be a subtle, hard-to-notice inefficiency baked into every job/shift/gather chain in the game.
- **`interruptCurrentAction` only acts on an `in_progress` action**, not a `queued` one (cancelling something that hasn't started is a different, not-yet-built operation). Progress is stored as elapsed ticks, not a rounded fraction, so exact interruption timing survives a save/reload.
- **`processActiveActions` orders by `actor_id ASC` explicitly** rather than trusting `SELECT DISTINCT`'s incidental row order — needed since RNG draws happen during resolution, and draw order must be reproducible for the same seed.

**Exit-test progress:** "scripted actor completes a queued action chain including a failed attempt" (Stage 0 exit test) ✅ — `src/engine/actions/actionQueue.test.ts` queues chop→fail→chop for one actor and asserts status, timing, and log output. Still open: grid-coordinate world model, conservation audit, provenance recording.

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
