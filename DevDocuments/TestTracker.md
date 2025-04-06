 :# The Wyrnlands - Test Tracker

This document tracks the results of unit tests performed during development, as required by `MVPChecklist.md`.

-----

Table:
[X] = Testing Complete
[/] = Testing In Progress/Not Complete
[] = Not Tested Yet

Tests will be reported in this (Example) format:
[X] [Date/Time] [FileTested] [Notes]
 - [X][Component/Units Tested] [Notes]
 - [X][Component/Units Tested] [Notes]
 - [/][Component/Units Tested] [Notes]
 - [/][Component/Units Tested] [Notes]

 Note: Only create one log per file, then update time and add/edit unit tests as necessary.

 ----- Place Real Tests Below This Line -----

[X] [4/5/2025, 12:57 AM] [src/data/database.js] [MVP Checklist Step 2]
 - [X][initializeDatabase() / Table Creation] [Verified creation of Player, Buildings, MapTiles, NPCs, Households, Inventory, Skills tables via tests/unit/data/database.test.js]

[X] [4/5/2025, 1:36 AM] [src/managers/saveLoadManager.js] [MVP Checklist Step 3]
 - [X][saveGame()] [Verified successful save calls saveAs with correct Blob/filename, handles DB not initialized, handles export errors]
 - [X][loadGameFromFile()] [Verified successful load calls importDatabase, handles file read errors, handles import errors, handles DB init if needed, handles empty file]
 - [X][triggerLoadGame()] [Verified file input creation/click, handles file selection, handles cancellation/no selection]

[X] [4/5/2025, 3:38 AM] [src/engines/mapEngine.js] [MVP Checklist Step 4 / Phase 2.1]
  - [X][initializeMap()] [Verified map dimensions and default tile creation (in-memory)]
  - [X][getTile()] [Verified correct tile retrieval and bounds checking (in-memory)]
  - [X][isWalkable()] [Verified walkable status check and bounds checking (in-memory)]
  - [X][isBuildable()] [Verified buildable status check (including existing building check) and bounds checking (in-memory)]
  - [X][updateTileProperties()] [Verified partial and full property updates (in-memory), ignored out-of-bounds updates]
  - [X][initializeMap() - DB Load] [Verified loading existing map data from mock DB]
  - [X][initializeMap() - DB Generate] [Verified generation and saving of default map data to mock DB]
  - [X][initializeMap() - DB Error] [Verified fallback to in-memory grid on DB error]
  - [X][updateTileProperties() - DB Save] [Verified correct SQL UPDATE statement and parameters sent to mock DB]
  - [X][updateTileProperties() - DB Revert] [Verified in-memory state reverts if mock DB update fails]
  - [X][createMapVisuals() - Scene Interaction] [Verified calls to mock scene.add.graphics/text]
  - [X][createMapVisuals() - Graphics Calls] [Verified calls to mock graphics methods (fillStyle, fillRect, etc.)]
  - [X][createMapVisuals() - Input Listener] [Verified registration of pointermove listener on mock input]
  - [X][createMapVisuals() - Error Handling] [Verified handling of calls before init or without scene]
[X] [4/5/2025, 1:39 AM] [src/engines/playerEngine.js] [MVP Checklist Step 5]
 - [X][initializePlayer()] [Verified default state and initialization with custom data]
 - [X][getPlayerAttribute()] [Verified correct attribute retrieval and handling of non-existent attributes]
 - [X][updatePlayerAttributes()] [Verified partial attribute updates]
 - [X][modifyNeed()] [Verified correct increase/decrease and clamping (0-MAX_NEED)]
 - [X][getSkill(), addSkillXP()] [Verified default skill return, skill initialization on first XP add, XP addition]

[X] [4/5/2025, 5:16 AM] [src/engines/movementEngine.js] [MVP Checklist Step 6 / Phase 2.3 / Interactable Buildings Step 1]
 - [X][moveToTile()] [Verified successful move updates player coords, prevents move to non-walkable tiles, handles missing player coords, calls sprite update]
 - [X][initializeMovementEngine()] [Verified registration of pointerdown listener, handles missing scene/sprite]
 - [X][pointerdown listener - Move] [Verified calculation of tile coords and call to moveToTile for empty tiles]
 - [X][pointerdown listener - Interact] [Verified call to handleBuildingInteraction for tiles with buildings]
 - [X][moveToTile() - Movement Cost] [Verified call to playerEngine.modifyNeed('fatigue', ...) upon successful move]
[X] [4/5/2025, 5:16 AM] [src/engines/survivalEngine.js] [MVP Checklist Step 7 / Phase 2.4]
 - [X][initializeSurvivalEngine()] [Verified registration of daily callback with timeEngine mock]
 - [X][applyDailySurvivalDecay() - Decay] [Verified modifyNeed called for hunger/thirst with correct daily values]
 - [X][applyDailySurvivalDecay() - Health Damage] [Verified modifyNeed called for health when hunger or thirst is zero]
 - [X][applyDailySurvivalDecay() - No Health Damage] [Verified modifyNeed not called for health when needs are sufficient]
 - [X][applyDailySurvivalDecay() - Death State] [Verified death trigger (showGameOver mock) called when health reaches zero]
 - [X][applyDailySurvivalDecay() - No Death State] [Verified death trigger not called when health is above zero]
 - [X][Persistence] [Verified persistence is handled via playerEngine.modifyNeed calls, which were tested separately]

[X] [4/5/2025, 5:04 AM] [src/engines/buildingEngine.js] [MVP Checklist Step 8 / Interactable Buildings Step 3]
 - [X][initializeBuildingEngine()] [Verified engine initializes]
 - [X][placeBuilding()] [Verified successful placement updates map/internal state, fails if tiles not buildable, generates unique IDs]
 - [X][removeBuilding()] [Verified successful removal updates map/internal state, handles non-existent IDs, handles multi-tile]
 - [X][getBuildingById()] [Verified correct building retrieval and handling of non-existent IDs]
 - [X][getBuildingInteractions()] [Verified returns placeholder interactions for existing building, empty array for non-existent]

[X] [4/5/2025, 1:51 AM] [src/utils/inventoryUtils.js] [MVP Checklist Step 9 - Placeholder Logic]
- [X][addItem()] [Placeholder test verifies logging]
- [X][removeItem()] [Placeholder test verifies logging and return value]
- [X][getItemQuantity()] [Placeholder test verifies logging and return value]
- [X][getInventory()] [Placeholder test verifies logging and return value]

[X] [4/5/2025, 1:52 AM] [src/engines/taxEngine.js] [MVP Checklist Step 10 - Placeholder Logic]
- [X][initializeTaxEngine()] [Placeholder test verifies logging]
- [X][applyMonthlyTaxes()] [Placeholder test verifies logging]
- [X][handleRepossession()] [Placeholder test verifies logging]

[X] [4/5/2025, 1:53 AM] [src/engines/skillEngine.js] [MVP Checklist Step 11 - Placeholder Logic]
- [X][initializeSkillEngine()] [Placeholder test verifies logging]
- [X][addSkillXP()] [Placeholder test verifies logging and return value, level up logic pending]
- [X][getSkillLevel()] [Placeholder test verifies logging and return value]
- [X][calculateSkillModifiers()] [Test verifies calculation logic for different levels]

[X] [4/5/2025, 1:54 AM] [src/engines/jobEngine.js] [MVP Checklist Step 12 - Placeholder Logic]
- [X][initializeJobEngine()] [Placeholder test verifies logging]
- [X][assignJob()] [Placeholder test verifies logging and return value]
- [X][removeJob()] [Placeholder test verifies logging and return value]
- [X][processWorkShift()] [Placeholder test verifies logging, detailed logic pending]

[X] [4/5/2025, 1:55 AM] [src/engines/npcEngine.js] [MVP Checklist Step 13 - Placeholder Logic]
- [X][initializeNPCEngine()] [Placeholder test verifies logging]
- [X][createNPC()] [Placeholder test verifies logging and return value]
- [X][setNpcState()] [Placeholder test verifies logging]
- [X][processNpcTick()] [Placeholder test verifies logging, detailed logic pending]

[X] [4/5/2025, 1:57 AM] [src/engines/constructionEngine.js] [MVP Checklist Step 14 - Placeholder Logic]
- [X][initializeConstructionEngine()] [Placeholder test verifies logging]
- [X][startConstruction()] [Placeholder test verifies logging and return value]
- [X][processConstructionTick()] [Placeholder test verifies logging, detailed logic pending]
- [X][completeConstruction()] [Placeholder test verifies logging, detailed logic pending]

[X] [4/5/2025, 1:58 AM] [src/utils/laborUtils.js] [MVP Checklist Step 15 - Placeholder Logic]
- [X][addLabor()] [Placeholder test verifies logging]
- [X][checkAvailableLabor()] [Placeholder test verifies logging and return value (original)]
- [X][consumeLabor()] [Placeholder test verifies logging and return value (false due to placeholder checkAvailableLabor)]

[X] [4/5/2025, 1:59 AM] [src/engines/timeEngine.js] [MVP Checklist Step 16]
 - [X][initializeTimeEngine()] [Verified default state and initialization]
 - [X][advanceTime()] [Verified correct time progression (sec, min, hr, day)]
 - [X][tick interval] [Verified interval calls advanceTime and callback using fake timers]
 - [X][pause()/resume()] [Verified pausing/resuming stops/starts time advancement via tick]
 - [X][setTimeScale()] [Verified changing timescale affects time advancement rate]
 - [X][startSleep()/stopSleep()/advanceTime()] [Verified sleep state, fast-forwarding, wake-up at 7:00 AM, manual stop]
 - [X][getCurrentTime()] [Verified correct time object and string formatting]

[X] [4/5/2025, 5:04 AM] [src/managers/uiManager.js] [MVP Checklist Step 17 / Interactable Buildings Steps 2 & 4]
 - [X][initializeUIManager()] [Verified logging]
 - [X][updateStatusBar()] [Verified width calculation, clamping (0-100%), handling of missing elements/types]
 - [X][updateTimeDisplay()] [Verified textContent update, handling of missing element]
 - [X][updateSelectedTileInfo()] [Verified textContent update for tile data and null, handling of missing element]
 - [X][handleBuildingInteraction()] [Verified calls getBuildingInteractions mock and logs interaction menu display]
 - [X][handleBuildingInteraction() - No Actions] [Verified logs correctly when no interactions are returned]

 Developer Note: Checklist is Complete [X] Signed, C.D. 4/5/2025 0219

[X] [4/5/2025, 5:16 AM] [src/engines/playerEngine.js] [Phase 2.2]
 - [X][initializePlayer() - Defaults] [Verified default state initialization when DB mock is empty, verified INSERT Player and INSERT Skills calls]
 - [X][initializePlayer() - Load] [Verified loading existing player and skill data from mock DB]
 - [X][initializePlayer() - DB Error] [Verified fallback to default state on DB error]
 - [X][getPlayerAttribute()] [Verified correct attribute retrieval]
 - [X][updatePlayerAttributes() - Memory] [Verified in-memory state updates correctly before async DB call]
 - [X][updatePlayerAttributes() - DB Save] [Verified correct SQL UPDATE statement and parameters sent to mock DB]
 - [X][updatePlayerAttributes() - DB Revert] [Verified in-memory state reverts if mock DB update fails]
 - [X][modifyNeed()] [Verified correct increase/decrease and clamping (0-MAX_NEED)]
 - [X][modifyNeed() - DB Save] [Verified call to updatePlayerAttributes to persist change]
 - [X][getSkill()] [Verified correct skill retrieval and default for non-existent]
 - [X][addSkillXP() - Add] [Verified XP addition]
 - [X][addSkillXP() - Level Up] [Verified single and multiple level ups based on formula]
 - [X][addSkillXP() - Max Level] [Verified level caps at 100 and XP gain stops/resets]
 - [X][addSkillXP() - DB Save] [Verified call to saveSkillsToDb to persist change after XP gain and level up]

[X] [4/5/2025, 4:46 PM] [src/utils/economyUtils.js] [Phase 2 - Economy Foundation]
 - [X][formatCurrency()] [Verified formatting for various amounts (copper, silver, gold, zero, negative, invalid)]
 - [X][calculateWage()] [Verified calculation based on skill, difficulty, reputation, and minimum wage clamp]
 - [X][calculateTransactionTax()] [Verified tax calculation and handling of invalid inputs]
 - [X][getEntityType()] [Verified correct type identification based on ID prefix]
 - [X][processTransaction()] [Verified successful transfer, insufficient funds check, invalid amount/ID checks, and handling of mocked fund function failures (including revert logic)]