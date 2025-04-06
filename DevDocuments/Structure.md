# The Wyrnlands - Project Structure

This document outlines the file and directory structure for The Wyrnlands project.

## Root Directory (`/`)

- `index.html`: Main HTML entry point for the game.
- `main.js`: Initializes the Phaser game instance and loads initial scenes/assets.
- `README.md`: Project overview and setup instructions.
- `LICENSE.md`: Project license information.
- `.gitignore`: Specifies intentionally untracked files that Git should ignore.
- `package.json`: (Optional, if using npm for dependencies/scripts) Project metadata and dependencies.
- `DevDocuments/`: Contains all design, planning, and tracking documents.
  - `Prompt.md`
  - `TechnicalDocument.md`
  - `Structure.md` (This file)
  - `Roadmap.md`
  - `MVPChecklist.md`
  - `TestTracker.md`

## Source Code (`/src`)

Contains all the JavaScript source code for the game logic.

- `src/`
  - `scenes/`: Phaser scenes representing different game states (e.g., Boot, Preloader, MainGame, UI).
    - `BootScene.js`
    - `PreloaderScene.js`
    - `GameScene.js`
    - `UIScene.js`
  - `engines/`: Core game system modules.
    - `mapEngine.js`
    - `playerEngine.js` (Handles player state, needs, skills)
    - `economyEngine.js`
    - `constructionEngine.js`
    - `npcEngine.js`
    - `timeEngine.js` (Manages game time, speed, day/night)
  - `managers/`: Higher-level managers coordinating engines or UI.
    - `uiManager.js` (Manages HUD, menus, overlays)
    - `saveLoadManager.js` (Handles SQLite interaction via sql.js and FileSaver.js)
  - `gameobjects/`: Custom Phaser game objects (e.g., PlayerSprite, BuildingSprite).
  - `businesses/`: Logic specific to different business types.
    - `blacksmith.js`
    - `mining.js`
    - `transportation.js`
    - `...` (Add other business types here)
  - `guilds/`: Logic related to guilds and membership.
    - `guildManager.js`
  - `utils/`: Utility functions, grouped by purpose.
    - `timeUtils.js`
    - `inventoryUtils.js`
    - `laborUtils.js`
    - `tileUtils.js`
    - `economyUtils.js`
    - `transportUtils.js`
    - `buildingUtils.js`
    - `nameGenerator.js`
    - `eventUtils.js`
    - `logUtils.js`
    - `dbUtils.js` (Specific helpers for sql.js interaction)
    - `productionUtils.js` (Crafting, resource transformation)
    - `reputationUtils.js` (Managing reputation between entities)
    - `contractUtils.js` (Managing contracts)
    - `guildUtils.js` (Guild membership, ranks, permissions)
  - `data/`: Data-related files, including initial SQLite schema setup.
    - `schema.sql` (SQL commands to create initial database tables)
    - `database.js` (Module to initialize and interact with sql.js)
    - `skillsData.js` (Defines available skills and their properties)
    - `equipmentData.js` (Defines available armor, clothing, etc.)
    - `toolsData.js` (Defines available tools)
    - `resourceData.js` (Defines raw resources and intermediate goods)

## Assets (`/assets`)

Contains all static game assets.

- `assets/`
  - `images/`: Spritesheets, tilesets, UI elements.
  - `audio/`: Sound effects, music.
  - `data/`: JSON files for configuration, levels, etc. (if needed).

## Stylesheets (`/css`)

Contains CSS files for styling the HTML UI elements.

- `css/`
  - `style.css`: Main stylesheet.

## Libraries (`/lib`)

Contains external JavaScript libraries.

- `lib/`
  - `phaser.min.js`: Phaser library.
  - `sql-wasm.js`: sql.js library.
  - `sql-wasm.wasm`: sql.js WASM file.
  - `FileSaver.min.js`: FileSaver.js library.

## Tests (`/tests`)

Contains unit tests for the game modules.

- `tests/`
  - `unit/`: Unit tests for individual modules.
    - `engines/`
    - `utils/`
    - `managers/`
    - `businesses/`
    - `guilds/`
  - `test-runner.html`: (Optional) HTML runner for browser-based tests.
  - `setup.js`: (Optional) Test setup/configuration.

---

This structure promotes modularity and separation of concerns, making the codebase easier to manage, test, and extend. Adherence to this structure is required as per `Prompt.md`.