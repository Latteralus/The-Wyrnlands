Work in the current `Latteralus/The-Wyrnlands` repository.

I want to turn the current player implementation from a seeded placeholder into a first-class playable character with:

- a Game Start / title screen;
- New Game flow;
- Character Creation;
- configurable starting conditions;
- a real player character identity;
- character/stat/skill/inventory/equipment pages;
- player household/home visibility;
- player-controlled major life decisions;
- preservation of the existing autonomous daily routine;
- groundwork for player-owned businesses;
- proper Save / Load / Continue;
- IndexedDB autosave;
- portable `.sqlite` export/import.

This is primarily a **player experience architecture + persistence task**.

Do not treat this as merely adding some React screens.

Before making changes, inspect the current implementation thoroughly and run the full validation suite.

Read at minimum:

- `MASTERPLAN.md`
- `DECISIONS.md`
- `PERFORMANCE_AUDIT.md`
- `src/App.tsx`
- `src/engine/engine.ts`
- `src/engine/entities.ts`
- `src/engine/ui-api/`
- `src/engine/seed/demoWorld.ts`
- `src/engine/checkpoint.ts`
- `src/engine/checkpoint.test.ts`
- `src/engine/reports/profiles.ts`
- `src/engine/population/households.ts`
- `src/engine/population/traits.ts`
- `src/engine/skills/`
- `src/engine/gear/`
- `src/engine/inventory/`
- `src/engine/world/tenure.ts`
- `src/engine/companies/founding.ts`
- `src/engine/companies/businessTypes.ts`
- current screens/components/HUD/navigation
- current DB migrations/schema

Establish the current test count and baseline before edits.

# Core problem

The simulation has become substantially more sophisticated than the player's experience.

Currently the player is effectively created as:

```text
entity id: player
name: "You"
starting coin
basic needs
Labor skill
starting shoes
possibly a winter cloak
```

There is no proper:

- title screen;
- character creation;
- character sheet;
- inventory screen;
- skills screen;
- equipment management screen;
- home/household screen for the player;
- persistent save selector;
- Continue button;
- manual saves;
- autosave;
- imported/exported save workflow.

The player can participate in the economy, but does not yet feel like a persistent person living inside it.

The goal is to make the player character the center of the experience without weakening the existing autonomous-world simulation.

# Critical architectural issue 1: player identity must not depend on the name "You"

Inspect `entities.ts`.

Currently second-person behavior is partly inferred from:

```ts
getEntityName(id) === "You"
```

This must be removed as an identity mechanism.

A player should be able to be named:

```text
Chris Barnett
Edda Hale
Thomas Cotter
```

while narration can still say:

```text
You collapse from exhaustion.
You finish your shift.
```

Separate:

```text
character display name
```

from:

```text
controlled/player identity
```

Introduce an explicit player/controlled-actor identity.

Prefer a persistent source of truth such as:

```text
world_meta.player_entity_id
```

or another clean DB-backed equivalent.

Add helpers such as:

```ts
getPlayerEntityId()
isPlayerControlled(entityId)
```

Do not infer player identity from:

- name;
- household membership;
- entity id literals scattered through UI code.

The constant `"player"` may remain as an internal default if useful, but the architecture should not require it everywhere.

Update second-person narration logic accordingly.

Add regression tests proving a named character still receives second-person narration.

# Critical architectural issue 2: household membership currently doubles as NPC/LOD identity

This must be addressed before putting the player into a household.

Current code uses household membership as a proxy for:

```text
background NPC
```

versus:

```text
foreground/player actor
```

This is too coupled.

The player needs to be able to belong to:

```text
The Barnett Household
```

without suddenly switching to coarse NPC simulation.

Separate these concepts.

Conceptually:

```text
Entity/person
  ├ household membership
  └ simulation/control mode
       ├ foreground / player-controlled
       └ background NPC
```

Use the smallest clean architecture consistent with the existing engine.

Do not broadly rewrite NPC simulation.

Acceptance requirement:

> The player can belong to a household while continuing to use foreground per-tick needs/actions/autonomous routine behavior.

NPCs must continue using the performant coarse cadence.

Add explicit tests for this.

# Critical architectural issue 3: world creation and player creation are currently mixed

`seedDemoWorld()` currently creates:

- the world;
- businesses;
- NPCs;
- market;
- player;
- player starting items;
- actions.

Separate these responsibilities.

Move toward something conceptually like:

```ts
registerGameActions(engine)

createWorld(engine, worldConfig)

createPlayerCharacter(engine, characterConfig)
```

or another clean equivalent.

Important:

Loading an existing save must NOT require a function named `seedDemoWorld()` to be called merely to reconstruct in-memory action definitions.

Explicitly separate:

```text
registration/bootstrap code
```

from:

```text
new-world seeding
```

This is important for persistence.

Preserve test/headless compatibility.

# 1. Application state / title screen

The game should no longer immediately create a fresh world on App mount.

Introduce clear top-level application states such as:

```text
booting
title
new-game
character-creation
playing
load-game
```

or an equivalent clean state machine.

On initial load, after sql.js and the save index are available, show:

# The Wyrnlands

- Continue
- New Game
- Load Game
- Settings

`Continue` should only be enabled if an autosave/recent save exists.

Do not initialize a new simulation until the player chooses New Game or loads an existing game.

# 2. Character Creation

Create a Character Creation screen.

At minimum support:

## Identity

- First name
- Last name

Validate sensible non-empty values.

The final entity display name should be:

```text
FirstName LastName
```

Create a household name from the surname, e.g.:

```text
The Barnett Household
```

Do not hardcode English naming assumptions too deeply if easily avoidable, but surname-based household naming is fine for now.

## Starting preset

Provide at least:

- Standard
- Custom

`Standard` should preserve the intended harsh progression.

Do not accidentally make the normal game dramatically easier.

A Standard start should be approximately equivalent to the current intended start:

- modest coin;
- basic clothes/shoes;
- no owned land;
- no business;
- little or no trade experience;
- rough/tavern-tier housing situation.

## Custom starting conditions

Allow configurable:

- starting coin;
- starting skills / skill XP or levels;
- starting gear/items where practical;
- world seed;
- possibly initial season/world-roll behavior if cleanly supported.

Do not expose settings that do not actually influence the game.

Do not invent twenty RPG attributes with no simulation effect.

If traits such as ambition/risk tolerance are primarily NPC decision inputs and human decisions replace those systems, they do not need to be prominent player stats.

Skills and resources matter much more.

## Skills

At minimum expose current implemented skills:

- Labor
- Farming
- Woodcutting
- Milling
- Baking
- Trading
- Management

If additional implemented skills already exist, derive the list where possible rather than duplicating it.

The player character should have skill records for all relevant skills, even when level 0, so the Character Sheet can show progression from zero.

Avoid stuffing fake XP into the normal preset simply for display.

# 3. New game configuration object

Introduce a typed configuration boundary, conceptually:

```ts
interface NewGameConfig {
  world: {...}
  character: {...}
}
```

It should be possible for tests to create a game using this configuration without React.

The engine/world setup must remain headless-testable.

Do not make React form state itself the source of truth for world creation rules.

# 4. Create the player as a real household member

On New Game:

Create:

```text
player person
player household
household membership
```

Example:

```text
Chris Barnett
The Barnett Household
```

The player should remain a foreground actor despite household membership.

Decide carefully where starting coin belongs.

The current economy distinguishes:

```text
person wallet
household wallet
```

NPC wages generally feed households.

For a single-person player household, avoid creating confusing duplicate wealth pools.

Choose a consistent initial model and document it.

A likely approach:

- household holds household resources/food/home wealth;
- character carries personal inventory/gear;
- foreground player purchases can use appropriate payer depending on context;
- business founding can still use the player's designated purse.

Do not silently create coin transfers or double starting money.

Conservation audit must remain correct.

# 5. Player Character screen

Create a dedicated player-facing Character screen rather than reusing the NPC screen exactly.

Do reuse the existing profile/report infrastructure where appropriate.

The current `getPersonProfile()` already provides much of what is needed.

The Character screen should provide strong progressive disclosure.

Recommended tabs:

```text
Overview
Skills
Inventory
Equipment
History
```

## Overview

Show:

- full character name;
- current job and employer;
- wage;
- household/home;
- coin/wealth;
- current needs/condition;
- owned/managed businesses;
- major current status.

Example:

```text
Chris Barnett

Occupation
Farmhand — Oster Farm
28 coin / shift

Home
The Barnett Household
Sleeping Ox common room

Coin
247

Condition
Hunger 86
Thirst 74
Energy 62
Warmth 91

Businesses
None
```

## Skills

Show every relevant skill including level 0.

Show:

- level;
- XP;
- XP to next level;
- optionally success chance where useful.

Do not hide the player's own exact numbers behind NPC-style Inspect mode.

The player is allowed to know their own stats.

## Inventory

Show:

- carried items;
- quantity;
- condition;
- weight;
- total carried weight;
- carry capacity;
- useful descriptions if available.

## Equipment

Show:

- worn slot;
- item;
- durability/condition;
- warmth or relevant effects;
- empty slots.

If current engine APIs allow it safely, add equip/unequip controls.

If not, build the smallest correct engine/UI command layer needed.

Do not manipulate DB state directly from React.

## History

Show:

- job history;
- businesses founded/owned;
- important personal log events;
- later this can expand into life history.

# 6. Top-level player navigation

The player should not have to discover their own character through NPC lists.

Introduce clear primary navigation.

At minimum make these easily accessible:

- Character
- Home / Household
- Work / Jobs
- Businesses
- Settlement
- Market or Locations
- Chronicle / Logs
- Save

This does not have to become a giant permanent navbar if that harms the current UI.

Use a sensible layout, but Character/Home/Save should always be discoverable.

# 7. Player Home / Household

Add a player-facing household/home screen.

Do not pretend the full Stage 6/12 housing simulation exists if it does not.

Surface the current truth.

The existing household has:

```text
homeSiteId
shared inventory
shared wealth
members
business ties
```

Show these in a player-appropriate view.

For now distinguish at least:

- current household;
- current lodging/home site;
- household inventory;
- household funds/reserves where relevant;
- household members;
- businesses owned by household members.

If the player begins effectively lodging at the tavern, say so.

Example:

```text
Home

The Barnett Household

Current lodging
The Sleeping Ox
Common-room / bunk lodging

Members
Chris Barnett

Household stores
3 bread
4 water
1 firewood
```

Do not fake cottage ownership yet.

# 8. Housing choice groundwork

The player should eventually choose where to live rather than the autonomous routine deciding night-by-night whether to buy a bunk.

Do not build the entire construction/housing economy in this task unless current code already supports it cleanly.

But restructure player lodging so later housing can slot in.

The intended ladder is:

```text
rough sleeping
→ tavern/common room
→ rented room
→ rented cottage
→ owned cottage
→ constructed/upgraded home
```

For this task, implement only what the current world can support without fake systems.

At minimum:

- expose current lodging;
- make the player able to prefer rough/tavern lodging;
- stop burying lodging behavior entirely inside the autonomous routine;
- define a clean model/API where future rented/owned properties can become the player's selected residence.

If a small `player_preferences` / routine-policy table is appropriate, consider it.

Do not implement construction.

# 9. Player autonomy should remain, but become configurable

Do NOT remove the player's autonomous daily routine.

It is useful that the player does not need to manually:

- drink;
- eat;
- sleep;
- show up to every routine shift;
- maintain basic provisions.

The player should control strategic/life decisions while the character handles routine execution.

Add a player Routine / Automation settings panel or equivalent.

At minimum support toggles/preferences like:

```text
Automatically attend work
Automatically eat/drink
Maintain provisions
Sleep automatically
Preferred lodging
Reserve at least X coin before optional routine spending
```

Do not overcomplicate this into a programmable AI system.

The goal is:

> Player chooses the life; character handles mundane execution.

Any manually queued action must continue to take precedence over autonomous routine behavior.

# 10. Buying tools and meaningful personal equipment

Review the current market UI.

The market currently exposes only a subset of existing goods as hardcoded actions.

The player should be able to buy relevant tools that actually exist, especially:

- axe;
- hoe;
- future tools.

Prefer moving toward a market interface driven by real market listings rather than one button hardcoded per good.

Do not completely redesign market economics in this task.

But make it possible for the player to see and purchase actual goods that are available.

This is important for progression:

```text
work for employer
→ save money
→ buy own tool
→ eventually strike out independently
```

# 11. Player business founding groundwork / implementation

The engine already has generic business founding primitives in:

```text
companies/founding.ts
```

These were intentionally designed to be shared by NPCs and the player.

Do not create a second player-only business creation implementation.

Expose the existing shared `foundCompany()` path through Engine / UiApi.

Create a player-facing "Start a Business" flow if it can be done cleanly in this pass.

At minimum it should support current business types:

- farm;
- logging;
- mill;
- bakery.

The UI should allow:

- choose business type;
- choose available matching parcel;
- choose lease or freehold;
- see land entry cost / purchase price;
- see weekly rent;
- see mandatory tool costs;
- see minimum input stock;
- choose investment amount;
- choose initial staffing/owner-operator setup;
- name the company;
- see total startup outlay before confirming.

Example:

```text
Start a Business

Trade
Logging

Parcel
North Forest Parcel

Tenure
Lease

Entry fine       60
Weekly rent      15
Axe              70
Initial reserve  100

Total investment 230

You will work the first position yourself.

[Found Barnett Timber]
```

The confirmation must use the same transactional `foundCompany()` code NPCs use.

No free land/tools/capital.

If the player lacks funds, clearly explain what is missing.

If implementing full founding UI materially blows up this task, complete the Engine/UiApi player-facing command path and create a functional minimal screen rather than postponing the architecture.

# 12. Player-owned business management distinction

Inspect existing company cadence carefully.

A player-owned company should not silently have NPC management logic overriding major player choices.

Do not fully implement the entire Stage 6 business-management UI in this task unless straightforward.

But ensure the architecture distinguishes:

```text
NPC-managed company
```

from:

```text
player-managed company
```

The future player management UI must control:

- wages;
- staffing targets;
- inventory targets;
- purchasing policies;
- expansion/upgrades;
- owner draws;
- contracts.

Routine operations may remain automatic, but strategic decisions should belong to the player.

If current `applyCompanyDailyCadence()` would automatically make strategic decisions for a player-owned business, identify and resolve the minimum architectural issue now or clearly document the follow-up.

Do not create player advantages outside the normal economic rules.

# 13. Save/Load architecture

Implement proper browser persistence.

The SQLite DB is the authoritative game state.

Do NOT invent a parallel JSON representation of simulation state.

Use:

```text
SQLite bytes = simulation save
```

The existing:

```ts
engine.export()
```

already persists the RNG state.

The existing checkpoint/reload tests prove database export/import can preserve deterministic state.

Build a save service around this.

# 14. IndexedDB saves

Use IndexedDB, not localStorage, for save bytes.

Create a small persistence layer isolated from React components.

Support:

```text
autosave
manual save slots
```

At minimum store:

```ts
interface SaveMetadata {
  id
  displayName
  characterName
  tick
  year
  season
  day
  worldSeed
  createdAt
  updatedAt
  gameVersion
  saveFormatVersion
}
```

Wall-clock metadata such as `createdAt` / `updatedAt` should be outside the simulation DB so it cannot affect deterministic engine state.

Store:

```text
metadata
+
SQLite Uint8Array / ArrayBuffer
```

Use appropriate IndexedDB binary storage.

# 15. Autosave

Implement autosave with sensible behavior.

Do not save on every tick.

A reasonable model could include:

- autosave periodically in real time while playing;
- autosave at safe simulation boundaries;
- autosave on important transitions;
- autosave when returning to title/explicit save action.

Choose an implementation that does not noticeably stall the game.

Never autosave a partially-mutated DB state.

Because `engine.export()` writes RNG state before export, preserve that correctness.

If exporting frequently has measurable performance cost, document and choose a sensible cadence.

# 16. Manual Save screen

Provide a Save Game screen/panel.

Support:

- create/overwrite manual slots;
- display character name;
- date/season/year;
- last saved time;
- optionally coin/current settlement;
- delete save with confirmation.

Keep UI simple.

# 17. Continue

On title screen:

```text
Continue
```

should load the most recent valid autosave/manual save according to a clearly defined rule.

Prefer latest autosave for Continue unless there is a stronger existing convention.

If no save exists, disable/hide Continue.

# 18. Load Game

Load Game should list saves from IndexedDB.

Selecting one should:

1. pause/dispose current engine if one exists;
2. create a DB from the stored SQLite bytes;
3. run migrations;
4. bootstrap Engine;
5. re-register all in-memory action definitions/policies;
6. restore player control/autonomy configuration;
7. create UiApi;
8. enter playing state.

Do not reseed world content.

Loading must not call world-seeding logic in a way that can mutate an existing save.

# 19. Portable save export/import

Implement:

```text
Export Save
Import Save
```

Export should download the raw SQLite save or an equally transparent wrapper if absolutely necessary.

Preferred:

```text
wyrnlands-chris-barnett.sqlite
```

Import should:

- accept a `.sqlite` file;
- validate it as a Wyrnlands save;
- run migrations if older but compatible;
- reject malformed/incompatible files gracefully;
- add it to the save list without mutating an existing slot unless explicitly chosen.

Do not expose internal DB errors directly to users.

# 20. Save versioning

The master plan already calls for save versioning later, but persistence now makes it necessary to establish the foundation.

At minimum distinguish:

```text
schema migration version
save format version
game version
```

Do not reinvent schema migration; use the existing migration system.

A save from an older schema should pass through migrations on load.

Add clear handling for a future save that is newer than the running game and cannot safely load.

# 21. Player profile/API

Extend the Engine and UiApi narrowly rather than letting React reach into SQLite.

Likely additions include equivalents of:

```text
getPlayerEntityId()
getPlayerProfile()
getPlayerHousehold()
getPlayerRoutinePreferences()

setPlayerRoutinePreferences(...)
foundPlayerCompany(...)
listBusinessTypes()
estimatePlayerBusinessStartup(...)
save-related app service outside engine
```

Exact API design is up to you after inspecting the code.

Maintain the architecture rule:

> React talks to UiApi/commands; React never manipulates simulation DB directly.

# 22. Do not expose NPC "Inspect" rules to the player's own data

NPC profiles distinguish public knowledge from hidden simulation state.

That is correct for NPCs.

The player's own Character screen should normally show exact:

- skill XP;
- inventory;
- equipment;
- needs;
- own cash;
- own household resources;
- own business books.

The player does not need an Inspect toggle to see their own possessions.

Hidden world/NPC information should remain hidden unless Inspect/debug mode is explicitly enabled elsewhere.

# 23. Tests

Add strong tests.

At minimum cover:

## Identity / character creation

1. New game creates the requested first + last name.
2. Player narration remains second-person even when their name is not `"You"`.
3. Empty/invalid name input is rejected cleanly.
4. Standard preset produces expected starting resources.
5. Custom preset applies configured coin/skills/items exactly once.
6. Character creation does not alter unrelated world RNG behavior unexpectedly.

## Player household/control

7. Player belongs to a household.
8. Player remains foreground simulated despite household membership.
9. NPC household members remain background/coarse simulated.
10. Player household/home is queryable through UI API.
11. No duplicate starting coin exists between person and household.

## Character screen

12. Player profile returns all skills including level 0 as intended.
13. Inventory and worn equipment display correctly.
14. Job history updates after employment changes.
15. Owned business appears in character profile after founding.

## Player autonomy

16. Autonomous work/eat/drink/sleep still functions.
17. Disabling a routine option actually prevents that automatic behavior.
18. Manually queued actions still override routine behavior.
19. Player household membership does not suppress per-tick needs.

## Business founding

20. Player uses the same `foundCompany()` transactional path as NPCs.
21. Land/tool/input costs are actually paid.
22. Insufficient funds causes no partial company.
23. Founder can become owner-operator.
24. Resulting company appears in player Character/Business views.
25. Conservation audit passes.

## Save/load

26. Exported save reloads to identical logical state.
27. Player name survives reload.
28. Player household survives reload.
29. skills/inventory/equipment survive reload.
30. employment survives reload.
31. business ownership/founding survives reload.
32. routine/autonomy preferences survive reload.
33. current actions/queues survive reload if they are designed to.
34. RNG resumes correctly.
35. loading does not duplicate seed content.
36. loading re-registers action definitions correctly.
37. migrations run correctly on an older test save.
38. corrupted/non-Wyrnlands data is rejected.
39. save → load → continue simulation remains deterministic.

## IndexedDB service

Mock or test the persistence layer where appropriate:

40. create slot;
41. overwrite slot;
42. delete slot;
43. list slots;
44. autosave slot;
45. most-recent Continue selection;
46. metadata and SQLite bytes round-trip correctly.

# 24. Browser/manual smoke testing

After implementation, test the actual user flow:

```text
Launch app
→ Title screen
→ New Game
→ Character Creation
→ create named character
→ enter Oakford
→ open Character screen
→ inspect skills/inventory/equipment
→ get a job
→ advance time
→ save
→ reload page
→ Continue
→ same character/world resumes
```

Also test:

```text
Export Save
→ delete/local clean state if practical
→ Import Save
→ load imported character
```

No console errors.

# 25. Preserve determinism and conservation

This work must not weaken:

- deterministic simulation;
- RNG persistence;
- conservation auditing;
- provenance;
- headless execution;
- migrations;
- NPC/business behavior.

Run long simulation tests after the player/control refactor to ensure changing the foreground/household distinction did not accidentally alter NPC economy behavior.

# 26. UI quality

The purpose of this task is engagement, not merely plumbing.

The player should immediately understand:

```text
Who am I?
What am I good at?
Where do I live?
What do I own?
Where do I work?
How am I doing?
What can I work toward next?
```

Use the existing visual language.

Prefer clear character-centric wording.

Do not turn the Character screen into a debug database inspector.

# 27. Suggested implementation order

Use this order unless inspection reveals a stronger dependency:

1. explicit player-controlled identity;
2. separate household membership from NPC/background LOD;
3. separate action registration / world seeding / player creation;
4. typed NewGameConfig;
5. title screen + app state;
6. character creation;
7. player household creation;
8. Character screen;
9. Home/Household screen;
10. player routine preferences;
11. market/tool accessibility improvements;
12. player business founding command/UI;
13. save persistence service;
14. Save / Load / Continue UI;
15. autosave;
16. export/import;
17. comprehensive regression/determinism tests.

Do not leave the repository halfway through the identity refactor.

# 28. Scope discipline

Do NOT implement in this pass:

- full marriage/children;
- aging/death;
- full housing construction;
- regional travel overhaul;
- credit/loans;
- new industries;
- combat;
- politics/government;
- deep RPG attribute systems with no current mechanics;
- full Stage 6 business-management suite unless required for correctness.

If a complete player-business management screen is too large, expose founding and ownership correctly and document the next management slice.

# 29. Documentation

Update `DECISIONS.md` with:

- why player identity was separated from the name `"You"`;
- why household membership was separated from NPC/background simulation mode;
- NewGameConfig structure;
- standard starting preset;
- player household model;
- autonomous routine philosophy;
- save architecture;
- IndexedDB decision;
- SQLite-as-save decision;
- action-registration/load lifecycle;
- player business founding integration;
- validation results.

Update `MASTERPLAN.md` where implementation now differs from or fulfills planned Character Sheet / Save Load / Stage 6 groundwork.

# Final report

Do not stop after analysis.

Implement the feature set, validate it, and provide a concise final report containing:

- baseline tests before work;
- major architectural changes;
- title/new-game flow;
- character creation options;
- player household/control model;
- Character/Home screens added;
- autonomy controls;
- player business founding status;
- save/load architecture;
- autosave behavior;
- export/import behavior;
- files/migrations added;
- test results;
- browser smoke result;
- known remaining gaps;
- recommended next player-experience slice.

The design goal is:

> The simulation should no longer feel like the player is an anonymous camera watching Oakford. The player should feel like a named person who lives there, works there, owns things, learns skills, chooses where to live, can eventually build a business, and can return to that same life tomorrow by loading the save.