-- The Wyrnlands - Initial Database Schema (MVP)

-- Player Table
CREATE TABLE IF NOT EXISTS Player (
    player_id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL DEFAULT 'Adventurer', -- First name
    surname TEXT, -- Last name (optional)
    gender TEXT DEFAULT 'unknown', -- Added gender
    hunger REAL NOT NULL DEFAULT 100.0,
    thirst REAL NOT NULL DEFAULT 100.0,
    health REAL NOT NULL DEFAULT 100.0,
    armor REAL NOT NULL DEFAULT 0.0,
    current_tile_x INTEGER NOT NULL DEFAULT 0,
    current_tile_y INTEGER NOT NULL DEFAULT 0,
    household_id INTEGER, -- Link to the player's household
    current_mount_id TEXT, -- ID of the currently equipped mount (e.g., 'horse'), NULL if none
    title_id TEXT NOT NULL DEFAULT 'commoner', -- Link to titlesData.js id
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (household_id) REFERENCES Households(household_id)
    -- Note: No foreign key for mount_id as mount data is likely in JS/JSON, not a separate SQL table
);

-- Households Table (Groups of NPCs/Player sharing resources)
CREATE TABLE IF NOT EXISTS Households (
    household_id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT, -- e.g., "Smith Family", "Player Household"
    funds INTEGER NOT NULL DEFAULT 50, -- Starting money
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- NPCs Table
CREATE TABLE IF NOT EXISTS NPCs (
    npc_id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    age INTEGER NOT NULL DEFAULT 25,
    household_id INTEGER,
    current_tile_x INTEGER,
    current_tile_y INTEGER,
    current_activity TEXT DEFAULT 'Idle', -- e.g., Idle, Working, Sleeping, Shopping
    schedule TEXT, -- JSON or delimited string for schedule
    hunger REAL NOT NULL DEFAULT 100.0,
    thirst REAL NOT NULL DEFAULT 100.0,
    health REAL NOT NULL DEFAULT 100.0,
    title_id TEXT NOT NULL DEFAULT 'commoner', -- Link to titlesData.js id
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (household_id) REFERENCES Households(household_id)
);

-- Map Tiles Table
CREATE TABLE IF NOT EXISTS MapTiles (
    tile_x INTEGER NOT NULL,
    tile_y INTEGER NOT NULL,
    type TEXT NOT NULL DEFAULT 'Grass', -- e.g., Grass, Forest, Water, Road, Quarry
    is_walkable BOOLEAN NOT NULL DEFAULT 1,
    is_buildable BOOLEAN NOT NULL DEFAULT 1,
    building_id INTEGER, -- Link to a building occupying this tile
    resource_yield REAL, -- e.g., Wood yield for Forest
    resource_type TEXT, -- e.g., Wood, Stone, Water
    PRIMARY KEY (tile_x, tile_y),
    FOREIGN KEY (building_id) REFERENCES Buildings(building_id)
);

-- Buildings Table
CREATE TABLE IF NOT EXISTS Buildings (
    building_id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL, -- e.g., House, Farm, Workshop, QuarryShed
    name TEXT, -- Optional custom name
    owner_household_id INTEGER, -- Household that owns this building
    occupying_tile_x INTEGER NOT NULL, -- Primary tile (for multi-tile buildings)
    occupying_tile_y INTEGER NOT NULL,
    width_tiles INTEGER NOT NULL DEFAULT 1, -- How many tiles wide
    height_tiles INTEGER NOT NULL DEFAULT 1, -- How many tiles high
    square_footage INTEGER NOT NULL DEFAULT 500, -- Based on tile size * count
    room_count INTEGER NOT NULL DEFAULT 1,
    construction_stage INTEGER DEFAULT 0, -- 0=Planned, 1=Foundation, ..., N=Complete
    max_construction_stage INTEGER DEFAULT 5,
    materials_needed TEXT, -- JSON: {"Wood": 10, "Stone": 5} for next stage
    labor_needed TEXT, -- JSON: {"General": 20, "Carpentry": 10} for next stage
    current_materials TEXT DEFAULT '{}', -- JSON: Materials applied so far
    current_labor TEXT DEFAULT '{}', -- JSON: Labor applied so far
    tax_due REAL DEFAULT 0.0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (owner_household_id) REFERENCES Households(household_id)
    -- Note: Need a way to link multiple tiles for multi-tile buildings, maybe a separate table or store in MapTiles?
    -- For MVP, assume single tile buildings or use width/height from primary tile.
);

-- Inventory Table (Items held by Households or potentially Buildings)
CREATE TABLE IF NOT EXISTS Inventory (
    inventory_id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id INTEGER, -- OR item belongs directly to the player
    household_id INTEGER, -- OR item belongs to this household
    building_id INTEGER, -- OR item is stored in this building (e.g., workshop output)
    item_type TEXT NOT NULL, -- e.g., Wood, Stone, Bread, Axe
    quantity INTEGER NOT NULL DEFAULT 1,
    condition REAL DEFAULT 100.0, -- For tools/equipment
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (player_id) REFERENCES Player(player_id),
    FOREIGN KEY (household_id) REFERENCES Households(household_id),
    FOREIGN KEY (building_id) REFERENCES Buildings(building_id),
    CHECK ( (player_id IS NOT NULL AND household_id IS NULL AND building_id IS NULL) OR
            (player_id IS NULL AND household_id IS NOT NULL AND building_id IS NULL) OR
            (player_id IS NULL AND household_id IS NULL AND building_id IS NOT NULL) ) -- Must belong to exactly one owner type
);

-- Skills Table (Could be linked to Player or NPCs)
CREATE TABLE IF NOT EXISTS Skills (
    skill_id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_id INTEGER NOT NULL, -- Could be player_id or npc_id
    owner_type TEXT NOT NULL, -- 'Player' or 'NPC'
    skill_name TEXT NOT NULL, -- e.g., Farming, Carpentry, Masonry, Mining
    level INTEGER NOT NULL DEFAULT 1,
    experience REAL NOT NULL DEFAULT 0.0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(owner_id, owner_type, skill_name) -- Ensure each entity has only one entry per skill
);

-- Add basic triggers for updated_at timestamps
CREATE TRIGGER IF NOT EXISTS update_player_timestamp AFTER UPDATE ON Player
BEGIN
    UPDATE Player SET updated_at = CURRENT_TIMESTAMP WHERE player_id = old.player_id;
END;

CREATE TRIGGER IF NOT EXISTS update_npc_timestamp AFTER UPDATE ON NPCs
BEGIN
    UPDATE NPCs SET updated_at = CURRENT_TIMESTAMP WHERE npc_id = old.npc_id;
END;

CREATE TRIGGER IF NOT EXISTS update_building_timestamp AFTER UPDATE ON Buildings
BEGIN
    UPDATE Buildings SET updated_at = CURRENT_TIMESTAMP WHERE building_id = old.building_id;
END;

CREATE TRIGGER IF NOT EXISTS update_inventory_timestamp AFTER UPDATE ON Inventory
BEGIN
    UPDATE Inventory SET updated_at = CURRENT_TIMESTAMP WHERE inventory_id = old.inventory_id;
END;

CREATE TRIGGER IF NOT EXISTS update_skill_timestamp AFTER UPDATE ON Skills
BEGIN
    UPDATE Skills SET updated_at = CURRENT_TIMESTAMP WHERE skill_id = old.skill_id;
END;

-- Initial Data (Optional, can be added via code later)
-- INSERT INTO Households (name, funds) VALUES ('Player Household', 100);
-- INSERT INTO Player (name, household_id, current_tile_x, current_tile_y) VALUES ('Hero', 1, 5, 5);

PRAGMA journal_mode = WAL; -- Optional: Write-Ahead Logging for potentially better concurrency if needed later
PRAGMA foreign_keys = ON; -- Enforce foreign key constraints