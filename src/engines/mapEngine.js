// src/engines/mapEngine.js
// Manages the game world map, tile data, and related logic.
// Import specific database functions instead of getDb
import { run, get, all } from '../data/database.js';
// --- Phaser Integration ---
let phaserScene = null; // Reference to the Phaser scene
let tileGraphicsLayer = null; // Layer for basic tile visuals
let debugOverlayLayer = null; // Layer for walkable/buildable overlay
let debugText = null; // Text object for hover info


console.log("Map Engine Module Loaded");
console.log("Map Engine Module Loaded");

// --- Constants ---
const DEFAULT_MAP_WIDTH = 50; // Example width in tiles
const DEFAULT_MAP_HEIGHT = 50; // Example height in tiles

// --- State ---
let mapTiles = []; // 2D array representing the map grid: mapTiles[y][x]
let mapWidth = DEFAULT_MAP_WIDTH;
let mapHeight = DEFAULT_MAP_HEIGHT;
let isInitialized = false;

// --- Tile Class/Structure (Example) ---
// Represents a single tile on the map
class Tile {
    constructor(x, y, type = 'grass', walkable = true, buildable = true, resource = null) {
        this.x = x;
        this.y = y;
        this.type = type; // e.g., 'grass', 'water', 'forest', 'rock'
        this.walkable = walkable;
        this.buildable = buildable;
        this.resource = resource; // e.g., { type: 'wood', amount: 100 }
        this.buildingId = null; // ID of building occupying this tile
        // Add other properties as needed: elevation, fertility, ownership etc.
    }
}

// --- Initialization ---

/**
 * Initializes the map engine, creating the initial map grid.
 * @param {number} width - Width of the map in tiles.
 * @param {number} height - Height of the map in tiles.
 * @returns {Promise<void>}
 */
async function initializeMap(width = DEFAULT_MAP_WIDTH, height = DEFAULT_MAP_HEIGHT) {
    console.log(`Initializing map with size ${width}x${height}...`);
    mapWidth = width;
    mapHeight = height;
    // mapTiles = []; // Reset map for initialization - REMOVED, rely on assignments below
 
    try {
        // Database functions (run, get, all) are now imported directly
        // No need to get the db instance here if database.js handles initialization implicitly

        // Check if map data exists in the DB
        // Use PRAGMA table_info to be more robust than COUNT(*) if table exists but is empty
        // Use imported 'all' and 'get' functions
        const tableInfo = await all(`PRAGMA table_info(MapTiles)`);
        let tileCount = 0;
        if (tableInfo.length > 0) {
            const countResult = await get('SELECT COUNT(*) as count FROM MapTiles');
            tileCount = countResult?.count || 0;
        } else {
             console.warn("MapTiles table does not exist yet. It will be created by schema execution.");
             // Schema should handle table creation, so we expect 0 count initially.
        }


        if (tileCount > 0 && tileCount === width * height) {
            // Load existing data
            console.log("Loading map data from database...");
            // Ensure column names match schema exactly or use aliases
            const dbTiles = await all('SELECT tile_x as x, tile_y as y, type, is_walkable as walkable, is_buildable as buildable, building_id, resource_type, resource_yield FROM MapTiles');
            // --- Inlined processLoadedTiles logic ---
            console.log(`Processing ${dbTiles.length} tiles loaded from DB...`);
            // Pre-initialize the mapTiles array structure based on dimensions
            // Create a completely new temporary array to populate
            const newMapTiles = [];
            for (let y = 0; y < mapHeight; y++) {
                newMapTiles[y] = new Array(mapWidth).fill(null); // Pre-fill with null
            }

            // Populate the temporary array with loaded data
            dbTiles.forEach(dbTile => {
                if (dbTile.x >= 0 && dbTile.x < mapWidth && dbTile.y >= 0 && dbTile.y < mapHeight) {
                    const resource = dbTile.resource_type ? { type: dbTile.resource_type, amount: dbTile.resource_yield } : null;
                    const loadedTile = new Tile(
                        dbTile.x,
                        dbTile.y,
                        dbTile.type,
                        !!dbTile.walkable,
                        !!dbTile.buildable,
                        resource
                    );
                    loadedTile.buildingId = dbTile.building_id;
                    newMapTiles[dbTile.y][dbTile.x] = loadedTile; // Assign to the temporary array
                } else {
                     console.warn(`Loaded tile data out of bounds: (${dbTile.x}, ${dbTile.y}). Skipping.`);
                }
            });
            // Assign the fully populated temporary array to the module state variable
            mapTiles = newMapTiles;
            // Removed debug log
            // Removed gap-filling loop; assumes loaded data is complete if count matches.
            // If sparse data needs handling later, it should be addressed differently.
            console.log("Finished processing loaded tiles directly in initializeMap.");
            // --- End Inlined Logic ---
        } else if (tileCount === 0) {
            // Generate default map data and save to DB
            console.log("No map data found in DB. Generating default map and saving...");
            mapTiles = await generateAndSaveDefaultMap(width, height); // Pass width/height only
        } else {
            // Handle mismatch case (e.g., partial data)
             console.warn(`Map data count mismatch in DB (${tileCount}) vs expected (${width * height}). Re-generating default map.`);
             await run('DELETE FROM MapTiles'); // Clear partial data
             mapTiles = await generateAndSaveDefaultMap(width, height); // Pass width/height only
        }

        isInitialized = true;
        console.log("Map initialized successfully.");

    } catch (error) {
        console.error("Error initializing map from database:", error);
        // Fallback to default grid on error
        mapTiles = createDefaultGridInMemory(width, height); // Assign returned grid
        isInitialized = true; // Mark as initialized even with fallback
    }
}

/**
 * Helper to create a default grid in memory (used as fallback).
 * @returns {Array<Array<Tile>>} The generated map grid.
 */
function createDefaultGridInMemory(width, height) {
    console.warn("Creating default map grid in memory (DB interaction failed or no data).");
    const generatedMapTiles = []; // Use local variable
    for (let y = 0; y < height; y++) {
        generatedMapTiles[y] = [];
        for (let x = 0; x < width; x++) {
            generatedMapTiles[y][x] = new Tile(x, y); // Default grass tile
        }
    }
    return generatedMapTiles; // Return the generated grid
}

/**
 * Generates a default map grid and saves it to the database using imported run function.
 * @param {number} width
 * @param {number} height
 * @returns {Promise<Array<Array<Tile>>>} The generated map grid.
 */
async function generateAndSaveDefaultMap(width, height) {
    const generatedMapTiles = []; // Use a local variable
    const sql = 'INSERT INTO MapTiles (tile_x, tile_y, type, is_walkable, is_buildable, building_id, resource_yield, resource_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?)';
    const tilesToInsert = [];

    for (let y = 0; y < height; y++) {
        generatedMapTiles[y] = []; // Initialize the row array
        for (let x = 0; x < width; x++) {
            const newTile = new Tile(x, y); // Default grass tile
            generatedMapTiles[y][x] = newTile; // Populate local variable
            // Match the order and types for the prepared statement
            tilesToInsert.push([
                x,
                y,
                newTile.type,
                newTile.walkable ? 1 : 0, // Use 1/0 for BOOLEAN
                newTile.buildable ? 1 : 0, // Use 1/0 for BOOLEAN
                null, // building_id
                null, // resource_yield
                null  // resource_type
            ]);
        }
    }

    // Insert tiles one by one using run (less efficient but simpler without prepare/transaction)
    // TODO: Optimize with a bulk insert function in database.js if performance becomes an issue.
    try {
        for (const tileData of tilesToInsert) {
            await run(sql, tileData); // Use imported run function
        }
        console.log(`Successfully generated and saved ${width * height} default tiles to the database.`);
    } catch (error) {
        console.error("Error saving default map tiles to database:", error);
        // No transaction to rollback here
        throw error; // Re-throw to be caught by initializeMap
    }
    return generatedMapTiles; // Return the generated grid
}

// --- Accessors ---

/**
 * Gets the tile object at the specified coordinates.
 * @param {number} x - X coordinate.
 * @param {number} y - Y coordinate.
 * @returns {Tile | null} The Tile object or null if coordinates are out of bounds.
 */
function getTile(x, y) {
    if (!isInitialized) {
        console.warn("Map Engine not initialized. Call initializeMap() first.");
        return null;
    }
    if (x < 0 || x >= mapWidth || y < 0 || y >= mapHeight) {
        // console.warn(`Coordinates out of bounds: (${x}, ${y})`);
        return null; // Out of bounds
    }
    // Removed debug log
    return mapTiles[y]?.[x]; // Return directly
}

/**
 * Checks if a tile at the given coordinates is walkable.
 * @param {number} x
 * @param {number} y
 * @returns {boolean} True if walkable, false otherwise or if out of bounds.
 */
function isWalkable(x, y) {
    const tile = getTile(x, y);
    return tile ? tile.walkable : false;
}

/**
 * Checks if a tile at the given coordinates is buildable.
 * @param {number} x
 * @param {number} y
 * @returns {boolean} True if buildable, false otherwise or if out of bounds.
 */
function isBuildable(x, y) {
    const tile = getTile(x, y);
    // Also check if a building already exists
    return tile ? (tile.buildable && tile.buildingId === null) : false;
}

/**
 * Gets the width of the map in tiles.
 * @returns {number}
 */
function getMapWidth() {
    return mapWidth;
}

/**
 * Gets the height of the map in tiles.
 * @returns {number}
 */
function getMapHeight() {
    return mapHeight;
}

// --- Modifiers ---

/**
 * Updates the properties of a specific tile both in memory and in the database.
 * @param {number} x
 * @param {number} y
 * @param {object} properties - An object with properties to update (e.g., { walkable: false, type: 'water', buildingId: 5 }).
 * @returns {Promise<boolean>} True if update was successful (both memory and DB), false otherwise.
 */
async function updateTileProperties(x, y, properties) {
    const tile = getTile(x, y);
    if (!tile) {
        console.warn(`Cannot update properties for non-existent tile at (${x}, ${y})`);
        return false;
    }

    // Store original properties in case we need to revert on DB error
    const originalProperties = {};
    for (const key in properties) {
        if (Object.hasOwnProperty.call(properties, key) && Object.hasOwnProperty.call(tile, key)) {
             originalProperties[key] = tile[key];
        }
    }


    // Update in-memory representation first
    Object.assign(tile, properties);
    console.log(`Updated tile (${x}, ${y}) in memory:`, properties);

    // Now, persist to database
    try {
        // Use imported 'run' function directly
        // Assume database.js handles initialization check internally now

        // Build the SET part of the SQL query dynamically
        const updates = [];
        const values = [];
        for (const key in properties) {
            // Ensure the property is directly owned by the properties object
            if (Object.hasOwnProperty.call(properties, key)) {
                // Map JS property names to DB column names
                let dbKey = key;
                let value = properties[key];
                switch (key) {
                    case 'x': // Should not update x, y
                    case 'y':
                        continue; // Skip primary key columns
                    case 'walkable':
                        dbKey = 'is_walkable';
                        value = value ? 1 : 0; // Convert boolean to 1/0
                        break;
                    case 'buildable':
                        dbKey = 'is_buildable';
                        value = value ? 1 : 0; // Convert boolean to 1/0
                        break;
                    case 'buildingId':
                        dbKey = 'building_id';
                        break;
                    case 'resource':
                        // Handle resource object -> separate columns
                        // Ensure resource is not null before accessing properties
                        if (value !== null && typeof value === 'object') {
                            updates.push(`resource_type = ?`);
                            values.push(value.type);
                            updates.push(`resource_yield = ?`);
                            values.push(value.amount);
                        } else {
                             updates.push(`resource_type = ?`);
                             values.push(null);
                             updates.push(`resource_yield = ?`);
                             values.push(null);
                        }
                        continue; // Skip adding resource object directly
                    // Add other mappings if needed (e.g., type -> type)
                    // Default case assumes key matches column name (like 'type')
                    default:
                         // Check if the key corresponds to a valid column in the Tile class/DB schema
                         // This prevents trying to update non-existent columns
                         if (!(key in tile)) {
                              console.warn(`Skipping update for unknown property: ${key}`);
                              continue;
                         }
                         break; // Use the key as dbKey
                }
                // Only add if we didn't handle it in the 'resource' case
                if (key !== 'resource') {
                    updates.push(`${dbKey} = ?`);
                    values.push(value);
                }
            }
        }

        if (updates.length === 0) {
            console.log("No valid properties to update in DB.");
            return true; // Nothing to persist, but memory update succeeded
        }

        values.push(x); // For WHERE tile_x = ?
        values.push(y); // For WHERE tile_y = ?

        const sql = `UPDATE MapTiles SET ${updates.join(', ')} WHERE tile_x = ? AND tile_y = ?`;
        // console.log("Executing SQL:", sql, values); // Debug logging
        const result = await run(sql, values); // Use imported run function

        if (result.changes > 0) {
            console.log(`Successfully persisted update for tile (${x}, ${y}) to DB.`);
            return true;
        } else {
            console.warn(`No rows updated in DB for tile (${x}, ${y}). Tile might not exist in DB?`);
            // Revert in-memory change as DB update failed
            Object.assign(tile, originalProperties);
             console.warn(`Reverted in-memory update for tile (${x}, ${y}) as DB update failed.`);
            return false;
        }

    } catch (error) {
        console.error(`Error persisting tile update for (${x}, ${y}) to database:`, error);
        // Revert the in-memory change on error
        Object.assign(tile, originalProperties);
        console.warn(`Reverted in-memory update for tile (${x}, ${y}) due to DB error.`);
        return false;
    }
}

// Removed processLoadedTiles function as its logic is now inlined in initializeMap
 // --- Phaser Rendering & Interaction ---
 
 /**
  * Creates the visual representation of the map in the provided Phaser scene.
  * Should be called after initializeMap and after the Phaser scene is ready.
  * @param {Phaser.Scene} scene - The Phaser scene to draw the map in.
  * @param {number} tileDrawWidth - The width to draw each tile in pixels.
  * @param {number} tileDrawHeight - The height to draw each tile in pixels.
  */
 function createMapVisuals(scene, tileDrawWidth, tileDrawHeight) {
     if (!isInitialized) {
         console.error("Map Engine not initialized. Cannot create visuals.");
         return;
     }
     if (!scene) {
         console.error("Phaser scene is required to create map visuals.");
         return;
     }
     phaserScene = scene;
 
     // Clear previous graphics if any
     tileGraphicsLayer?.destroy();
     debugOverlayLayer?.destroy();
     debugText?.destroy();
 
     tileGraphicsLayer = scene.add.graphics();
     debugOverlayLayer = scene.add.graphics(); // Separate layer for overlays
 
     // Define placeholder colors
     const colors = {
         grass: 0x228B22, // ForestGreen
         water: 0x1E90FF, // DodgerBlue
         forest: 0x006400, // DarkGreen
         rock: 0x808080,  // Gray
         road: 0x444444,  // Dark Gray for roads
         building: 0x666666, // Medium Gray for buildings
         tree: 0x004d00,  // Darker green for trees
         bush: 0x3cb371,  // MediumSeaGreen for bushes
         default: 0xAAAAAA, // Light Gray for unknown types
     };
     const overlayColors = {
         walkable: 0x00FF00, // Green
         buildable: 0xA52A2A, // Brown
     };
 
     for (let y = 0; y < mapHeight; y++) {
         for (let x = 0; x < mapWidth; x++) {
             const tile = mapTiles[y]?.[x];
             if (tile) {
                 const tileX = x * tileDrawWidth;
                 const tileY = y * tileDrawHeight;
 
                 // Base tile color based on type
                 const baseColor = colors[tile.type] || colors.default;
                 tileGraphicsLayer.fillStyle(baseColor, 1);
                 tileGraphicsLayer.fillRect(tileX, tileY, tileDrawWidth, tileDrawHeight);
 
                 // --- Draw Placeholders ---
                 const placeholderSize = tileDrawWidth / 4; // Size for flora circles
 
                 // Flora: Trees on 'forest' tiles
                 if (tile.type === 'forest') {
                     tileGraphicsLayer.fillStyle(colors.tree, 1);
                     // Draw 2-3 "trees" randomly within the tile
                     for (let i = 0; i < Phaser.Math.Between(2, 3); i++) {
                         const treeX = tileX + Phaser.Math.Between(placeholderSize, tileDrawWidth - placeholderSize);
                         const treeY = tileY + Phaser.Math.Between(placeholderSize, tileDrawHeight - placeholderSize);
                         tileGraphicsLayer.fillCircle(treeX, treeY, placeholderSize);
                     }
                 }
                 // Flora: Bushes occasionally on 'grass' tiles
                 else if (tile.type === 'grass' && Phaser.Math.FloatBetween(0, 1) < 0.1) { // 10% chance
                     tileGraphicsLayer.fillStyle(colors.bush, 1);
                     const bushX = tileX + Phaser.Math.Between(placeholderSize, tileDrawWidth - placeholderSize);
                     const bushY = tileY + Phaser.Math.Between(placeholderSize, tileDrawHeight - placeholderSize);
                     tileGraphicsLayer.fillCircle(bushX, bushY, placeholderSize * 0.8); // Slightly smaller bush
                 }
 
                 // Building Placeholder
                 if (tile.buildingId !== null) {
                     tileGraphicsLayer.fillStyle(colors.building, 1);
                     // Draw a rectangle slightly smaller than the tile
                     const padding = 2;
                     tileGraphicsLayer.fillRect(tileX + padding, tileY + padding, tileDrawWidth - padding * 2, tileDrawHeight - padding * 2);
                 }
                 // --- End Placeholders ---
 
                 // Grid lines (draw after placeholders)
                 tileGraphicsLayer.lineStyle(1, 0x000000, 0.2); // Add a faint grid line
                 tileGraphicsLayer.strokeRect(tileX, tileY, tileDrawWidth, tileDrawHeight);
 
                 // --- Debug Overlay ---
                 const indicatorSize = tileDrawWidth / 5;
                 // Walkable indicator (top-left)
                 if (tile.walkable) {
                     debugOverlayLayer.fillStyle(overlayColors.walkable, 0.6); // Semi-transparent
                     debugOverlayLayer.fillRect(tileX + 1, tileY + 1, indicatorSize, indicatorSize);
                 }
                 // Buildable indicator (top-right, only if empty)
                 if (tile.buildable && tile.buildingId === null) {
                      debugOverlayLayer.fillStyle(overlayColors.buildable, 0.6); // Semi-transparent
                      debugOverlayLayer.fillRect(tileX + tileDrawWidth - indicatorSize - 1, tileY + 1, indicatorSize, indicatorSize);
                 }
                 // Removed the red 'X' for occupied tiles as building placeholder is now drawn
             }
         }
     }
 
     // Debug text for hover info
     debugText = scene.add.text(10, 10, 'Tile Info: Hover over map', {
         font: '12px Arial',
         fill: '#ffffff',
         backgroundColor: '#000000aa'
     }).setScrollFactor(0).setDepth(100); // Keep text fixed on screen, above map
 
     // Input handler for hover
     scene.input.on('pointermove', (pointer) => {
         const worldX = pointer.worldX;
         const worldY = pointer.worldY;
         const tileX = Math.floor(worldX / tileDrawWidth);
         const tileY = Math.floor(worldY / tileDrawHeight);
         const currentTile = getTile(tileX, tileY);
 
         if (currentTile) {
             debugText.setText(`Tile: (${currentTile.x}, ${currentTile.y}) Type: ${currentTile.type} Walk: ${currentTile.walkable} Build: ${currentTile.buildable} BldgID: ${currentTile.buildingId}`);
         } else {
             debugText.setText('Tile Info: Off map');
         }
     });
 
     console.log("Map visuals created.");
 }
 

/**
 * Resets the map engine state for testing purposes.
 * WARNING: Do not call this in production code.
 */
function _resetState() {
    mapTiles = [];
    mapWidth = DEFAULT_MAP_WIDTH;
    mapHeight = DEFAULT_MAP_HEIGHT;
    isInitialized = false;
    // console.log("DEBUG: Map engine state reset."); // Removed debug log
    phaserScene = null;
    tileGraphicsLayer?.destroy();
    debugOverlayLayer?.destroy();
    debugText?.destroy();
}

// --- Exports ---
export {
    initializeMap,
    getTile,
    isWalkable,
    isBuildable,
    getMapWidth,
    getMapHeight,
    updateTileProperties,
    createMapVisuals,
    _resetState, // Export for testing only
};