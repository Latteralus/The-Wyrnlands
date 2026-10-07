# Active settlement activities — 2026-10-06

NPCs now live through persistent actions with start/end ticks. A person leaves home, reaches work, completes a shift, earns wages, returns, shops, carries provisions home, eats, visits the tavern and sleeps. Businesses reserve production inputs, complete runs, dispatch output and receive supplies during the day. Location panels and person/business profiles expose those same actions; travel no longer displays a person at either endpoint before arrival.

## Architecture and economic boundaries

`population/activities.ts` registers definitions in the existing action registry and uses the existing indexed due-action query. There is no second scheduler. An actor has one running action. Decisions happen after completion/interruption, at a planned decision boundary, or after a relevant event shortens a waiting action. Stock changes, hiring, dismissal and cash changes wake affected actors; wakeups coalesce in the existing row. A three-hour retry bounds unsuccessful procurement attempts. Stable identity-based offsets spread morning starts and evening meals without consuming RNG draws.

The hourly reconciliation only discovers missing members/businesses and initializes their activity state. It does not reconsider every actor's plan. The per-minute loop still advances the clock and selects due actions, but never runs background needs decay or background AI for everybody. Foreground player needs and the existing ten-minute player routine remain separate policies using the same queue.

Migration 0025 stores action payload/transience, actual current sites, fractional price carry, daily activity guards, procurement attempts and pending employment offers. Existing saves migrate forward. Open job-specific shift definitions are registered again on bootstrap, so loading does not lose their effects. Current actions and their end ticks survive exports/native saves. Transient NPC actions are removed after completion/cancellation; routine waiting/travel/meal/rest action events do not enter history. Completed work, actual trade, wages, hardship, hiring, founding, closure and migration remain meaningful economic history. Existing foreground action history remains intact.

All goods/coin changes use the existing inventory, provenance, market, ledger and wallet APIs. Shift starts reserve inputs in `work-input:<action>`; completions consume only those inputs, and interruptions return unused materials. Freight is unavailable to buyers while in `freight:<company>`. Groceries live in `errand:<person>` until home unloading completes. Liquidation and household departure return/cancel commitments before disposal. Consignor ownership follows the business despite freight containers. Reserved materials count toward purchasing buffers, and freight counts as unsold output.

Recipes, six workdays/week, shift duration, wage bands/affordability, XP, tool wear, quality ordering, demand/margin/cash management thresholds, inventory quantities, shelf lives, merchant caps, charity purse, tithes and strategic eligibility/cooldowns are retained. Background needs retain the previous daily magnitudes, applied at meal/rest completion. This does not introduce foreground per-minute survival decay for hundreds of NPCs. Interruptions return materials without completing wages/XP/output, matching the existing full-shift action rule. A worker missing even one input batch now waits for supplies instead of recording the aggregate pass's paid zero-output shift. Necessary errands can delay or prevent a shift. This changes how many shifts actually earn wages/XP, while retaining the completed-shift payment formula; the economic comparison measures the combined effect.

## Cadence audit

These choices follow how quickly the underlying information changes. Operational shortages and completed work warrant reactions within hours. Capital commitments and sustained-profit decisions need longer evidence; repeated hourly reviews would mostly repeat the same result.

| System | Previous active-engine timing | Chosen timing and reason |
| --- | --- | --- |
| NPC work and production | Whole roster at midnight | One exclusive job-specific shift, normally 360 minutes, after an actual commute; output at completion. Makes production and downstream shortages observable. Six workdays then one rest day; the calendar aligns day zero with the legacy first workday. |
| Wages, production XP and tool wear | Midnight labor pass | Exactly once at completed shift, with existing affordable-wage and success rules. Income cannot fund a purchase before it is earned. Materials are reserved at start, so two workers cannot spend the same input. |
| Worker blocked by input/tool shortage | Next daily labor pass | Wait up to three hours, with relevant deliveries/equipment waking waiters. Stop starting late shifts after 15:00; no all-night retry churn. |
| Company input buying | Daily, habitual 1–5-day management buffer | Timed supply trip when below a workday's input or missing equipment; three-hour retry. Habitual buffer checks remain once on the appropriate management day. Apply live stock/prices, local-supplier preference and the original demand/margin/cash rules on arrival. |
| Replacement equipment | Daily | Same timed procurement response as input shortages. Broken tools can stop the next shift and provoke a purchase that day. |
| Company output/consignment | Midnight | Dispatch after output appears, with cart travel/loading time; market quantity and sales change on arrival. One logistics activity per company prevents simultaneous trips. |
| Local business sales | Daily purchasing pass | Existing direct-trade rules run when a supply trip completes; only uncommitted supplier stock can be sold. Production, freight and buying now compete in causal time. |
| Household bread/fuel provisioning | Midnight stock-up before instant meal | One designated shopper, preferring an unemployed member; real market travel, 20-minute shopping, return and 10-minute unloading. Below three days' bread triggers a trip; winter fuel shortages do too. Three-hour failed-shopping cooldown. Urgent food shopping can continue until 22:00 when dinner is still outstanding. |
| Water provisioning | Midnight top-up | Timed well visit and carriage home when below two days' water; retain eight-day target and daily pail consumption. No duplicate household shoppers. |
| Eating, drinking and hearth warmth | Midnight | Staggered evening home meal, 20 minutes; actual bread consumed per person. Water/hearth serviced once per household/day by the first meal. Hunger accounting records who actually ate. |
| Rest | Midnight energy addition | Home sleeping activity, usually 22:00 to staggered 06:00–07:30; energy restoration once at morning completion. No minute-by-minute energy writes for background actors. |
| Visiting | Cosmetic evening tavern roster | Actual commute and one-hour evening visit for a stable subset of NPCs; home on departure. No economic reward added. |
| Household purse pooling | Daily | Before real shopping and retained nightly accounting. A family can use a member's existing funds when needed. |
| Hardship/selling possessions/alms | Daily before provisioning | Before actual shopping, using existing adaptation ladder and real parish purse. One actual monetary intervention/day; an earlier harmless budget check does not block later urgent relief. Destitution/hungry-day accounting remains nightly. |
| Employment applications | Weekly instant assignment | Labor-office review daily at 08:00 or within an hour of a vacancy/founding/dismissal signal. Persist an offer, then travel and 30-minute application; revalidate vacancy/company at completion. Existing wage priority, household hardship priority and haggling remain. No speculative per-person hourly vacancy scan. |
| Staffing/capacity and dismissals | Weekly, 28-day results | Retain weekly financial review and 28-day evidence. One bad morning is not a reason to hire/fire; posted openings elicit daily/event-triggered applications. |
| Cash distress/insolvency recovery | Midnight cash sample | Update continuous-insolvency start/reset immediately on monetary events. Distress history capped once/day. Daily review enforces the unchanged 10 + 4 × management-level day grace. Earn-and-spend cycles must not count as continuous insolvency. |
| Owner rescue injections | Daily, 28-day cooldown | Review before operational purchases as well as daily; keep existing cushion/target and cooldown. A purchase can reveal an urgent funding need without enabling repeated cash injections. |
| Upgrades | Daily, 30-day profit/90-day cooldown | Retain daily lightweight eligibility review and long evidence/cooldown. A new day's cash can enable investment; there is little value in checking every sale. |
| Voluntary wind-down | Weekly, long loss windows/minimum age | Retain weekly review of sustained results. Permanent abandonment needs evidence, rather than reacting to one delayed delivery. |
| Owner draws and rent | Weekly | Retain contractual/payment cadence and existing reserve/profit windows; daily wages and cash availability are inputs to this weekly decision. |
| Management experience | Weekly | Retain owner/manager weekly XP and the experienced worker's tenure-gated weekly XP. Operational trips do not mint extra management XP. |
| Founding/entrepreneurship | Fortnightly | Retain 14-day review, market evidence, savings/risk/experience/land eligibility and recovery/business-age cooldowns. Starting a company is a deliberated commitment. New firms immediately enter operational activities and signal hiring. |
| Migration | Weekly | Retain 60-day destitution/45-day hunger thresholds and weekly immigrant chance/vacancy pull. Leaving is the final adaptation rung after repeated actual job/food opportunities, rather than an hourly response to a missed meal. Cancel freight/errands before the existing liquidation. |
| Parish tithes | Weekly | Retain redistribution cadence and real purse conservation. Receiving weekly money affects the next genuine relief request, not an unlimited daily faucet. |
| Merchant | Midnight | One scheduled road visit arriving at 11:00 each day. Original import limits, scarcity rules and seven-day unsold export test remain. A shortage cannot summon unlimited additional visits. |
| Pricing | Daily | Six-hour reviews, fractional carry allocating the original daily drift/minimum-step budget across four reviews. Allows intraday supply response without four forced one-coin jumps/day. Record price/market history only daily. |
| Spoilage | Daily | Retain shelf-life day rules and one daily pass. Per-minute rescans do not add meaningful behavior at current shelf-life resolution. |
| Milestones/profit reports | Weekly | Retain four-week profitability evidence and weekly milestone reporting. Hiring itself is immediately visible; milestone summary can wait. |
| Conservation audit | Nightly | Retain full audit boundary, plus targeted test/benchmark audits after interrupted and restored activities. |
| Activity membership discovery | None | Hourly insertion of missing actors only; plans otherwise resume from current actions/events. Covers immigrating/newly created entities without roster AI every minute. |

## Validation and measurement

Baseline source is commit `a3acf79`, archived before edits. All comparison worlds use the same seed/starting rules and real inventories. Baseline and new economic fingerprints are expected to differ; speed/batch/save comparisons **within** each engine must agree. Never compare byte-for-byte SQLite exports with different physical write histories.

The added tests cover actual presence/commuting, no early wage/output, one XP/wear award, exclusive input reservations and dismissal, delayed pantry deliveries, saving during work/freight, freight return before closure, bounded transient state and intraday insolvency recovery. Existing scenario tests retain genuine economic assertions; fixed historical rosters were changed to vacancy/capacity assertions because daily applications intentionally compete for jobs sooner. Heavy long-run test timeouts account for the extra activity work.

Measurements below are local Windows/Electron Node 24 native SQLite runs, not universal performance guarantees. `logs/` holds raw reports and fixtures, is ignored by Git, and is excluded from lint/format because it also contains the archived baseline source. The tracked record here preserves the conclusions. Large fixtures repeat 44 NPCs and four businesses per group at the same travel distances. They are load tests, not balanced large towns: catalog reference stocks are intentionally unchanged. Both initial populations and businesses are stated, since they evolve over time.

### Clock-sized workload matrix

Fourteen simulated days per run, native in-memory SQLite, initial named-player settlement. Each cell is **p99 / maximum batch milliseconds**; the real clock allows 200 ms per batch. All nine final audits passed. Each population produced an identical final fingerprint at every speed: `6356521ae336e66e`, `90787e50d57d4bb7`, `bdc14d54fc40425f` respectively.

| Initial people / businesses | Baseline 1× | Activities 1× | Baseline 4× | Activities 4× | Baseline 16× | Activities 16× |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 45 / 4 | 1.0 / 36.2 | 3.2 / 16.3 | 19.0 / 29.3 | 11.8 / 19.6 | 32.4 / 42.8 | 34.8 / 48.1 |
| 177 / 16 | 0.5 / 197.8 | 8.7 / 26.8 | 41.5 / 114.9 | 28.0 / 81.2 | 84.7 / 105.4 | 96.9 / 102.9 |
| 529 / 48 | 0.6 / 250.0 | 25.9 / 65.3 | 113.5 / 251.9 | 83.2 / 203.5 | 203.4 / 253.4 | 236.7 / 380.4 |

The old engine concentrated cost into rare midnight passes, so its 1× p99 hides large outliers. Activities distribute visible work across the day and lower normal-speed maxima, but require more total CPU. At 529 people the 16× p99 exceeds the clock budget; 4× has a rare 203 ms outlier. These are real limits, not a claim of perfectly smooth unlimited scaling. Mean headless throughput still exceeds the 16× clock requirement, so this is burst latency rather than average capacity exhaustion.

| Initial people / businesses | Baseline ms/day range | Activities ms/day range | Activities CPU ms/day range | Baseline → activities DB MiB after 14 days | Baseline → activities peak RSS MiB range |
| --- | ---: | ---: | ---: | ---: | ---: |
| 45 / 4 | 56–66 | 120–132 | 129–141 | 2.9 → 4.1 | 89–91 → 86–97 |
| 177 / 16 | 101–141 | 310–355 | 314–357 | 11.2 → 16.6 | 110–114 → 114–117 |
| 529 / 48 | 259–263 | 971–1102 | 971–1100 | 31.2 → 46.9 | 136–162 → 152–174 |

Heap at the last samples ranges 13–34 MiB. Final total action rows are 150/292/674, including retained player history; transient completed activity rows do not accumulate. Combined settlement/location view construction and serialization takes approximately 0.09–0.22 / 0.31–0.32 / 0.95–0.97 ms, with payloads 12.5 / 46.6 / 137.4 KiB. This is an in-process serialization measurement; actual IPC is measured separately in the desktop app.

Raw matrix reports: `logs/activity-scale-baseline.json`, `logs/activity-scale-final.json`. Timed matrix runs were performed separately from the final long-run and test suites. Cold/JIT effects and Windows background load explain some speed-to-speed throughput variation; the fingerprints demonstrate that batch size did not change the simulated result.

### Long-run economy and storage

Same `perf-baseline` seed, real seeded world, no scripted player, native in-memory backend, SQL/phase profiling enabled, 730 days, samples at 120-day intervals and the final day. This is about six game years (the game year is 120 days). The legacy foreground fixture remains in both worlds, so its existing collapse/action history contributes to row counts. These results characterize one seed; they are not a multi-seed balance certification.

| Measure | Baseline | Activities |
| --- | ---: | ---: |
| Runtime / mean ms per day | 30.95 s / 42 | 88.52 s / 121 |
| Final population / employed | 44 / 21 | 56 / 14 |
| Arrived / departed households | 0 / 0 | 22 / 9 |
| Final open companies / founded / closed | 7 / 3 / 0 | 7 / 3 / 0 |
| Total coin | 61,732 | 36,242 |
| Household wealth / parish fund | 19,935 / 17,030 | 14,450 / 93 |
| Total wages / owner draws | 242,056 / 156,447 | 172,815 / 164,404 |
| Bread produced / imported / spoiled | 33,247 / 625 / 1,021 | 32,169 / 737 / 3,133 |
| Sampled mean / worst unfed share | 0% / 0% | 28.3% / 73.2% |
| Second-half sampled mean unfed share | 0% | 41.9% |
| Sampled bread price range | 9–12 | 9–18 |
| Final DB MiB / process RSS MiB | 138.2 / 310.8 | 200.6 / 346.5 |
| Event / provenance rows | 44,058 / 456,672 | 49,642 / 690,755 |
| Item / ledger / action rows | 163,795 / 36,721 / 1,997 | 171,941 / 27,616 / 2,062 |
| Failed nightly audits | 0 | 0 |

Final activity audit exactly matches 1,544 active goods and 36,242 coin to conservation counters. Every business remains autonomous, entrepreneurship still creates three firms, and the scenario suites cover failure/auction and owner-management differences. Survival and monetary-stability checks pass; the existing economic harness's **feeding, worst-famine and settled-feeding targets fail** in the activity run. This is a material balance consequence that needs review before treating the new economy as tuned.

The old nightly sequence guaranteed all production/purchasing/importing before every household's meal. Timed production, committed inputs, procurement and carriage remove that guarantee. Hiring happens earlier and in a different causal order, some workers spend daytime on necessary errands, prices see intermediate shortages, and purchases compete for a real parish fund. Wages fall 28.6%, bread output falls only 3.2%, spoilage triples and a larger population shares the remaining income. Thus this is not simply insufficient total bread: inequality, demand timing, funds and stock location matter. The final sample is fully fed while earlier late-run samples show severe hardship. Sparse snapshots cannot prove every intervening day's hunger rate.

Incremental diagnosis found two implementation problems and fixed them: reserved shift inputs were initially omitted from restocking totals, causing overbuying; midnight cash sampling initially treated businesses that sold and spent daily as continuously insolvent. Direct grocery delivery to an errand container also avoids an unnecessary intermediate provenance transfer. Diagnostic household snapshots in the remaining hardship showed empty pantries, little coin, completed meal attempts and unemployment, rather than missing/stuck activity actions. Urgent evening shopping and one-per-day actual relief preserve opportunities to react without inventing free goods or replenishing charity. The retained economic constants were not retuned to erase the residual hardship.

DB growth is higher because real input commitments, freight, carried goods and per-worker completed shifts have provenance/results. There are no minute activity snapshots. At day 120/360/730 the activity DB is 33.0/96.4/200.6 MiB: growth follows real goods/history, rather than accumulating finished waiting actions. Current action state remains proportional to actors. A separate retention/aggregation design would be needed for much longer histories; this refactor preserves existing provenance instead of silently discarding it.

Raw long-run reports: `logs/activity-native-baseline-730.json`, `logs/activity-native-final-730.json` and their `-economy.json`/`.csv` companions. Final activity fingerprint: `14e472d1499225a8`; baseline: `b4b697c88593e30b`.

### Desktop and automated checks

The built app was tested with fresh profiles and saved fixtures at 07:00, so 1× samples include actual water-fetching, commuting and supply trips. Each speed ran for approximately 5–7 seconds with repeated tab interactions; these are short startup/daytime samples, not aged-world frame benchmarks. A corrected benchmark loop prevents old animation callbacks from contaminating later speed samples. The archived baseline build was also measured at 07:00 for the largest fixture.

| Initial people / businesses | Achieved game minutes/s at 1× / 4× / 16× (targets 25 / 100 / 400) | p99 frame ms at 1× / 4× / 16× | Simulation working set MiB range | Simulation reported CPU % range |
| --- | ---: | ---: | ---: | ---: |
| 45 / 4 | 24.6 / 99.2 / 395.4 | 5.9 / 6.0 / 5.9 | 111–112 | 0.1–0.2 |
| 177 / 16 | 25.1 / 100.3 / 388.6 | 6.0 / 6.0 / 6.0 | 76–79 | 0.3–0.5 |
| 529 / 48 | 24.5 / 100.0 / 387.9 | 6.3 / 6.1 / 6.1 | 84–92 | 0.8–1.3 |
| Baseline 529 / 48 | 24.8 / 99.8 / 373.8 | 10.7 / 6.1 / 10.8 | 67–82 | 0.0–1.0 |

There were no renderer long tasks or frames over 50 ms in these final daytime samples. Tab-switch medians range 43–97 ms, maxima 54–118 ms. Actual settlement-view IPC p95 is 1.1 / 1.1 / 3.3 ms at 45/177/529 people, payload 5.5 / 21.3 / 63.6 KiB; baseline 529 is 4.8 ms / 63.6 KiB. The larger in-process matrix payload above includes additional location views. The largest fixture's full-day skips take 1.24–1.37 seconds while renderer frame maxima during skips stay around 6 ms. Electron CPU percentages are its process metric, not a claim that the full simulation consumes that fraction of a single core; headless CPU milliseconds above provide the throughput measurement. The 45-person run overlapped the end of the separate smoke test, so its process memory is noisy and should not be compared as a monotonic population curve.

Raw reports: `logs/activity-desktop-final-{1,4,12}.json`, `logs/activity-desktop-baseline-daytime-12.json`. Earlier midnight-start desktop baseline/activity reports remain in `logs/` but the table uses daytime measurements.

A separate 30-day native run without checkpoints and sql.js run with fresh-module reloads on days 10/20 produce the same fingerprint, `8430bd11102f7dcf`, and identical conservation totals: 1,538 active goods / 34,110 coin. Reports: `logs/activity-parity-native.json`, `logs/activity-parity-sqljs.json`.

Checks completed: typecheck, lint, format, production build; sql.js suite **292 passed, 10 skipped**, Electron Node/native suite **316 passed, 1 skipped**. The native suite includes backend parity tests. Desktop smoke covers new/custom game, job acceptance, profiles, equipment, clock, save/import/export/load, founding, relaunch and killed-process recovery. It passes on native SQLite. Its job acceptance now occurs before advancing a day, because NPC applicants legitimately fill initial vacancies that were previously held open until the weekly pass.

## Reproduction

Run the standard checks with `npm run validate`; run the built desktop smoke with `npm run test:electron`. Test profiles never touch real saves.

```powershell
# Native workload matrix: 45/177/529 people, 4/16/48 businesses, all three speeds.
node scripts/electron-node.mjs node_modules/tsx/dist/cli.mjs src/engine/perf/activityScale.ts --days 14 --scales 1,4,12 --out logs/activity-scale.json --save-prefix logs/activity-world

# Long-run economy, CPU phases/SQL costs, memory, row counts and audit.
node scripts/electron-node.mjs node_modules/tsx/dist/cli.mjs src/engine/perf/longRun.ts --backend native --days 730 --sample 120 --checkpoint 0 --no-player --out logs/activity-long.json --econ logs/activity-economy

# Actual desktop frames, process CPU/memory and end-to-end MessagePort IPC.
node scripts/bench-electron.mjs --seconds 5 --world-file logs/activity-world-12.sqlite
```

For backend/save parity, run the same seed/length with `--backend sqljs --checkpoint 10` and native with `--checkpoint 0` and compare fingerprints. Desktop profiling and headless measurements should run separately to avoid CPU contention. The matrix uses actual clock-sized batches (5 × speed ticks per 200 ms), rather than representing speed as a larger daily lump.

## Remaining abstractions

Company supply/delivery actions represent the existing abstract logistics service, not a named worker secretly shopping during another shift. Purchases settle at completion of a round trip using live prices; output freight has explicit stock while travelling. Detailed freight contracts, paid named drivers, multiple settlements and route networks still need their own economic design. Merchant imports preserve the existing external-world abstraction.

Production still resolves a full scheduled run on completion, rather than manufacturing one unit every minute. Tavern visits are actual activities but currently have no paid drink transaction or social-need reward. Most idle domestic life is a long waiting action at home. Player work sets its real workplace, but this change does not retrofit every existing player action with travel prerequisites. These boundaries keep this refactor focused on the active background settlement while preserving existing player commands and economic rules.
