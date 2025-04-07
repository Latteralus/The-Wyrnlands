**The Wyrnlands — Technical Design Document (Browser-First with SQLite)**

---

## ✨ Project Overview
The Wyrnlands is a medieval life-simulation RPG built for the browser using **Phaser.js** and **SQLite via sql.js**. The game simulates dynamic NPCs, household economies, tile-based construction, travel, social systems, and property ownership. The simulation is entirely local and persistent using an exportable SQLite database.

---

## 📈 Architecture Overview

### 🔢 Core Technologies
- **Framework**: Phaser.js 3 (Canvas rendering)
- **UI Layer**: HTML5/CSS + Modal Panels
- **Database**: SQLite via sql.js (WASM compiled)
- **Save/Load**: FileSaver.js + FileReader API
- **Offline Play**: Fully functional in-browser, no server
- **Testing**: Vitest/jsdom to Test

---

## 📊 Game Systems

### 1. Time System
- Ratio: 1 real second = 60 game seconds
- Options: 1x / 2x / 4x speed
- Day/Night with sleep overlay (force sleep at 2am)
- Sleep always ends at 7:00 AM in-game

### 2. Player HUD
- Bars: Hunger, Thirst, Fatigue, Health, Armor
- Tabs: Character Sheet, Equipment, Skills

### 3. Map & Travel
- Predefined **tile grid** with defined square footage per tile
- Travel occurs via click-based movement
- Camera follows player locally
- Town/world map toggle
- Roads give travel bonuses
- Mounted travel with horse/cart

### 4. NPC & Household Simulation
- NPCs have names, ages, skills, households
- Shared household inventory and funds
- Schedules for work, rest, shopping
- Local reputation affects job offers and interactions (Future)
- Emigration/immigration based on housing/jobs (Future)
- NPCs follow basic schedules (sleep, work) based on time.
- NPCs manage basic needs (hunger, thirst) via survival engine.
- NPCs have assigned social titles (see Social Systems).

### 5. Construction System
- All buildings have:
  - **Square footage** (affects taxes, storage, prestige)
  - **Room count** (affects function and capacity)
- **Tiles** each have max sq. ft (e.g., 500 sq ft per tile)
- Large buildings span multiple tiles
- Construction requires:
  - **Materials** (wood, stone, nails)
  - **Labor** (soft resource)
  - **Time** (build progress (in stages) visible)
- Building upgrades:
  - Horizontal: buy adjacent tiles
  - Vertical: add rooms/storage
- **Labor Types**:
  - General, Carpentry, Masonry
  - 1 Labor = 1 build effort
- Taxation:
  - Monthly taxes per tile owned
  - Nonpayment = repossession

### 6. Economy & Work
- Player can:
  - Work for wages (business gets output)
  - Gather independently (player keeps materials)
  - Level up appropriate skills for faster production (higher skill = faster actions)
- Wage calculation considers skill level (via `skillEngine`).
- Output calculation considers skill level (via `skillEngine`).
- Output scales faster than wage (implemented in `skillEngine.calculateSkillModifiers`).
- Businesses (Owned by NPCs or Players):
  - Have their own bank account
  - Pay wages, taxes, buy supplies
  - Hire managers or staff
  - Must have their own building (to interact with)
- Supply chains:
  - Farm → Mill → Bakery (example)
  - Transport required for all goods (Nothing in this game magically appears or disappears, everything has to be moved by someone (npc or player). The life cycle of products begins with natural resources and ends with items that have hit condition of 0)

### 7. Simulation World
- Towns contain:
  - Residential, industrial, retail buildings (all active an ran/owned by npcs or the player)
  - Resource tiles: forest, quarry, lake
- Visible construction activity
- Workers build, NPCs shop, economy is alive.
- New buildings affect travel and appearance

### 8. Social Systems (Post-MVP Phase 1 WIP)
- **Titles & Nobility:**
    - Characters (Player & NPCs) hold social titles (e.g., Commoner, Freeman, Knight) defined in `titlesData.js`.
    - Title stored in `Player`/`NPCs` table (`title_id`).
    - Player's title displayed in UI.
    - Title effects (privileges, requirements) are planned for future implementation.
- **Reputation:** (Future)
    - Local and global reputation tracking.
    - Affects interactions, prices, job offers.
- **Tithing/Rank Up:** (Future)
    - System for advancing titles.

---

## 📁 Utilities & Modularity

### Utility Modules
- `timeUtils.js` — tick calculations, day/night
- `inventoryUtils.js` — add/remove, check capacity
- `laborUtils.js` — compute labor requirements
- `tileUtils.js` — manage sq. ft, adjacency, taxation
- `economyUtils.js` — wages, prices, inflation
- `transportUtils.js` — delivery speed, courier logic
- `buildingUtils.js` — expansions, upgrades, material costs
- `nameGenerator.js` — Saxon-style name creation
- `eventUtils.js` — random/local event generation
- `logUtils.js` — feed logs, world history entries

---

## 🌎 Data & Persistence
- SQLite database powered by sql.js (in-memory until saved)
- Save/load system:
  - `.sqlite` file downloaded on request
  - Player can load save at startup
- All NPC, household, inventory, map, and event data stored persistently

---

## 🚚 Distribution Plan
- Runs offline in-browser (no backend)
- Delivered as downloadable ZIP
- Save/load from local filesystem
- Future packaging via Electron (modding access)

---

## 📊 Development Roadmap (Phased)

### UI Flow / Main Menu (Complete)
- HTML structure for different screens (Homepage, New Game, Load Game, Settings, Game) in `index.html`.
- Basic screen navigation logic in `main.js`.
- "New Game" screen with First/Last Name, Starting Tool selection, and Randomize Name button.
- Player creation logic updated (`playerEngine.js`) to use new game options.
- Starting tool added to player inventory (`inventoryUtils.js`, `playerEngine.js`).
- Basic "Load Game" file selection and database import logic (`main.js`, `database.js`).

### MVP (Complete)
- Map/tile system (`mapEngine`)
- Player movement & click actions (`movementEngine`)
- SQLite schema (`schema.sql`, `database.js`)
- Save/load system (`saveLoadManager`, FileSaver.js)
- Hunger, thirst, fatigue (`playerEngine`, `survivalEngine`)
- Tool degradation (Future)
- Working construction simulation with visible stages (`constructionEngine`, `buildingEngine`)

### Phase 2 (Mostly Complete)
- Interactable buildings with contextual options (`buildingEngine`, `uiManager`)
- Mount system (`mountData.js`, `playerEngine` integration)
- Labor as build resource (`laborUtils`, `constructionEngine` integration - WIP)
- Economic simulation (basic wages/output in `jobEngine`, `economyUtils`, `skillEngine`)
- Property tax & plot ownership (`taxEngine` - basic structure)

### Phase 3 (In Progress)
- NPC movement (`movementEngine` refactored, basic `npcEngine` integration)
- NPC job simulation (`npcEngine` schedule, `jobEngine` integration)
- NPC Shops (Future)
- Expanded skills and HUD (Basic title display added)
- Reputation system (See Post-MVP Phase 1)
- Roadbuilding (Future)

### Phase 4 (Future)
- Dynamic events (festivals, disasters)
- Family trees, generational data
- Modding system via JSON

### Post-MVP Phase 1 (In Progress)
- Title and nobility system (Basic data, storage, display implemented)
- Tithing system for rank upgrades (Future)
- Implement local and global reputation effects (Future)
- Unlock title-based privileges (Future)

*(See `Roadmap.md` for full Post-MVP plan)*

---

## 🔹 Summary
**The Wyrnlands** delivers a complex, low-overhead simulation game playable directly in the browser with no server or login required. It blends procedural life simulation, dynamic economy, visible world evolution, and RPG-style growth. Every design decision supports long-term modding, extensibility, and offline play. The foundation uses Phaser.js for rendering and sql.js for deep save state control, making it ideal for expansion or multiplayer integration in the future.