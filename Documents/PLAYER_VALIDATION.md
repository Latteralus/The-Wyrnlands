# PlayerPlan implementation validation — 2026-10-06

Baseline before edits: `npm run validate` passed typecheck, lint, formatting, all 201 tests, and production build. One existing scale-stress test was skipped.

After implementation: 240 tests passed, one existing skipped test (42 passing test files). Full validation passed; production output includes 127 transformed modules. Existing sql.js Node-only externalization notices remain build notices; browser smoke has no console/page errors.

## Engine coverage

`src/engine/player/playerExperience.test.ts` adds 39 tests covering requested identity, name validation before seeding, Standard and winter starts, exact Custom resources, duplicate-creation refusal, all implemented zero-level skills, world-roll/RNG isolation, controlled identity independent of both name and entity-id convention, foreground household needs, coarse NPC needs, no automatic player job/pooling/feeding/duplicate shift, inventory/gear safety, permanent job history, routine execution and settings, manual precedence, coin reserve/carry capacity, shared transactional founding and actual land/tool/input payment, owner-operation, insufficient-funds atomicity, owned views, strategic-management boundaries, logical save round-trip, registered founded shifts/market queues, deterministic continued simulation/RNG, migration from schema 22, corrupt/non-game files, unsupported future versions, and conservation drift.

## Browser smoke

`scripts/player-smoke.mjs` passed against Vite using installed Chrome and Playwright 1.61.1. It exercises:

- Title with Continue disabled in a clean browser, then Standard named creation and all Character pages.
- Equip/unequip, household membership, routine/lodging/reserve preferences, employment, and time advancement.
- Manual slot creation, confirmed overwrite and deletion, page reload/Continue, raw SQLite export, clearing the local save list, import and resumed character, plus invalid-file rejection.
- The actual IndexedDB service: metadata/binary round-trip, overwrite, list, autosave slot, newest-save selection, delete/missing-slot behavior, and aborted-write rollback preserving prior metadata and bytes.
- Custom coin/skill creation, company founding and owned books without Inspect, a market axe purchase, periodic autosave, paused preference mutation autosave, reload and persistent ownership/preferences.
- No browser console errors or page exceptions. Desktop and 390-pixel mobile layouts were visually inspected.

Run Vite on `127.0.0.1:5186`, install Playwright with Chrome available, then `node scripts/player-smoke.mjs`. Optional `WYRN_SMOKE_URL` and `WYRN_PLAYWRIGHT_MODULE` select another dev-server URL or an existing Playwright installation. The source-module IndexedDB checks intentionally run against Vite, not the bundled production server.

## Long simulation / deterministic checkpoints

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
- `src/persistence/`: IndexedDB save store and game-session lifecycle/SQLite snapshots.
- Character creation, Character, player Home, player Businesses, and Save screens; title/state/navigation integration in App.
- Narrow Engine/UiApi commands; existing household/NPC/business/profile/gear paths updated for controlled identity and simulation mode. Jobs shows actual vacancies. Existing listing-driven tools/market retained.
- DECISIONS, MASTERPLAN, PERFORMANCE_AUDIT, and README updated.

## Current boundaries and next work

Standard remains 100 personal coin, shoes, a winter cloak when appropriate, seven zero-XP skills, no land/business. The single-person household starts with no additional funds/stores. Foreground wages and purchases use the personal purse.

Home supports rough sleeping or pay-per-stay tavern bunks, with no invented cottage ownership. Founding supports all four existing industries, constrained by actual vacant parcels; the single mill race must become vacant before another mill can open. Routine business restocking/sales/rent remain automatic under existing economic rules. Explicit owner draws/capital contributions, staffing/wage changes, purchasing/stock policies, contracts, and full construction/rental housing remain the next management/housing slices.

Autosave is a replaceable IndexedDB slot every 60 seconds when state changes and at safe transitions, including paused player commands. Abrupt browser termination can recover only the last completed save. Compatible schema-22 worlds migrate to 23; earlier pre-market schemas are rejected. Raw `.sqlite` exports are the portable backup; long-history compaction is future performance work.
