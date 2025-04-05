**The Wyrnlands — Technical Design Document (Browser-First with SQLite)**

---

## ✨ Project Overview
The Wyrnlands is a medieval life-simulation RPG built for the browser using **Phaser.js** and **SQLite via sql.js**. The game simulates dynamic NPCs, household economies, tile-based construction, travel, social systems, and property ownership. The simulation is entirely local and persistent using an exportable SQLite database.

---

## ✅ MVP Step-by-Step Checklist
Each step below outlines required functionality, associated files, and mandates that a **unit test be created immediately** after file implementation. Each test must be logged in `testtracker.md`.

---

### 🧱 Phase 1: Project Setup
1. ✅ Initialize Phaser + SQLite Project
   - Set up `index.html`, `main.js`, `phaserGame.js`
   - Add `sql.js`, `FileSaver.js`
   - Test: Basic Phaser canvas renders
   - Log test in `testtracker.md`

2. ✅ Create `db/initDatabase.js`
   - Schema: Player, Buildings, MapTiles, NPCs, Households, Inventory
   - Unit test: Confirm tables created successfully
   - Log test

3. ✅ Create save/load system (`saveManager.js`)
   - Export `.sqlite` file
   - Load file with FileReader
   - Unit test: Save file integrity, reload checks
   - Log test

---

### 🌄 Phase 2: Core World & Player
4. ✅ Create tile/grid map system (`mapEngine.js`)
   - Load grid into Phaser
   - Mark tiles as walkable or buildable
   - Test: Walkable tiles render
   - Log test

5. ✅ Create `player.js` class
   - Attributes: Name, hunger, thirst, skill levels
   - Unit test: Constructor integrity, getter/setter tests
   - Log test

6. ✅ Create movement handler (`movementEngine.js`)
   - Click-to-move logic, tile validation
   - Unit test: Tile change updates player position
   - Log test

7. ✅ Implement hunger/thirst system (`survivalEngine.js`)
   - Daily tick reduces values, death if zero
   - Unit test: Ticking changes values correctly
   - Log test

---

### 🏠 Phase 3: Housing & Inventory
8. ✅ Implement `buildingEngine.js`
   - Add buildings to tiles with ID and sq. ft.
   - Store owner ID, rooms, taxes
   - Unit test: Add/remove buildings correctly
   - Log test

9. ✅ Create inventory system (`inventoryUtils.js`)
   - Add/remove items to household or player
   - Unit test: Track item count across scopes
   - Log test

10. ✅ Create tax handler (`taxEngine.js`)
   - Apply taxes per tile monthly
   - Repossess if unpaid
   - Unit test: Tax threshold triggers repossession
   - Log test

---

### 🧑‍🌾 Phase 4: Skills & Work
11. ✅ Create `skillEngine.js`
   - Track and level skills (e.g., Carpentry, Farming)
   - Calculate wage output ratio
   - Unit test: Level changes production correctly
   - Log test

12. ✅ Create job engine (`jobEngine.js`)
   - Assign job to NPC or player
   - Pay daily wages, route output to business or player
   - Unit test: Wage + output logic integrity
   - Log test

13. ✅ Create NPC simulation engine (`npcEngine.js`)
   - NPCs follow schedules: Work → Eat → Sleep
   - Unit test: NPC behavior consistent with state
   - Log test

---

### 🔨 Phase 5: Construction & Labor
14. ✅ Add construction system (`constructionEngine.js`)
   - Require material + labor inputs over time
   - Multi-tile building support
   - Unit test: Building progresses only with full inputs
   - Log test

15. ✅ Add labor tracking (`laborUtils.js`)
   - Types: General, Masonry, Carpentry
   - Test: Labor used & removed after build step
   - Log test

---

### 🧪 Finalization
16. ✅ Create `timeEngine.js`
   - Tick every X ms, update date/time
   - Sleep = fast-forward
   - Unit test: Ticking updates time correctly
   - Log test

17. ✅ Create basic UI overlay (`uiManager.js`)
   - Display hunger, thirst, selected tile info
   - Unit test: Bar updates with stat change
   - Log test

18. ✅ Final Integration Test
   - Simulate 7 in-game days
   - Ensure no crash, simulate: work, eat, sleep
   - Log test results in `testtracker.md`

---

## 📌 Reminder
After each major file:
- ✅ Write and run unit tests
- ✍️ Log the test in `testtracker.md`
- 💾 Confirm state is correctly saved and restored

---

This checklist ensures thorough validation of all core systems, from data models to simulation logic. Once complete, the MVP will support character survival, movement, buildings, skills, wages, and world persistence.

