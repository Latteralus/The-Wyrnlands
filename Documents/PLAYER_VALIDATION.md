# Player validation — Electron desktop, 2026-10-06

Player behavior now runs through the Electron host: React under `src/renderer/` uses the typed bridge, and `src/sim-host/` owns Engine, clock, RNG and file saves. The former `src/persistence/` IndexedDB service and browser smoke script are removed. See [MigrationPlan.md](./MigrationPlan.md) for desktop completion and [documentation guide](./README.md) for current references.

## Latest desktop validation

The latest `npm run validate` passed typecheck, lint, formatting, both suites and production build: **283 passed / 10 skipped on system Node 22**, **307 passed / one existing skip on Electron's Node 24**. Native-only tests skip where the system runtime lacks the required SQLite APIs; they execute on Electron's bundled Node. These are the completed migration results; the subsequent prose audit did not rerun simulation tests.

Engine coverage includes named identity/creation, household foreground/background separation, needs/routine/manual precedence, jobs/equipment, transactional founding, management boundaries, migrations, malformed/future saves and deterministic continuation. Host/backend tests cover sessions, views/commands, validation, notifications, clock pacing, reconnect, autosave, backups/recovery, portability and lifecycle readiness/output. Import/bundle and security tests enforce renderer separation, isolation, sandboxing and no Node access.

The full `scripts/electron-smoke.mjs` flow passed **six configurations**: built, packaged and NSIS-installed copies on native and sql.js. It covers Standard/Custom creation, Character/equipment, Home/routine, 16×/pause/skips, jobs/profiles/Inspect, market/chronicle, renderer reload, manual saves/overwrite/delete, native-dialog export/import/cancel, bad files, quit/relaunch, forced process termination, founding/owned books and an axe purchase. Dialog choices are stubbed to scratch files; every run uses disposable profiles and checks for renderer console/page errors. Real saves were not used.

```text
npm run build
node scripts/electron-smoke.mjs
node scripts/electron-smoke.mjs --sim-backend sqljs
npm run package:installer
node scripts/electron-smoke.mjs --packaged
node scripts/electron-smoke.mjs --packaged --sim-backend sqljs
node scripts/electron-smoke.mjs --executable "C:\path\The Wyrnlands.exe"
node scripts/electron-smoke.mjs --executable "C:\path\The Wyrnlands.exe" --sim-backend sqljs
```

The `--executable` commands require an installed copy. Isolated NSIS installation and uninstall both exited 0; test files/registration were removed. The real dev launcher loaded Vite and forwarded simulation output without the startup rejection. GUI checks ran outside the execution tool's Windows filesystem sandbox because of AppContainer ACLs; Electron's renderer sandbox stayed enabled.

## Desktop long-run and persistence results

Named-player world, seed `stage5-scale-stress`, scripted player, 1,095 simulated days:

| Measurement | Native live WAL file | sql.js, fresh-module checkpoints at days 365/730 |
|---|---:|---:|
| Final tick | 1,576,800 | 1,576,800 |
| Failed nightly audits | 0 | 0 |
| Goods / coin conserved | 1,269 / 60,414 | 1,269 / 60,414 |
| Fingerprint | `5d3dfc2e9813e2aa` | `5d3dfc2e9813e2aa` |
| Runtime | 118,960 ms | 349,612 ms |
| DB size | 240.9 MB | 240.9 MB |
| RSS at final sample | 157.4 MB | 546.6 MB |

Both fingerprints match the pre-migration baseline. Repeated WASM modules add memory in the checkpointed fallback; native file-backed SQLite is production. Other checks overlapped, so timings are correctness evidence rather than controlled comparisons. A game year is **120 days**; 365-day samples are benchmark intervals. The scripted stress workload has separate coverage from ordinary player autonomy.

To repeat from the repository root, choose a disposable benchmark DB filename: the native harness replaces an existing `--db-file`, so do not use a real save. Direct Node commands avoid PowerShell/npm flag-forwarding differences:

```text
node scripts/electron-node.mjs node_modules/tsx/dist/cli.mjs src/engine/perf/longRun.ts --backend native --db-file benchmark-world.sqlite --named-player --seed stage5-scale-stress --days 1095 --sample 365 --checkpoint 0 --no-profile --commit day
node node_modules/tsx/dist/cli.mjs src/engine/perf/longRun.ts --backend sqljs --named-player --seed stage5-scale-stress --days 1095 --sample 365 --checkpoint 365 --no-profile
```

`--commit day` approximates batching for throughput comparison; the app commits each clock batch/command. Native harness checkpoint rehydration switches to memory, so file-backed timing uses `--checkpoint 0`.

Native saves are `<userData>/saves/<id>/{world.sqlite,metadata.json}`. The live autosave commits each batch/command with RNG state; minute autosaves checkpoint changed state/update metadata. Manual saves, exports and ten-minute native safety copies are snapshots. WAL/NORMAL preserves committed batches on process termination; OS crash/power loss can lose recent commits. sql.js persists on autosave and orderly close. Native dialogs supply import/export paths; renderer paths are never accepted.

Migration 0023 introduced player identity/preferences; **0024_due_actions_index is current**. Schema-22+ playable saves migrate on either backend without reseeding or granting resources. Save format 1 and game version 0.1.0 are separate from migrations. Earlier unsupported worlds, corrupt/non-game files and future schemas/formats are refused.

## Historical player-slice validation (before Electron)

The remainder records the earlier browser implementation. Its test counts, 730-day fingerprints and IndexedDB behavior are historical evidence; current commands and persistence are above. Original request: [Archive/PlayerPlan.md](./Archive/PlayerPlan.md).

Baseline before edits: `npm run validate` passed typecheck, lint, formatting, all 201 tests, and production build. One existing scale-stress test was skipped.

After implementation: 240 tests passed, one existing skipped test (42 passing test files). Full validation passed; production output includes 127 transformed modules. Existing sql.js Node-only externalization notices remain build notices; browser smoke has no console/page errors.

## Engine coverage

`src/engine/player/playerExperience.test.ts` adds 39 tests covering requested identity, name validation before seeding, Standard and winter starts, exact Custom resources, duplicate-creation refusal, all implemented zero-level skills, world-roll/RNG isolation, controlled identity independent of both name and entity-id convention, foreground household needs, coarse NPC needs, no automatic player job/pooling/feeding/duplicate shift, inventory/gear safety, permanent job history, routine execution and settings, manual precedence, coin reserve/carry capacity, shared transactional founding and actual land/tool/input payment, owner-operation, insufficient-funds atomicity, owned views, strategic-management boundaries, logical save round-trip, registered founded shifts/market queues, deterministic continued simulation/RNG, migration from schema 22, corrupt/non-game files, unsupported future versions, and conservation drift.

## Historical browser smoke

The now-removed `scripts/player-smoke.mjs` passed against Vite using installed Chrome and Playwright 1.61.1. It exercised:

- Title with Continue disabled in a clean browser, then Standard named creation and all Character pages.
- Equip/unequip, household membership, routine/lodging/reserve preferences, employment, and time advancement.
- Manual slot creation, confirmed overwrite and deletion, page reload/Continue, raw SQLite export, clearing the local save list, import and resumed character, plus invalid-file rejection.
- The actual IndexedDB service: metadata/binary round-trip, overwrite, list, autosave slot, newest-save selection, delete/missing-slot behavior, and aborted-write rollback preserving prior metadata and bytes.
- Custom coin/skill creation, company founding and owned books without Inspect, a market axe purchase, periodic autosave, paused preference mutation autosave, reload and persistent ownership/preferences.
- No browser console errors or page exceptions. Desktop and 390-pixel mobile layouts were visually inspected.

This browser procedure is retired. Use the Electron smoke commands above; starting Vite alone does not provide the desktop bridge or simulation process.

## Historical 730-day simulation / deterministic checkpoints

Commands (same world seed and named-player household):

```text
npm run sim:perf -- --named-player --seed stage5-scale-stress --days 730 --sample 365 --checkpoint 0 --no-profile
npm run sim:perf -- --named-player --seed stage5-scale-stress --days 730 --sample 365 --checkpoint 365 --no-profile
```

| Measurement | Continuous | Checkpoint at day 365 |
|---|---:|---:|
| Final tick | 1,051,200 | 1,051,200 |
| Failed nightly audits | 0 | 0 |
| Active goods, expected = actual | 1,267 | 1,267 |
| Coin, expected = actual | 58,209 | 58,209 |
| Logical fingerprint | `a04078a6373f24b4` | `a04078a6373f24b4` |
| Runtime | 217,318 ms | 224,094 ms |
| Final SQLite size | 162.3 MB | 162.3 MB |

Runs overlapped other validation processes, so timing is a scale/correctness observation. Interval cost stayed approximately flat at 295–310 ms/day. This stress workload uses the existing scripted-player decision loop; the ordinary autonomous player's survival is separately covered by engine/browser tests.

The harness also gained a final partial sample: `--days 730 --sample 180` previously stopped at 720 days. Validation above uses the corrected harness and confirms the exact final tick.

## Main additions

- Migration `0023_player_experience`: controlled identity, explicit simulation mode/index, routine preferences, save/game format metadata.
- `src/engine/actions/gameActions.ts` and `src/engine/seed/constants.ts`: registration and runtime policy separated from world seeding.
- `src/engine/player/`: typed creation/validation, player profile/home queries, routine preferences, validated loading, regression tests.
- Former `src/persistence/`: browser IndexedDB save store/session lifecycle; deleted and replaced by `src/sim-host/` storage/save library/session ownership in the desktop migration.
- Character creation, Character, player Home, player Businesses, and Save screens; title/navigation now live under `src/renderer/`.
- Narrow Engine/UiApi commands; existing household/NPC/business/profile/gear paths updated for controlled identity and simulation mode. Jobs shows actual vacancies. Existing listing-driven tools/market retained.
- DECISIONS, MASTERPLAN, PERFORMANCE_AUDIT, and README updated.

## Retained player boundaries and next gameplay work

Standard remains 100 personal coin, shoes, a winter cloak when appropriate, seven zero-XP skills, no land/business. The single-person household starts with no additional funds/stores. Foreground wages and purchases use the personal purse.

Home supports rough sleeping or pay-per-stay tavern bunks, with no invented cottage ownership. Founding supports all four existing industries, constrained by actual vacant parcels; the single mill race must become vacant before another mill can open. Routine business restocking/sales/rent remain automatic under existing economic rules. Explicit owner draws/capital contributions, staffing/wage changes, purchasing/stock policies, contracts, and full construction/rental housing remain the next management/housing slices.

The earlier browser slice used replaceable IndexedDB autosaves and migrated schema 22 to 23. That persistence is superseded by the desktop file saves, schema 24 and crash semantics described above. Raw `.sqlite` exports remain portable; history compaction and [scheduled NPC operations](./Archive/ScheduledActivityPlan.md) remain follow-up work.
