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

---

## 📊 Game Systems

### 1. Time System
- Ratio: 1 real second = 30 game seconds
- Options: 1x / 2x / 4x speed
- Day/Night with sleep overlay
- Sleep always ends at 7:00 AM in-game

### 2. Player HUD
- Bars: Hunger, Thirst, Health, Armor
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
- Local reputation affects job offers and interactions
- Emigration/immigration based on housing/jobs

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
- Wage tied to skill level
- Output scales faster than wage
- Businesses (Owned by NPCs or Players):
  - Have their own bank account
  - Pay wages, taxes, buy supplies
  - Hire managers or staff
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

### MVP
- Map/tile system
- Player movement & click actions
- SQLite schema
- Save/load system
- Hunger, thirst, and tool degradation
- Working construction simulation with visible stages

### Phase 2
- Interactable buildings with contextual options
- Mount system
- Labor as build resource
- Economic simulation (supply chains)
- Property tax & plot ownership

### Phase 3
- NPC movement, job simulation, shops
- Expanded skills and HUD
- Reputation system
- Roadbuilding

### Phase 4
- Dynamic events (festivals, disasters)
- Family trees, generational data
- Modding system via JSON

---

## 🔹 Summary
**The Wyrnlands** delivers a complex, low-overhead simulation game playable directly in the browser with no server or login required. It blends procedural life simulation, dynamic economy, visible world evolution, and RPG-style growth. Every design decision supports long-term modding, extensibility, and offline play. The foundation uses Phaser.js for rendering and sql.js for deep save state control, making it ideal for expansion or multiplayer integration in the future.