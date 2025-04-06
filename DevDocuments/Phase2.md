MVP Phase 2: Core World & Player Checklist
🔹 2.1 — Create mapEngine.js (Tile/Grid Map System)
📦 File: src/engines/mapEngine.js
🎯 Goal:
Render a walkable grid-based tile map in Phaser and mark tiles for walkability and buildability.

✔️ [X] Checklist:
 Define tile size (e.g., 32x32 px or 64x64 px).

 Create Phaser tilemap with Phaser.Tilemaps.StaticTilemapLayer.

 [X] Initialize grid dimensions (e.g., 100x100).

 [X] Store grid in SQLite table: MapTiles (tileId, x, y, isWalkable, isBuildable, terrainType). (DB interaction implemented)

 Generate visual tile graphics based on terrainType (placeholder is fine for MVP).

 Color-code walkable vs buildable tiles (e.g., green = walkable, brown = buildable).

 Enable debug overlay to show tile info on hover.

 [X] Add utility function: getTileAt(x, y) that returns tile metadata. (Implemented as getTile)

🧪 [X] Unit Tests:
 [X] Confirm that MapTiles table is generated and populated correctly. (Via mock DB tests)

 [X] Test getTileAt(x, y) returns correct tile metadata. (Via mock DB tests)

 Test rendering for a known set of tiles (3 walkable, 2 buildable, 1 blocked).

 [X] Log test results in testtracker.md.

🔹 2.2 — Create playerEngine.js
📦 File: src/engines/playerEngine.js
🎯 Goal:
Handle player attributes: identity, health states, and skill structure.

✔️ [/] Checklist: (Partially complete)
 Define base Player object with:

 [X] name, surname, gender, title

 [X] hunger, thirst, health

 [X] skills object (e.g., { carpentry: 1, farming: 1 })

 [X] position (x, y on map)

 On game start, prompt player to create or randomize a character.

 Assign initial values:

 [X] Hunger/Thirst: 100%

 [X] Skills: all level 1

 [X] Position: central tile (e.g., 50, 50)

 [X] Connect to SQLite: Player table. (Load/Save implemented)

 [X] Add function: updatePlayerStat(stat, value) (Implemented as updatePlayerAttributes)

 [X] Add function: getPlayerStat(stat) (Implemented as getPlayerAttribute)

 [X] Add function: levelUpSkill(skillName, amount = 1) (Implemented in addSkillXP)

🧪 [/] Unit Tests: (Partially complete)
 [X] Test Player object instantiation with valid values. (Via initializePlayer tests)

 [X] Validate setter/getter logic. (Via getPlayerAttribute tests)

 [X] Simulate skill leveling and confirm values persist. (Via addSkillXP tests, in-memory)

 [/] Ensure SQLite values match object values. (DB interaction tests pending fix)

 [X] Log all test cases in testtracker.md.

🔹 2.3 — Create movementEngine.js
📦 File: src/engines/movementEngine.js
🎯 Goal:
Allow player to move by clicking on walkable tiles. Update position and respond to tile data.

✔️ Checklist:
 Detect mouse click on tile.

 Confirm tile is walkable via mapEngine.getTileAt(x, y).

 If valid: update player.position = {x, y}.

 Add visual feedback: player “dot” moves smoothly to new location.

 Optional: include movement cost (e.g., stamina drop).

 Log movement events: Player moved to (x, y).

🧪 Unit Tests:
 Confirm movement updates player position only on walkable tiles.

 Attempt to move to unwalkable tile (expect failure).

 Confirm tile metadata is fetched correctly on click.

 Validate proper render update after move.

 Log test results in testtracker.md.

🔹 2.4 — Create survivalEngine.js
📦 File: src/engines/survivalEngine.js
🎯 Goal:
Introduce daily hunger/thirst decay and enforce death on zero values.

✔️ Checklist:
 Every in-game day (via timeEngine), decrease:

Hunger by 10

Thirst by 15

 Add function: applySurvivalDecay(player)

 If hunger or thirst reaches 0:

Reduce health daily by 5

If health reaches 0 → trigger death state

 Death state disables input and shows "Game Over" UI

 Track these in SQLite Player table: hunger, thirst, health

🧪 Unit Tests:
 Run 5 day loop → ensure values decay correctly.

 Confirm health drops when hunger/thirst are 0.

 Simulate death and validate system behavior.

 Confirm persistence of survival values to DB.

 Log test output in testtracker.md.

