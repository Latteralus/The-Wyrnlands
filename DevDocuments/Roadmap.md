**The Wyrnlands — Technical Design Document (Browser-First with SQLite)**

---

## ✨ Project Overview
The Wyrnlands is a medieval life-simulation RPG built for the browser using **Phaser.js** and **SQLite via sql.js**. The game simulates dynamic NPCs, household economies, tile-based construction, travel, social systems, and property ownership. The simulation is entirely local and persistent using an exportable SQLite database.

---

## 🧭 Post-MVP Roadmap

### 🔹 Phase 1: Social Systems & Reputation
- Introduce title and nobility system (Freeman, Knight, Baron, etc.)
- Add tithing system for rank upgrades
- Implement local and global reputation effects
- Unlock title-based privileges (e.g., multiple business ownership, court access)

### 🔹 Phase 2: Justice & Law
- Add crime detection (petty theft, smuggling, assault)
- NPC guards, jailers, and court judges (skill-based occupations)
- Player can work in legal system based on Law skill
- Procedural court events and punishments

### 🔹 Phase 3: Religion & Culture
- Establish temples and clergy professions
- Schedule religious events (festivals, feast days, funerals)
- Faith-based reputation system
- Religious donation/tithing and blessings

### 🔹 Phase 4: Event & Crisis System
- Famine, war, plague, and fire events with local consequences
- Add visual changes to buildings/towns during crises
- Local responses: taxes, militia formation, rationing

### 🔹 Phase 5: NPC Evolution & Depth
- Family trees, inheritance, NPC aging/death
- NPCs form ambitions (own a shop, marry, become judge)
- Rivalries, alliances, local power struggles

### 🔹 Phase 6: Advanced Business Systems
- Contract creation between businesses (supply agreements)
- Guilds with membership fees, pricing standards
- Business specialization paths (e.g., Artisan Blacksmith)
- Marketing, signage, and local customer traffic systems

### 🔹 Phase 7: World Expansion
- Map grows with town prosperity
- Player/NPC-founded hamlets
- Physical roadbuilding and land grading
- Land valuation and zoning rules

### 🔹 Phase 8: Modding and Custom Content
- Expose simulation hooks (onDayStart, onEvent, onBuildComplete)
- External JSONs for buildings, jobs, skills
- Visual mod toggles or theme overrides

---

The post-MVP roadmap aims to deepen the simulation's realism and social dynamics, leading toward a living medieval world with dynamic systems for justice, economy, religion, and NPC behavior — all within the player's control.

