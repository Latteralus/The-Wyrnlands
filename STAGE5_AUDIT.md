# Stage 5 Audit — claims vs. implementation

**Date:** 2026-10-06 · Compared against MASTERPLAN.md §Stage 5, §7–§11, §17 and DECISIONS.md slices 1–5 (plus the undocumented `Sent1` commit, which added §11.4 migration).
**Method:** code reading plus the long-run economic report (`npm run sim:perf -- --econ <prefix>`, `src/engine/reports/economySnapshot.ts`), run on five seeds for 360–730 days with all of this session's fixes in place. Numbers below are measured, not estimated.

## Update — after the balancing pass (2026-10-06, later)

The rebalance proposed at the end of this document was implemented and tuned over thirteen multi-seed iterations; DECISIONS.md's "Economy balancing pass" entry has the full account. Everything below this section is the audit as originally written — kept as the record of what was wrong.

**Where it stands now (five seeds × 730 days; two seeds × 5 years):**

- On 4 of 5 seeds all four businesses are open after two years, and after five years on both seeds run that long.
- Money is closed in steady state: the export faucet roughly equals the import sink. Total coin over year two moves ×0.90–1.04; over five years ×0.98–1.02.
- Bread trades between 9 and 17 around its base of 12 and is never pinned at its cap.
- The population settles where the economy can carry it, after a first-year emigration wave: 43–50 → 26–29 at two years, ~20 at five.
- Steady-state hunger (5-year runs, second half): 4–6% unfed.
- The seed whose farm failed before day 1 still empties out: nothing can reopen a business.

**Requirement status, revised:**

| Requirement | Was | Now | Notes |
|---|---|---|---|
| Full v1 goods chains | Partial | **Partial** | Firewood now has real demand (household fuel in winter, export). No vegetables, timber, stone, local tools/clothing; outputs still don't record their inputs. |
| Management-weighted decisions | Partial | **Substantially complete** | Restock cadence; sales-based planning and glut awareness (≥2); margin and cash awareness (≥3); hiring/dismissal (≥1); growth (≥2); closure grace. Owners now learn (§9.2). Not yet: wage-setting, pricing. |
| Company ledgers | Substantially complete | **Substantially complete** | Adds owner draws (`owner_draw`) and units on trade lines. |
| Equipment purchasing | Substantially complete | **Substantially complete** | Tools wear on every shift, NPC or player. |
| Growth / upgrades | Partial | **Substantially complete** | Cooldown, demand evidence, cash cover; positions re-posted/dismissed within a tier. Still a coin sink, not construction. |
| Input purchasing | Partial | **Substantially complete** | Sales-driven, glut- and margin-aware (by Management). Spot market only. |
| Selling | Partial | **Substantially complete** | All output to market daily; demand discovered through the stock-based price; stale gluts exported. Companies remain price-takers. |
| Pricing | Partial | **Partial** | Per-good reference stock, ×5 denomination, a [0.75×, 2×] band — prices now move meaningfully. Still no demand/seasonal factor or history. |
| Insolvency / closure | Complete | **Complete** | Unchanged. Nothing reopens a closed business. |
| Auctions | Partial | **Partial** | Auctioned tools are bought first by the next buyer (oldest stock first), so an auction purchase now happens naturally when a company needs a tool; not separately instrumented. |
| Migration | Partial / not firing | **Substantially complete** | Hunger and destitution pushes fire (emigration waves of 5–9 households in every seed); immigration needs vacancies and food. Arrivals don't occur in steady state because locals fill vacancies first. |
| Merchant imports | Placeholder | **Complete** | Price-responsive restocking with an asking-price premium. Exports added. |
| Stabilizers | Partial | **Substantially complete** | Imports, exports, a tithe-funded parish, hunger-driven migration, and Management that improves over time. No granary or family support. |
| Faucets / sinks | Partial | **Complete** | Tagged by channel and reported per window. |
| Seasons | Placeholder | **Placeholder** | Winter fuel demand added; no seasonal production or prices. |
| Rolled starting conditions | Substantially complete | **Substantially complete** | The winter-start trap is fixed (a worn cloak). |
| Long-run stability / 2-year exit test | Failing | **Mostly passing** | See the results above. The first year is lean everywhere — the seeded population is roughly twice what four businesses carry — and a failed farm at start is unrecoverable. |

**Open decisions for you:**

1. Right-size the seeded population (~25–30), or keep 40–50 and accept a lean first year with an emigration wave.
2. When to build business founding/reopening (it fixes the failed-farm start).
3. Whether to trim `event_log` duplication (~65 MB per in-game year now).

## Headline (original audit)

**The Stage 5 economy does not survive its first in-game year on any seed tested.** Every run follows the same arc: the 1,000-loaf seeded merchant bread buffer is gone by ~day 45; the bakery, capped at two workers, makes about one-sixth of the bread the town needs; from then on **every NPC is unfed every day**; the mill fails first (~day 45–60), then the farm (its only customer was the mill), the logging camp (nobody has ever bought firewood), and finally the bakery. By day 240–300, zero businesses, zero jobs, and 42–50 people sitting at the subsistence-hunger floor permanently — with money in their purses and nothing to buy. Nobody emigrates, because emigration only looks at money, not hunger.

| Seed | Day all firms closed/insolvent | NPCs unfed from | Merchant bread gone by | Migrations |
|---|---:|---:|---:|---:|
| stage5-scale-stress | ~300 | day 60 | ~day 45 | 0 |
| econ-alpha | ~360 (farm insolvent) | day 45 | day 45 | 0 |
| econ-bravo | ~225 | day 45 | day 45 | 0 |
| econ-charlie | ~225 | day 45 | day 45 | 0 |
| econ-delta | ~270 (farm failed at start) | day 45 | day 45 | 0 |

Conservation audits pass every night of every run: the economy is dying *correctly*. This is a design/balance failure, not an accounting bug — and it is the central Stage 5 problem, ahead of any missing feature.

## Correctness bugs found and fixed this session

| Bug | Effect | Fix |
|---|---|---|
| Market purchases conjured new items; sold units never left market stock | Goods duplication, unbounded active items, provenance never reached the producer | `buyFromMarket` takes real units first (`0018_market_consignments`) |
| A listing's `producer_company_id` was paid for *every* unit sold | Bakery paid for 1,000 merchant-import loaves it never baked — likely the real reason slice 2 saw the level-0 bakery as "profit leader" | Payment per consigned unit; imports sink |
| NPC wages paid into each worker's personal wallet | Wages never reached the household food budget: by day 90, 2,645 coin stranded in 14 workers' wallets vs 184 across all 24 household purses | Wages go to the household; daily sweep recovers stranded coin |
| Employed **player** also paid by the NPC weekly labor pass | Double wages, phantom weekly output, 200 XP/week — masked a broken Stage 3 test | Weekly labor skips non-household members |
| NPC labor ignored tools and skill | Tools never wore (equipment purchasing never triggered), shifts never failed, toolless companies still produced — violates pillar 2 | NPC weeks follow `jobs/shifts.ts` rules: tool required, tool wear, per-shift skill rolls |
| Stage 3 season test passed for the wrong reason | Player collapsed from cold ~90% through nearly every winter shift | Script made warmth-aware; season pinned with explanation (see winter finding below) |

## Requirement-by-requirement status

| Requirement (MASTERPLAN) | Status | Notes |
|---|---|---|
| Full v1 goods chains (§7.2) | **Partial** | grain → flour → bread only. Firewood is produced but has no consumer at all. No vegetables, seeds, timber, stone, local tools/shoes/clothing. Provenance doesn't link outputs to the inputs consumed (§7.1 "from which inputs"). |
| Management-weighted decisions (§9.2, §9.6) | **Partial** | Weights restock interval/batch size, upgrade eligibility and closure grace. Does not weight selling, pricing, wages, hiring or waste. Restocking ignores price, so a "well-managed" mill over-buys into insolvency. |
| Company ledgers (§9.3) | **Substantially complete** (minimal) | revenue / material / wage / tax entries. No owner income: profit can only accumulate in the firm. |
| Equipment purchasing (§9.4) | **Substantially complete** (as of today) | Real only since NPC labor started wearing tools today. Buys from the merchant faucet; no local toolmaker. |
| Growth / upgrade tiers, 20 cap (§9.5) | **Partial** | Fires (the farm reached tier 2 in 3 of 5 runs). Cost is a coin sink, not materials + builder labor. A Management-0 owner can never expand — so the bakery, the chain's bottleneck, is permanently stuck at 2 workers. |
| Input purchasing | **Partial** | Spot market only, Management-weighted cadence, no price sensitivity or affordability planning. |
| Selling behaviour | **Partial** | Fixed daily cap (15) above a fixed reserve (10); companies are price-takers; no Management weighting. |
| Pricing (§8.1 rule 4) | **Partial** | Scarcity factor + 10% daily drift. No demand/local/seasonal factors, no price history. Scarcity caps at 2.5× base, so an empty listing sits at its cap forever — a price signal nothing responds to. |
| Insolvency | **Complete** | First zero-balance tick recorded, cleared on recovery. |
| Closure | **Complete** | Grace period scales with Management; workers terminated; stock spoiled. Permanent: nothing ever reopens a closed business. |
| Auctions | **Partial** | Tools are transferred to market stock at a discount. No auction purchase observed in the runs examined (not instrumented specifically). |
| Migration (§11.4) | **Partial / not firing** | Added in commit `Sent1`, not recorded in DECISIONS.md. Emigration needs balance < 5 *and* no job; immigration needs open vacancies. In all five runs: 0 arrivals, 0 departures — starving households with ≥ 5 coin never leave. Push ignores hunger, which §11.4 lists first. |
| B2B contracts + freight (§9.7) | **Absent** | Spot purchases only; transport module empty. |
| Merchant imports (§7.2, §8.2) | **Placeholder** | A one-time, finite seeded stock. No ongoing imports "responding to prices". |
| Economic stabilizers (§8.2) | **Partial** | Household reserves, sell-belongings, charity stipend, a fixed 35-hunger subsistence floor. Missing: price-responsive imports, granary, family support, real common-land gathering, substitutes, wage flexing. |
| Faucets / sinks (§8.1 rule 2) | **Partial** | Present (starting capital, charity, immigrants / imports, upgrades, bunks, emigrants) but only tracked as totals — no per-category flow report. |
| Seasons | **Placeholder** | Rolled starting season and winter warmth. No seasonal harvest, production, spoilage or price effects. |
| Rolled starting conditions (§5.4) | **Substantially complete** | Season, price level, harvest, failed business. Job availability not rolled. **A winter start is unwinnable for a new player** (see below). |
| Business logs (§14.3) | **Complete** | `queryActorLog` + BusinessScreen. |
| Market charts (§14.2) | **Absent** | No price-history table. |
| World chronicle (§14.3) | **Absent** | Settlement log only. |
| Long-run stability / 2-year exit test | **Failing** | See headline. |

## Why the economy collapses (ranked, with evidence)

1. **Production capacity is roughly an order of magnitude too small for the population.** Recipes yield 4 grain, 5 flour or 5 bread per 6-hour shift (1:1 inputs). Feeding ~45 people one loaf a day (~315/week) would need ~16 farmers, 13 millers and 13 bakers — nearly the entire population. The seeded chain has 4–6 farm, 2 mill and 2 bakery slots: about 50 loaves a week. The 1,000-loaf merchant buffer just postpones the famine by ~6 weeks.
2. **Base prices make the chain lose money at every step.** grain 1 → flour 2 → bread 2, with 1:1 conversion and wages of ~1 coin per unit of output. The bakery's margin at base prices is negative; the mill's is ~0.1 coin. Only scarcity pricing (2.5× cap) creates a margin, and only while stock lasts. The mill (first link, and the most aggressive buyer because its owner is Management 5) fails first; the farm loses its only buyer and follows.
3. **No ongoing merchant imports.** Once the seeded stock is gone, an empty bread listing sits at its 2.5× price cap with no supply response. §8.2 explicitly calls for "merchant imports responding to prices" as a stabilizer.
4. **A dead-end good.** Firewood has no consumer (NPC warmth is free; there is no `buy_firewood`), so the logging camp is a pure wage drain from day one and always closes.
5. **No recovery path.** Closed businesses never reopen and nobody founds new ones, so every failure is permanent. (This is the NPC-founded-company loop you want brought forward.)
6. **Profit has nowhere to go.** No owner draw or dividend exists, so even a profitable firm only accumulates cash; household income is wages alone.
7. **Migration doesn't respond to hunger**, so a starving town never empties or adapts.

## Other findings

- **Winter start is a trap for the player.** Uncloaked, a 6-hour winter shift burns 75 warmth; the only warmth source is a 3-coin bunk (+30); the posted wage is 3 and a cloak costs ~30 against 20 starting coin. Each shift costs more in bunks than it pays. §18 requires that "the first hour must always offer *some* paying work."
- **Management currently hurts.** Restocking isn't price- or throughput-aware, so the Management-5 mill over-buys grain at scarcity prices and fails first in every run.
- **NPC hiring messages are written in the second person.** `applyForJob`'s message ("Oster Farm takes you on as Farmhand…") is logged at settlement scope for NPC hires too, so the settlement log reads as if the player were hired a dozen times. Cosmetic, pre-existing.
- **Subsistence floor masks starvation.** NPC hunger never falls below 35, so "no baseline starvation" is true by construction; the report's `peopleUnfed` / `hungryHouseholdDaysInWindow` columns now show what is really happening.

## Proposed rebalance (implemented 2026-10-06 — see the update at the top)

These change major economic mechanics and parameters, so per your instructions I've stopped here rather than implementing them. They're listed in the order I'd do them; each would be validated with the multi-seed economic report.

1. **Rescale recipe yields** so a small chain can feed the town: e.g. farming ~10 grain/shift; milling and baking ~30–40/shift (input-limited). Purely parameters in `production/recipes.ts`.
2. **Re-price the chain** so each step has a margin at base prices (e.g. grain 1, flour 2, bread 3), then re-check what a wage buys.
3. **Owner draws:** a profitable company pays part of its trailing profit to its owner's household weekly (a new ledger kind). Closes the money loop.
4. **Price-responsive merchant imports (§8.2):** when an essential listing is empty or priced well above base, the merchant restocks a bounded quantity; buyers' coin sinks out. A real stabilizer and a real competitor for local producers.
5. **A firewood consumer:** households burn firewood in winter (§10 "food → housing → fuel"), restoring warmth that's currently free.
6. **Hunger in migration push (§11.4):** sustained hunger, not just money, triggers emigration; vacancies plus food availability drive immigration.
7. **Price- and throughput-aware restocking** weighted by Management, so good management actually helps.
8. **Winter safety net for new players:** e.g. warmth recovery while sheltered, or a cheaper/rentable cloak.

Recovery from closures (re-opening, or NPC-founded businesses) is the structural fix for item 5 of the cause list, but it's a feature, not a rebalance — it belongs after 1–7.
