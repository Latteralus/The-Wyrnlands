// src/engines/buildingEngine.js
// Manages buildings in the game world.

import { getTile, isBuildable, updateTileProperties } from './mapEngine.js'; // Use relative path
import { getPlayerAttribute } from './playerEngine.js'; // Use relative path
import { startSleep } from './timeEngine.js'; // Use relative path
// TODO: Integrate with database (src/data/database.js) to load/save Buildings table

console.log("Building Engine Module Loaded");

// --- State ---
// Store buildings in memory for now. Keyed by a unique building ID.
// Later, this would be populated from/synced with the database.
const buildings = {};
let nextBuildingId = 1; // Simple ID generation for now
let isInitialized = false;

// --- Building Class/Structure (Example) ---
class Building {
    constructor(id, type, x, y, width, height, ownerId, sqFt, roomCount, taxRate) {
        this.id = id;
        this.type = type; // e.g., 'house', 'farm', 'workshop'
        this.x = x; // Top-left tile X
        this.y = y; // Top-left tile Y
        this.width = width; // Width in tiles
        this.height = height; // Height in tiles
        this.ownerId = ownerId; // ID of the player or household owning the building
        this.sqFt = sqFt;
        this.roomCount = roomCount;
        this.taxRate = taxRate; // Example: could be calculated based on sqFt/location
        // Add other properties: condition, storage, employees, etc.
    }
}


// --- Initialization ---

/**
 * Initializes the building engine.
 * TODO: Load existing buildings from the database.
 * @returns {Promise<void>}
 */
async function initializeBuildingEngine() {
    console.log("Initializing Building Engine...");
    // Clear existing in-memory buildings
    Object.keys(buildings).forEach(key => delete buildings[key]);
    nextBuildingId = 1; // Reset ID counter

    // TODO: Load buildings from DB
    // const dbBuildings = await db.all('SELECT * FROM Buildings');
    // dbBuildings.forEach(b => {
    //     buildings[b.id] = new Building(b.id, b.type, b.x, b.y, b.width, b.height, b.owner_id, b.sq_ft, b.room_count, b.tax_rate);
    //     // Ensure map tiles occupied by loaded buildings are updated
    //     for (let i = 0; i < b.width; i++) {
    //         for (let j = 0; j < b.height; j++) {
    //             updateTileProperties(b.x + i, b.y + j, { buildingId: b.id, buildable: false, walkable: false }); // Buildings usually not walkable
    //         }
    //     }
    //     if (b.id >= nextBuildingId) nextBuildingId = b.id + 1;
    // });

    isInitialized = true;
    console.log("Building Engine Initialized.");
}

// --- Core Functions ---

/**
 * Attempts to place a new building on the map.
 * Checks if the target tiles are buildable and updates map/building state.
 * @param {number} x - Top-left X coordinate for the building.
 * @param {number} y - Top-left Y coordinate for the building.
 * @param {number} width - Width of the building in tiles.
 * @param {number} height - Height of the building in tiles.
 * @param {string} type - Type of building (e.g., 'house').
 * @param {string | number} ownerId - ID of the owner.
 * @param {number} sqFt - Square footage.
 * @param {number} roomCount - Number of rooms.
 * @param {number} taxRate - Tax rate.
 * @returns {Building | null} The created Building object or null if placement failed.
 */
function placeBuilding(x, y, width, height, type, ownerId, sqFt, roomCount, taxRate) {
    if (!isInitialized) {
        console.error("Building Engine not initialized.");
        return null;
    }

    console.log(`Attempting to place ${type} of size ${width}x${height} at (${x}, ${y})`);

    // 1. Check if all required tiles are buildable
    for (let i = 0; i < width; i++) {
        for (let j = 0; j < height; j++) {
            const tileX = x + i;
            const tileY = y + j;
            if (!isBuildable(tileX, tileY)) {
                console.error(`Placement failed: Tile (${tileX}, ${tileY}) is not buildable.`);
                return null; // Placement fails if any tile is not buildable
            }
        }
    }

    // 2. Create Building Object
    const newBuildingId = `building_${nextBuildingId++}`; // Generate unique ID
    const newBuilding = new Building(newBuildingId, type, x, y, width, height, ownerId, sqFt, roomCount, taxRate);
    buildings[newBuildingId] = newBuilding;

    // 3. Update Map Tiles
    for (let i = 0; i < width; i++) {
        for (let j = 0; j < height; j++) {
            updateTileProperties(x + i, y + j, {
                buildingId: newBuildingId,
                buildable: false,
                walkable: false // Typically buildings block walkability
            });
        }
    }

    // 4. TODO: Persist building to database
    // await db.run('INSERT INTO Buildings (...) VALUES (...)', [...values]);

    console.log(`Successfully placed ${type} [${newBuildingId}] at (${x}, ${y})`);
    return newBuilding;
}

/**
 * Removes a building from the map and updates tiles.
 * @param {string} buildingId - The ID of the building to remove.
 * @returns {boolean} True if removal was successful, false otherwise.
 */
function removeBuilding(buildingId) {
     if (!isInitialized) {
        console.error("Building Engine not initialized.");
        return false;
    }
    const building = buildings[buildingId];
    if (!building) {
        console.warn(`Building with ID ${buildingId} not found for removal.`);
        return false;
    }

    console.log(`Removing building ${building.type} [${buildingId}] from (${building.x}, ${building.y})`);

    // 1. Update Map Tiles (make them buildable/walkable again, remove buildingId)
     for (let i = 0; i < building.width; i++) {
        for (let j = 0; j < building.height; j++) {
            // Check if tile still exists (might not if map changed?) - unlikely here
            const tile = getTile(building.x + i, building.y + j);
            if (tile && tile.buildingId === buildingId) {
                 updateTileProperties(building.x + i, building.y + j, {
                    buildingId: null,
                    buildable: true, // Assuming default is buildable
                    walkable: true  // Assuming default is walkable
                });
            }
        }
    }

    // 2. Remove from in-memory store
    delete buildings[buildingId];

    // 3. TODO: Remove building from database
    // await db.run('DELETE FROM Buildings WHERE id = ?', [buildingId]);

    console.log(`Building ${buildingId} removed successfully.`);
    return true;
}

/**
 * Gets a building by its ID.
 * @param {string} buildingId
 * @returns {Building | null}
 */
function getBuildingById(buildingId) {
     if (!isInitialized) {
        console.warn("Building Engine not initialized.");
        return null;
    }
    return buildings[buildingId] || null;
}
 /**
  * Determines the available interactions for a given building.
  * (Placeholder - needs more sophisticated logic based on building type, state, player skills, etc.)
  * @param {string} buildingId - The ID of the building.
  * @param {number} tileX - The X coordinate of the interaction tile.
  * @param {number} tileY - The Y coordinate of the interaction tile.
  * @returns {Promise<Array<object>>} A promise resolving to an array of interaction objects { label: string, action: function }.
  */
 async function getBuildingInteractions(buildingId, tileX, tileY) {
     const building = getBuildingById(buildingId);
     if (!building) {
         return []; // No building, no interactions
     }
 
     const playerId = getPlayerAttribute('id'); // Get current player's ID
     const isOwner = building.ownerId === playerId; // Check if the player owns this building
 
     const interactions = [];
 
     // Common interaction
     interactions.push({
         label: `Inspect ${building.type}`,
         action: () => console.log(`Inspecting ${building.type} [${buildingId}] - Owner: ${building.ownerId}, SqFt: ${building.sqFt}`)
     });
 
     // Type-specific interactions
     switch (building.type) {
         case 'house':
             interactions.push({
                 label: `Enter House`,
                 action: () => console.log(`Entering house [${buildingId}]`)
             });
             if (isOwner) {
                 interactions.push({
                     label: `Rest`,
                     action: () => {
                         console.log(`Initiating Rest in own house [${buildingId}]`);
                         startSleep(); // Call timeEngine function
                     }
                 });
                 interactions.push({
                     label: `Manage Household`,
                     action: () => console.log(`Managing household for house [${buildingId}]`) // TODO: Link to household management UI/logic
                 });
             } else {
                 interactions.push({
                     label: `Knock on Door`,
                     action: () => console.log(`Knocking on door of house [${buildingId}]`) // TODO: Trigger NPC interaction if occupied
                 });
             }
             break;
         case 'farm':
             interactions.push({
                 label: `Work Farm`,
                 action: () => console.log(`Working farm [${buildingId}]`) // TODO: Link to job/skill logic
             });
             if (isOwner) {
                 interactions.push({
                     label: `Manage Farm`,
                     action: () => console.log(`Managing farm [${buildingId}]`)
                 });
             }
             break;
         case 'workshop':
             interactions.push({
                 label: `Use Workshop`,
                 action: () => console.log(`Using workshop [${buildingId}]`) // TODO: Link to crafting/skill logic
             });
             if (isOwner) {
                 interactions.push({
                     label: `Manage Workshop`,
                     action: () => console.log(`Managing workshop [${buildingId}]`)
                 });
             }
             break;
         // Add cases for other building types...
         default:
             console.warn(`No specific interactions defined for building type: ${building.type}`);
             // Add a generic 'Enter' if applicable?
             interactions.push({
                 label: `Enter ${building.type}`,
                 action: () => console.log(`Entering generic building [${buildingId}]`)
             });
     }
 
     // TODO: Add interactions based on player skills (e.g., 'Repair' if carpentry skill > X)
     // TODO: Add interactions based on items held (e.g., 'Unlock' if holding key)
 
     return interactions;
 }
 
 /**
  * Adds a building directly to the internal state for testing.
  * WARNING: Do not call this in production code.
  * @param {Building} building - The building object to add.
  */
 function _addBuildingForTest(building) {
     if (building && building.id) {
         buildings[building.id] = building;
         // Ensure nextBuildingId is updated if needed, simple approach:
         const idNum = parseInt(building.id.split('_')[1]);
         if (!isNaN(idNum) && idNum >= nextBuildingId) {
             nextBuildingId = idNum + 1;
         }
     }
 }
 

// --- Exports ---
export {
    initializeBuildingEngine,
    placeBuilding,
    removeBuilding,
    getBuildingById,
    getBuildingInteractions, // Export new function
    // Building class might be useful if constructing externally
    Building,
    _addBuildingForTest, // Export for testing
};