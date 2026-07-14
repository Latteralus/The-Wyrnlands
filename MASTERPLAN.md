# The Wyrnlands — MasterPlan

**Version:** 2.1 · **Date:** July 2026
**Genre:** Offline medieval life-simulation / economic sandbox — interface-driven browser game
**Influences:** The Guild series, Torn (timed actions, interface-driven play, persistent logs), Dwarf Fortress (emergence, chronicle-worthy events)

**Changes in v2.1 (harshness & depth pass):** Locked the harsh pace philosophy — medieval life is hard, and the game applies it. Skill now affects speed, **failure rate, and quality** from v1. Companies are living organisms: they buy equipment for workers, grow through upgrade tiers (max 20 employees), contract with other businesses, and rise or fall on their owner's **Management skill** — NPC and player alike. Added: randomized starting economic conditions, wage haggling, regional resource distribution on a **grid-coordinate world**, item provenance (every item tracked through its life), infinite skill-gated resource nodes, the **trade school**, transport assets (carts, wagons, horses with feed upkeep), and NPC marriage/children as chronicle events. Vision reframed: The Wyrnlands is a **storytelling engine** powered by a closed economy.

---

## 1. Vision Statement

The Wyrnlands is a fully offline, browser-based medieval life simulation. The player begins as a penniless commoner in a living settlement where every citizen works, eats, trades, and sleeps under the same rules the player does. Nothing is faked: every loaf of bread was baked from real flour, milled from real grain, grown on a real field, hauled by a real cart — and every one of those steps can be traced.

**Fundamental identity:** an *economic simulation experienced through one individual's life*. The player participates in the system; they do not exist above it.

**Life is harsh — by design.** Medieval existence was expensive and unforgiving: shoes wear out, winter demands warm clothes and firewood, tools cost a month's wages, and skill takes years. The Wyrnlands applies this honestly. Early game is about the immediate situation: the harvest was good or it wasn't, the mill is hiring or it just closed, and you take the work you can get — even work you're bad at — and haggle for what wage your thin résumé allows.

**A sample opening:** you start as a young man in a small village. The only mill goes out of business — its owner was a poor manager, and the chronicle says so. Suddenly you and three NPC ex-millers are competing for whatever's left: farm labor at low wages, or logging for a new woodcutting outfit that just bought its first saws. You sign on. Over the years you watch that company — *your* company, in the way that matters — hire more hands, buy better equipment, contract a hauler to run timber to the market town. Your co-worker marries. The owner's management keeps the books in the black through a bad winter. You were there for all of it, and the logs prove it.

**The Wyrnlands is a storytelling engine.** The stories aren't written; they're *caused*. The interface's job is to make those causes and consequences legible and worth telling.

**The one-sentence pitch:** *A closed-loop medieval economy you live inside, not on top of.*

---

## 2. Design Pillars

When two features conflict, the pillar higher on this list wins.

1. **Conservation — nothing appears from nothing.** Every item is produced, transported, stored, consumed, or destroyed through simulated processes, and its provenance is tracked through its whole life. Money is conserved: coins enter/leave only through designed faucets and sinks.
2. **NPCs live by the same rules as the player.** Needs, jobs, wages, skills (including Management), homes, ledgers, failure. A baker without flour bakes nothing. A badly managed business fails.
3. **Resilient instability, not equilibrium.** Constant friction balanced by stabilizers. Shortages and failures happen; society adapts before every disruption becomes an apocalypse.
4. **Life is harsh; patience is the progression system.** Skills grow slowly by doing and cost failures along the way. Basic necessities — shoes, clothes, tools — are real expenses produced by the real economy. Proficiency and wealth are measured in in-game years, and they feel earned.
5. **Information is the graphics.** Rich screens, persistent logs, portraits, illustrated panels, atmospheric writing. If a system can't be seen through the interface, it may as well not exist.
6. **Fully offline and portable.** One browser tab, one .sqlite save file.
7. **Modular and testable.** The simulation is a pure TypeScript engine, independent of React, unit-tested and runnable headless.

---

## 3. The Core Causal Loop

**Resources → Businesses → Jobs → Households → Markets → Settlement change → (back to resources)**

A farm produces grain. A mill buys grain and produces flour. A bakery buys flour and fuel, employs bakers, and produces bread. Households earn wages and buy bread. Bread prices affect household survival. Household demand determines whether the bakery is profitable. Profitability determines wages, hiring, equipment purchases, expansion, or closure — which changes the settlement, which changes everything upstream.

Every feature must connect into this loop.

---

## 4. Technical Foundation

### 4.1 Stack

| Layer | Choice | Notes |
|---|---|---|
| Interface | React 18 + TypeScript | Screens, panels, logs, timers; light CSS animation |
| Simulation engine | Pure TypeScript, zero React/DOM dependencies | Runs identically in browser and Node tests |
| World state | SQLite via sql.js (WebAssembly) | The database IS the game state; save = export DB bytes |
| Build | Vite | |
| Tests | Vitest | Headless simulation runs against the same sql.js DB |
| Persistence | .sqlite download/upload; IndexedDB autosave | Player owns their save |
| Assets | Static location illustrations, icon set, NPC portrait pool | No sprites, no Phaser |

### 4.2 Architecture Rules

- **The simulation is a library; React is a client.** Narrow engine API (advance ticks, query state, submit commands). The full game runs 10,000+ ticks headless with no DOM.
- **The database is the single source of truth.** Caches always reconstructible; React state derives from engine queries, never the reverse.
- **Deterministic ticks.** Same DB + same seeded RNG = same result.
- **Module boundaries:** `time`, `needs`, `actions`, `jobs`, `production`, `inventory`, `market`, `households`, `companies`, `construction`, `housing`, `transport`, `population`, `logs`, `ui-api`. Communication via DB + event bus only.
- **Staggered decision cadence:** per tick (needs, action/production progress) → hourly (market clearing, price drift) → daily (ledgers, business decisions, household budgets, schedules) → weekly (hiring/wages, migration, rent) → nightly (conservation audit).

### 4.3 Time Model & Timed Actions

- Base tick = 1 in-game minute; **pause / 1× / 4× / 16×** plus **skip-to-action-complete** and **skip-to-morning**. Offline and single-player: acceleration is always available — the Torn influence is the *structure* of committed timed actions, not real-world clocks.
- **Everything is a timed action** with in-game duration, occupying the character exclusively: work shifts, gathering, resting (quality by shelter tier), eating, errands, travel, training (trade school), and management sessions. Actions queue; interruption gives proportional results.
- **Actions can fail.** Low skill means slower work, wasted materials, and outright failed attempts (a spoiled batch, a ruined hide, a tree felled badly). Failure consumes time and sometimes inputs — this is the teeth of the harsh-pace pillar and the reason self-employment is a trap for the unskilled.
- Calendar: days → weeks → 4 seasons → years. Seasons drive harvests, spoilage, fuel demand, travel durations.

### 4.4 Simulation Level of Detail (LOD)

- **Active (player's settlement):** every NPC at schedule resolution — hourly location presence, individual transactions, full logs.
- **Regional:** full entities at daily resolution — production, consumption, hiring, prices, migration, shipments.
- **Background (distant, Stage 7+):** weekly/monthly aggregates over real stockpiles; rehydrated into individuals when the player arrives.

Conservation holds across all tiers.

---

## 5. World Structure & Navigation

### 5.1 The Grid World

Every settlement, farm, resource site, and business sits at **grid coordinates**. Distance between coordinates — modified by road quality, transport mode, cargo load, and season — determines travel durations, hauling costs, and freight contract pricing. The map is data first; the illustrated region map is a view of it.

### 5.2 Regional Resource Distribution

Resources are deliberately spread unevenly: the forest belt has timber but little stone; the quarry hills have stone but import grain; the river town mills and trades. **Regional imbalance is the engine of trade** — every region produces surpluses of some raw materials and genuinely needs others, so carts on the road are the bloodstream of the world.

**Resource nodes are infinite** — the forest doesn't run out of trees, the quarry doesn't empty — but extraction is gated entirely by labor and skill: worker skill determines extraction speed, failure rate, and output quality. Scarcity comes from labor, logistics, and demand, not depletion (which keeps the long game stable and the economy testable).

### 5.3 Scale Strategy

First Playable: **one town (~40–80 persistent NPCs) + 3–5 farmsteads + forest + quarry + well.** v1.0 region: agricultural village + market town + castle settlement + farms and resource sites, each with a distinct resource profile.

### 5.4 Starting Conditions Are Rolled

World generation seeds the *situation*, not just the map: the recent harvest quality, each business's health (one may be freshly failed — the shuttered mill opening), current season, price levels, and job availability. Two new games in the same village play differently: one starts in a fat autumn with three employers hiring; another in a lean spring where the player scrapes by gathering firewood and haggling for scraps.

### 5.5 Navigation Model

- **Settlement screen:** illustrated header (season/time tinting), vital signs, clickable location grid, settlement log tab.
- **Location panels:** illustration, atmospheric description (conditional on season/scarcity/time), presence roster, available actions.
- **Travel:** timed action from the gate or region screen; optional illustrated clickable map; progress bar plus travel-log entries. No sprite movement.

---

## 6. Survival & Needs

| Need | Decay | Failure consequence |
|---|---|---|
| Hunger | Steady; faster under heavy labor | Energy penalties → starvation damage → collapse |
| Thirst | Faster | Same curve, steeper |
| Sleep/Energy | Drains awake, faster working; restored by rest × shelter quality | Work/skill-gain penalties; forced collapse |
| Shelter/Warmth | Season-dependent; **warm clothing is gear, not a stat** — winter without a wool cloak is dangerous | Sickness: stat penalties, lost workdays |
| (Post-v1) Health, Hygiene, Morale | — | Work quality, social standing |

- **Equipment needs are survival needs.** Shoes wear out with walking and labor; clothing has warmth values and degrades; tools have durability. All are produced, bought, and sold inside the economy. The early game's shopping list — shoes, a winter cloak, eventually your own tools — is the harsh world made concrete.
- The player is **immortal**; collapse costs time, wages, possibly the job. Rock bottom is charity or the poorhouse — survivable, miserable, motivating.
- **Shelter ladder:** rough → tavern common room → rented room → cottage → owned home → built/upgraded home.

---

## 7. Goods

### 7.1 Principles

Few goods, complete chains, meaningful shortages. Every good is data-defined: base value, weight/transport cost, shelf life, **quality tier**, essentiality, production inputs, production time, labor requirement, seasonal availability. Perishability is first-class (grain keeps months; bread spoils in days).

**Item provenance:** every item's life is tracked — produced by whom, from which inputs, hauled by whom, sold where, consumed/worn out when. The audit system requires it anyway; the interface surfaces it (inspect a loaf: "Baked by Edda from Oster-farm flour, milled at the Riverside Mill"). Provenance is flavor, debugging, and the foundation for quality reputation.

### 7.2 Goods Roadmap

| Tier | Goods |
|---|---|
| **v1 essential** | Grain, flour, bread, vegetables, firewood, water; **shoes, clothing (warmth-rated), basic tools (durability-rated)** — imported via merchant faucet at first, produced locally as chains come online |
| **v1 productive assets** | Seeds, timber, stone/clay, building materials, tools |
| **v1.0 transport tier (Stage 7)** | **Carts and wagons** (built by the carpenter/wheelwright from timber and iron fittings), **horses and draft animals** (bred and raised on farms, expensive to buy, requiring daily **fodder/hay** — a new farm output), stabling |
| **Post-v1** | Meat/livestock chains beyond draft animals, ale, wool→cloth→clothing full chain, iron/smithing, luxury food, furniture, medicine, books |

Transport assets are deliberately costly: a horse and wagon is a business's proudest capital purchase, and its feed is a permanent line in the ledger.

---

## 8. Economy

### 8.1 Core Rules

1. **Goods conservation with provenance:** every item in exactly one container; every transfer transactional and logged; spoilage and wear are the only destruction.
2. **Money conservation:** designed faucets (castle provisioning, export purchases, immigrants) and sinks (taxes, imports, emigrants). Constant currency in v1.
3. **Businesses run real ledgers** and fail for real reasons — including bad management (§9).
4. **Prices local, emergent, smoothed:** target price = base × scarcity × demand × local × seasonal; actual drifts ~10% of the gap per interval. Market screens show history charts.
5. **Logistics are physical and priced by the grid:** goods move by carried load, handcart, or horse-drawn wagon; duration and cost derive from coordinates, load, road, season. Freight is a business (§9.7).
6. **Information is imperfect:** agents (and the player) act on last-known data; distant prices age visibly.

### 8.2 Stabilizers

Household reserves, business cash reserves, town granary, family support, church charity/poorhouse, common land (low-yield free gathering), substitutes, merchant imports responding to prices, wage flexing, (Stage 8) treasury intervention.

### 8.3 Friction (never tuned to zero)

Seasonal harvests, spoilage, slow transport, imperfect information, skill shortages, unequal ownership, limited credit, weather, **bad management**, fires; post-v1: disease, crime, war, monopolies.

---

## 9. Businesses & Companies

### 9.1 Structure

Data-defined: **inputs + labor + tools + time + building capacity → outputs**, e.g., 10 grain + 1 miller-hour + mill condition → 8 flour. **Modifiers:** employee skill (speed, failure rate, quality), employee health, tool quality/durability, building condition, **owner Management skill**, morale (post-v1), weather, material quality, scale.

### 9.2 Management Is a Skill

Every business has an owner whose **Management skill** (NPC or player-visible stat) modifies the whole operation: purchasing timing, price responsiveness, wage competitiveness, waste rates, decision quality on the daily/weekly cadence. **Some NPC companies are simply better run than others** — the well-managed woodcutter thrives while the sloppy mill bleeds out, and the chronicle records why. NPC Management skill grows with tenure like any other skill. Player companies are managed by the player directly — the player's decisions *are* the management layer — with the Trading skill affecting their buy/sell margins and haggling.

### 9.3 Ledger

Cash, inventory, revenue, wages, material costs, **equipment purchases and upkeep (including fodder)**, taxes, rent, maintenance, debt (post-v1), profit, expected demand. Player businesses expose the full ledger with history; NPC businesses expose what an observer would plausibly know.

### 9.4 Company Equipment

**Companies buy tools and equipment for their workers when viable.** A new logging outfit starts with cheap axes; profits buy better saws; better saws raise every worker's output. Equipment is real inventory with durability — bought from toolmakers (or the merchant faucet early on), maintained, replaced. A new hire uses company equipment from day one; going independent means buying your own, which is exactly why employment comes first in a harsh world. Equipment quality is a visible part of a job's appeal ("Oster's farm: good tools, poor wages").

### 9.5 Growth & Upgrades

Businesses scale primarily through **employees and equipment**:

- Upgrade tiers expand job slots, storage, and workstations; each tier's cost rises incrementally (building work uses real materials and builder labor).
- **Hard cap: 20 employees per business at maximum upgrade.** Beyond that, growth means founding or acquiring *additional* businesses — which keeps the map plural, keeps failed-business auctions meaningful, and prevents one mega-firm from swallowing a settlement.
- NPC companies follow the same growth rules: a profitable, well-managed business hires, upgrades, buys equipment, and contracts haulers. **A player can join a two-man startup and spend years watching it — from the inside — grow into a twenty-hand operation with its own wagons.** That arc is a designed experience, not an accident: the business log narrates it.

### 9.6 Decision Cadence

NPC businesses decide daily/weekly by rules weighted by Management skill: production levels, prices, input orders, hiring/dismissal, wages, repairs, **equipment purchases, upgrade investment, freight contracting**; (post-v1) borrowing; temporary closure; permanent failure → auction.

### 9.7 Business-to-Business Contracts

Businesses contract with each other: a woodcutter contracts a hauler to move timber to the market town; the bakery contracts standing flour deliveries from the mill. Contracts specify goods/route, schedule, and price; they're fulfilled by real timed shipments and can be broken by insolvency or failure — with logged consequences. Freight hauling is itself a viable business (cart, horse, Hauling skill), for NPCs and for the player.

### 9.8 Staffing & Haggling

Job slots with wage offers; workers commit timed shifts; presence = labor-ticks = production. **Wages can be haggled:** the offer band depends on the applicant's skill and work history, the business's urgency and profitability, and local labor supply — an experienced miller laid off by the failed mill negotiates from strength at the farm gate; a green youth takes what's posted. Labor inertia applies (loyalty, moving costs, risk aversion): nobody quits over one coin. NPC businesses compete under identical rules and **can outperform, expand against, and bankrupt the player.**

---

## 10. Households

**The household is the central economic unit:** adults, children, elderly, earners, shared money/food/housing, relationships.

**Weekly budget priority:** food → housing → fuel → **clothing/shoes** → debt → savings → comfort. Surplus builds reserves; deficit triggers the **adaptation ladder:** cheaper food → smaller meals → savings → sell belongings → more work / another member works → borrow (post-v1) → beg → cheaper housing → migrate → (post-v1: steal, servitude, enlist). Every rung generates log entries — a job loss starts a visible consequence cascade.

**Household life events (Stage 8):** NPCs court, **marry, form new households, and have children** — chronicle-level events with real economic effects (a new household needs housing; a child is a dependent mouth). Full aging and death remain post-v1; marriage and births arrive in v1.0 because watching your co-worker's wedding in the settlement log is exactly the kind of story this engine exists to tell.

---

## 11. NPCs

### 11.1 The Citizen

Identity (name, portrait, household, **permanent job and life history**), needs, **skills on the same list as the player — including Management**, occupation, wealth, health, employer, home, relationships, reputation (Stage 8), hidden traits (ambition, greed, loyalty, industriousness, risk tolerance), goals, current problems. Hourly schedules determine location presence and flex around urgent needs.

### 11.2 NPC Profile Screen

Portrait, occupation and employer, household, visible condition, public job history ("Miller at Riverside Mill, 6 years; unemployed since it closed"), and later reputation/rumor. Histories are permanent: the co-worker from year one is findable, married, in year five.

### 11.3 Decision-Making

**Action score = urgency + expected benefit − cost − risk + personality modifier**, top-scoring with controlled randomness. The unemployed ex-miller weighs: apply at the farm (lower skill match — and the wage haggle will show it), travel toward rumored work, gather firewood on common land, beg.

### 11.4 Migration

Push (unemployment, hunger, rent, fire, debt) vs. pull (jobs, wages, housing, food, family, land) against *known* alternatives under imperfect information. Immigrants carry coin/goods in (faucet); emigrants take theirs out (sink). Migration is v1's population turnover; arrivals and departures are named chronicle events.

### 11.5 Emergence Targets (tests, not scripts)

- The mill's poorly-skilled owner mismanages purchasing → insolvency → closure → auction → three skilled millers flood the labor market → farm wages dip → one miller emigrates, one retrains as a logger, one buys the mill's tools at auction and, years later, reopens it.
- Player joins a new logging company → profits → equipment upgrades → hires → contracts a hauler → the business log tells the whole growth story.
- Drought → grain spikes → households descend the ladder → tavern traffic drops.
- House fire → housing ladder slide → construction demand, timber prices, builder wages rise.

---

## 12. Housing

Each property: capacity, condition, rent, owner, occupants, heating cost, grid location, social class, fire risk. Rent flows to real owners; maintenance is real; condition decays. Destroyed homes trigger the adaptation ladder and an economic shock. Housing screen: vacancies, rents, condition, landlords.

---

## 13. Skills & Progression

### 13.1 The Harsh Pace (design targets)

Progression is deliberately slow and expensive — this is the point, and skip-time controls make patience a choice rather than a wait:

| Milestone | Target (typical, reasonably efficient play) |
|---|---|
| Stable survival (fed, sheltered, shod) | first in-game weeks — and it should feel like an achievement |
| First quality gear (winter clothes, decent shoes) | first season |
| Own basic tools | several months of saving |
| Competent in a trade (reliable, low failure) | ~1 in-game year of steady work |
| Proficient (fast, high quality) | multiple years |
| First modest business, solvent | **~3+ in-game years** — and fragile even then |
| A grown company, property, standing | the long game: many years |

### 13.2 Skill Model

- **Learn-by-doing:** each labor-tick grants XP; requirements grow steeply. NPCs skill identically — tenure makes workers genuinely valuable and poaching real.
- **Skill affects three things from v1:** work **speed**, **failure rate** (wasted time and materials), and **output quality tier** (quality goods command better prices and durability). Low-skill self-employment is therefore a money-loser — employment on company equipment is the rational start, exactly as intended.
- **Unskilled work is allowed** — slow, failure-prone, poor quality.
- **v1 skills:** Farming, Milling, Baking, Woodcutting, Carpentry, Masonry, Hauling, Trading (margins + haggling), **Management** (business operation), Labor (general fitness).
- No skill decay in v1.

### 13.3 The Trade School

Somewhere in the region (the castle town or market town, Stage 7) stands a **trade school**: formal training in skilled trades and crafts. Tuition is steep and courses are long timed commitments (seasons of study, paid up front, while you still must eat and lodge) — but it accelerates skill gain beyond pure labor and is the only v1 path to certain advanced techniques. It is an *investment*, not a shortcut: only a player (or NPC — they use it too) with real savings can afford it, which makes it a mid-game aspiration and a money sink in one.

### 13.4 Social Progression (Stage 8+)

Landless → Tenant → Freeman → Artisan → Merchant (clergy/gentry/nobility as backdrop), rank gating land terms, plot sizes, later guilds and office.

---

## 14. Interface & Player Experience

### 14.1 Presentation Language

Illustrated location panels (season/time-tinted), persistent NPC portraits, a consistent icon set, light CSS animation (progress bars, number tick-ups, sliding log entries, day/night gradients), and **atmospheric writing as a budgeted first-class asset** — every location, action result, and chronicle event has authored conditional text.

### 14.2 Screen Map

- **HUD:** needs, coin, date/season/time, current action + queue, time controls.
- **Settlement screen:** illustration, vitals, location grid, settlement log.
- **Location panels:** description, presence roster, actions.
- **Market screen:** per-seller listings, averages, price history charts, item provenance on inspection.
- **Jobs screen:** openings (wage band, hours, skill ask, employer, **equipment quality**), application and **haggling flow**.
- **Housing screen:** vacancies, rents, condition, landlords.
- **Company screens (player-owned):** tabbed — **Overview/Ledger · Supplies · Stock · Employees · Tools & Equipment · Contracts · Upgrades**. Policies (target stock, price limits, wages, hiring rules), staff roster with skills/tenure, production queue, upgrade tier and next-tier cost.
- **NPC business view:** the observable subset (prices, staffing, visible stock, reputation later).
- **Household screen:** members, budget, reserves, obligations.
- **Character sheet:** skills, inventory (weight-limited), **worn gear (shoes/clothing condition and warmth)**, shelter status.
- **NPC profile:** §11.2.
- **Region screen / optional map:** grid-derived distances, last-known info, travel initiation.
- **Trade school screen:** courses, tuition, duration, prerequisites.
- **Save/Load.**

### 14.3 The Log System (core feature)

Four persistent, filterable views over one event stream: **Personal log**, **Business logs** (the ledger as narrative — including the growth arc of a company the player merely *works for*), **Settlement log** (hirings, evictions, auctions, weddings, arrivals, fires), **World chronicle** (harvest verdicts, famines, foundings and failures, migration waves) in light chronicle voice. The logs are simultaneously the player's story, the economy's visibility layer, and the developer's debugging window.

### 14.4 The First Hour

Roll a world: this village, this season, this situation — maybe the mill just closed and the labor market is crowded. Drink free at the well. Read the notice board. Haggle (weakly) for a logging job. Commit a six-hour shift on company axes; watch wages, Woodcutting XP, and shoe-wear tick. Buy bread. Pay for a bunk. Queue tomorrow. The shopping list writes itself: shoes before winter, then a cloak, someday your own axe. **There is always a visible next rung.**

---

## 15. Development Stages

Each stage ends in a playable, testable build. Stages 0–3 = **First Playable.** No stage begins until the previous exit test passes.

### Stage 0 — Foundation
Scaffold (Vite + React + TS + sql.js + Vitest); schema v1 + migrations; tick engine + time controls + cadence scheduler; **timed-action framework with failure outcomes** (start/progress/fail/complete/interrupt/queue); grid-coordinate world model; event bus + log pipeline; engine↔UI API; headless runner; **conservation audit + provenance recording from day one.**
**Exit:** 10,000 deterministic headless ticks; scripted actor completes a queued action chain including a failed attempt; save→load→resave identical; audit passes; a seeded item's provenance chain is queryable.

### Stage 1 — The Interface Shell
React shell + HUD; settlement screen with clickable locations (stub panels); location panel template; log UI (personal + settlement); time controls incl. skips; placeholder illustrations, icons, portraits wired.
**Exit:** navigate every panel; run a dummy timed action end-to-end with progress UI and log entries.

### Stage 2 — Survival Loop
Player needs; well, tavern (meal/bunk), market stall with finite seeded stock; coin + weight-limited inventory; **gear layer: shoes/clothing with wear and warmth, tool durability**; gathering actions with skill-based failure; rest quality by shelter; collapse/recovery; pre-commit warnings.
**Exit:** headless idle player collapses on schedule; scripted worker survives 30 days including a gear replacement purchase; all consumption traceable.

### Stage 3 — First Job (FIRST PLAYABLE ✅)
The farm as employer: notice board, application with **simple wage haggling**, shift actions using **company-owned tools**, wages from a real ledger, Farming XP with failure/quality effects; grain into real storage; personal log narrates.
**Exit:** the §14.4 loop runs a full season through the interface alone.

### Stage 4 — Living NPCs & Households
~40 NPCs in households with portraits and profiles; hourly presence rosters; NPC skills incl. Management recorded; household budgets + adaptation ladder; NPCs consume real stock; regional LOD; household screen; settlement log of NPC life events.
**Exit:** headless 90-day run — no baseline starvation, consumption traceable, 16× performance; scripted job loss produces the logged adaptation cascade.

### Stage 5 — The Closed Economy & Living Companies
Full v1 chains; NPC business ledgers with **Management-weighted decisions**; **company equipment purchasing, upgrade tiers (20-employee cap), and growth behavior**; **B2B contracts** (standing supply + freight); smoothed pricing; failure + auction; faucets/sinks; seasons; stabilizers; merchant imports; **rolled starting conditions**; market charts; business logs; world chronicle.
**Exit:** headless 2-year run within resilient-instability bounds; stress scenarios naturally produce a business failure, an auction purchase, a company that *grows* (hires + buys equipment), and a migration wave — all reconstructable from the chronicle alone.

### Stage 6 — Player Enterprise
Buy/rent plots; construction (real materials, builder labor, timed oversight); found a company; hire with haggling and labor inertia; **full tabbed company screens (§14.2)**; equipment purchasing; upgrade tiers; contracts as buyer; housing ladder to ownership.
**Exit:** pauper → solvent small business achievable in **~3 in-game years** of efficient play (harsh-pace table §13.1 holds); NPC competitors respond in prices, wages, and equipment.

### Stage 7 — Region, Transport & the Trade School
Region screen + optional illustrated map over grid distances; **transport tier: carts/wagons produced by the wheelwright, horses raised on farms with fodder chain and stabling, freight capacity/speed by mode**; village + castle settlement with distinct resource profiles (regional/background LOD + rehydration); hauling contracts as a playable business; last-known-information model; **trade school** with courses, tuition, and timed study.
**Exit:** goods flow physically between settlements; arbitrage exists and self-corrects; a horse-and-wagon hauling business is viable; a trade-school course measurably accelerates a skill at measurable cost.

### Stage 8 — Society (v1.0)
Reputation and NPC memory; class ladder privileges; taxes → treasury → civic spending; shock events (fires, harvest failure, sickness); **NPC courtship, marriage, household formation, and births as chronicle events with economic effects**; refined haggling with reputation; onboarding; full writing pass; polish; save versioning.
**Exit:** unassisted playthrough pauper → established burgher; Stage 6 saves load; a co-worker's wedding appears in the settlement log of a long test run.

### Post-v1 (designed-for, not built)
Combat, crime & law; aging/death/heirs (dynasty mode); NPC-founded new businesses; religion; guilds/apprenticeships; credit; disease; feast-day calendars; coin debasement; ale/textile/smithing chains; settlement growth; procedural regions; scripting mods; optional graphical map client atop the same engine.

---

## 16. Data Model (prose overview)

Core tables: **entities** (people, portrait ref, permanent history), **households**, **needs**, **skills** (incl. Management), **traits**, **actions** (current/queued, with outcome records), **inventories** + **items** (single-container rule; spoilage; durability; **quality tier; provenance chain**), **gear** (worn shoes/clothing/tools per entity), **buildings** (condition, owner, storage, **grid coordinates**), **properties/tenancy**, **businesses/companies** (ledger, policies, **upgrade tier, equipment roster**) + **job_slots** + **employment** (contracts, wages, tenure, haggled terms), **contracts_b2b** (supply + freight), **transport_assets** (carts, wagons, animals with feed requirements), **recipes**, **production_runs** (with failure outcomes), **market_listings** + **transactions**, **prices** (current/target/history), **schedules**, **settlements** (economic + resource profile, coordinates) + **region_stats**, **knowledge** (last-known info per agent), **life_events** (weddings, births — feeding the chronicle), **event_log** (scope-tagged: personal/business/settlement/world), **world_meta** (tick, date, season, RNG seed, **scenario roll**, schema version).

**Nightly audit:** all goods and coin vs. prior audit ± logged faucets/sinks/spoilage/wear. Drift = bug, caught same day. Provenance chains make any anomaly traceable to the exact transaction.

**Modding:** goods, recipes, buildings, locations, courses, and text as data (DB records + JSON packs) from day one; scripting post-v1.

---

## 17. Testing & Balance

- **Unit tests** per module (needs, price drift, recipe resolution incl. failure/quality rolls, utility scoring, haggling bands, action timing, contract fulfillment, log emission).
- **Headless scenarios:** seeded 30/90/730-day runs asserting: audit passes, no baseline starvation, prices in bounds, well-managed businesses solvent / badly-managed stressed, adaptation ladders fire, at least one company growth arc completes, harsh-pace milestones (§13.1) hold within tolerance.
- **Determinism, save integrity, forward migration** as before.
- **Balance harness:** parameter sweeps (wages, yields, failure curves, tuition, upgrade costs, fodder rates) → CSV. **Target: resilient instability + the harsh-pace table.** If a sweep shows a business is reachable in one year, that's a balance bug.

---

## 18. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Economic deadlock / hoarding | Faucet/sink valves; stabilizers; 20-employee cap keeps firms plural; audit + harness from Stage 0 |
| Death-spiral cascades | Stabilizer ladder; reserves; merchant imports |
| **Harshness becomes frustration** | Harsh ≠ opaque: pre-commit warnings, visible next rung, skip-time controls, charity floor instead of death; the first hour must always offer *some* paying work |
| Boring equilibrium | Protected friction list; rolled starting conditions guarantee varied openings |
| Interface reads as spreadsheet | Pillar 5: budgeted writing, portraits, provenance flavor, chronicle voice |
| Writing workload | Conditional-text templates; writing itemized per stage like code |
| Information overload | Progressive disclosure; first hour playable from settlement screen + three panels |
| Company sim complexity creep | Equipment/upgrades/contracts are all data-driven through the same recipe/ledger machinery — no bespoke systems |
| sql.js memory ceiling | Lean schema; background aggregation; provenance + log pruning/archival policy for old events |
| Scope creep | Pillars + exit tests; post-v1 list |
| Solo/AI-assisted complexity | Engine/UI separation; one module per session |

---

## 19. Working With Claude Code

- One module or one stage-task per session; cite section numbers.
- Every simulation feature ships with its headless test; every screen consumes the engine API only.
- Schema changes via migrations only.
- Writing/content tracked as deliverables like code.
- Maintain `DECISIONS.md`; when reality diverges from plan, update the plan.

---

*The Wyrnlands: nothing appears from nothing — and nothing worth having comes fast.*
