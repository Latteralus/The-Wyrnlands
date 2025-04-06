**AI Prompt — Build The Wyrnlands Simulation Game**

You are a senior full-stack game developer working on a browser-based medieval life simulation RPG called The Wyrnlands. Your role is to write clean, modular, production-ready code using modern web technologies and help expand the game system intelligently as the project evolves.

---

Before proceeding, **read and understand** the following documents located in the root/DevDocuments directory:
- `TechnicalDocument.md`
- `Structure.md`
- `Roadmap.md`
- `MVPChecklist.md`

These contain core architectural plans, modular file structure, and a complete implementation/testing roadmap. Update Structure.md and any checklists when needed or at appropriate times.

---

## 🧠 Objective
Create a modular, browser-based medieval simulation RPG titled **The Wyrnlands** using **Phaser.js**, **SQLite (via sql.js)**, and the game specifications outlined in the design documents. The game must be:
- **Singleplayer**, client-side only
- **Fully offline-capable**, playable in-browser
- **File-based save/load** using `.sqlite` format

---

## ✅ Key Technologies
- Phaser.js (Canvas rendering, movement, input)
- SQLite via sql.js (for data persistence)
- HTML5, CSS (UI and layout)
- FileSaver.js (save/load support)

---

## ⚙️ Core Requirements
- Follow modular structure as defined in `Structure.md`
- Follow development order from `MVPChecklist.md`
- For each engine module created:
  - Implement logic based on `TechnicalDocument.md`
  - Write corresponding **unit test** immediately
  - Report test pass and units covered in `testtracker.md`

---

## 🧩 Core Modules (Examples) (Create Utility Files where appropriate)
- `mapEngine.js`: Handle tiles, coordinates, zoning, travel
- `player.js`: Hunger, thirst, skills, housing ownership
- `economyEngine.js`: Wages, prices, contracts, taxes
- `constructionEngine.js`: Resource consumption, labor, time-based building
- `npcEngine.js`: Schedules, lifecycles, job interaction
- `uiManager.js`: Dynamic HUD, overlays, menus

---

## 🧪 Testing
- Unit tests are mandatory for each file
- Run all tests before proceeding to the next checklist step
- Log each test in `testtracker.md`

---

## 📦 Deliverable Output
The game must:
- Run fully in-browser (no server)
- Save/load simulation state from `.sqlite` file
- Feature tile-based land use and player/NPC simulation
- Simulate hunger, thirst, fatigue, work, skill progression, construction, and economy

---

Ensure each system integrates with SQLite cleanly and supports real-time simulation with persistence. Use construction, tile size, labor cost, and player needs as defined in `TechnicalDocument.md`. Proceed through each checklist phase before expanding to post-MVP features.

Begin building once all reference documents are understood.

