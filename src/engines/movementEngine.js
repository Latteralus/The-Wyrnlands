// src/engines/movementEngine.js
// Handles player movement logic based on map data and input.

import { getTile } from './mapEngine.js';
import { getPlayerState, updatePlayerAttributes } from './playerEngine.js';
import { getNpcState, updateNpcAttributes } from './npcEngine.js'; // Import NPC functions
// TODO: Import survivalEngine functions if movement costs stamina

console.log("Movement Engine Module Loaded");

// --- State ---
let phaserScene = null; // Reference to the Phaser scene for input and visuals
let playerSprite = null; // Reference to the player's visual representation
let npcSprites = {}; // Map of npcId -> sprite { npcId: Phaser.GameObjects.Sprite }
let isInitialized = false;
let TILE_WIDTH = 32; // Default, should be passed during init
let TILE_HEIGHT = 32; // Default, should be passed during init

// --- Initialization ---

/**
 * Initializes the movement engine.
 * @param {Phaser.Scene} scene - The Phaser scene instance.
 * @param {Phaser.GameObjects.Sprite} sprite - The player's sprite.
 * @param {number} tileWidth - Width of tiles in pixels.
 * @param {number} tileHeight - Height of tiles in pixels.
 */
function initializeMovement(scene, playerSpriteRef, tileWidth, tileHeight) {
    if (!scene || !playerSpriteRef) {
        console.error("Movement Engine requires a Phaser scene and player sprite reference to initialize.");
        return;
    }
    phaserScene = scene;
    playerSprite = playerSpriteRef; // Store the player sprite
    npcSprites = {}; // Reset NPC sprites map
    TILE_WIDTH = tileWidth;
    TILE_HEIGHT = tileHeight;

    // --- Input Handling ---
    // Remove previous listener if re-initializing
    phaserScene.input.off('pointerdown', handleMapClick);
    // Add listener for pointer down (click/tap)
    phaserScene.input.on('pointerdown', handleMapClick);

    isInitialized = true;
    console.log("Movement Engine Initialized");
}

// --- NPC Sprite Management ---

/**
 * Registers a sprite for a specific NPC.
 * @param {number} npcId
 * @param {Phaser.GameObjects.Sprite} sprite
 */
function registerNpcSprite(npcId, sprite) {
    if (!phaserScene) {
        console.warn("Movement Engine not initialized, cannot register NPC sprite.");
        return;
    }
    npcSprites[npcId] = sprite;
    console.log(`Registered sprite for NPC ${npcId}`);
}

/**
 * Unregisters the sprite for an NPC (e.g., when they die or leave the area).
 * @param {number} npcId
 */
function unregisterNpcSprite(npcId) {
    if (npcSprites[npcId]) {
        // Optionally destroy the sprite here, or let the scene handle it
        // npcSprites[npcId].destroy();
        delete npcSprites[npcId];
        console.log(`Unregistered sprite for NPC ${npcId}`);
    }
}


// --- Event Handlers ---

/**
 * Handles clicks on the map.
 * @param {Phaser.Input.Pointer} pointer - The pointer event object.
 */
function handleMapClick(pointer) {
    if (!isInitialized) return;

    const worldX = pointer.worldX;
    const worldY = pointer.worldY;

    // Convert pixel coordinates to tile coordinates
    const targetTileX = Math.floor(worldX / TILE_WIDTH);
    const targetTileY = Math.floor(worldY / TILE_HEIGHT);

    console.log(`Map clicked at pixel (${worldX.toFixed(0)}, ${worldY.toFixed(0)}), targeting tile (${targetTileX}, ${targetTileY})`);

    // Attempt to move the player to the clicked tile
    movePlayerTo(targetTileX, targetTileY);
}

// --- Core Logic ---

/**
 * Internal function to handle moving an entity (Player or NPC).
 * @param {string} entityType - 'Player' or 'NPC'.
 * @param {number|null} entityId - The ID (null for Player).
 * @param {object} entityState - The current state object (from playerEngine or npcEngine).
 * @param {function} updateAttributesFn - The function to call to update attributes (updatePlayerAttributes or updateNpcAttributes).
 * @param {Phaser.GameObjects.Sprite} entitySprite - The visual sprite for the entity.
 * @param {number} targetX - The target tile X coordinate.
 * @param {number} targetY - The target tile Y coordinate.
 * @returns {Promise<boolean>} True if movement was successful, false otherwise.
 */
async function _moveEntityTo(entityType, entityId, entityState, updateAttributesFn, entitySprite, targetX, targetY) {
    const logPrefix = `${entityType}${entityId ? ` ${entityId}` : ''}:`; // e.g., "Player:", "NPC 12:"

    if (!isInitialized) {
        console.warn(`${logPrefix} Movement Engine not initialized.`);
        return false;
    }
    if (!entityState) {
        console.warn(`${logPrefix} Entity state not available.`);
        return false;
    }

    // 1. Check if the target tile is valid and walkable
    const targetTile = getTile(targetX, targetY);
    if (!targetTile) {
        console.log(`${logPrefix} Movement failed: Target tile (${targetX}, ${targetY}) is out of bounds or invalid.`);
        return false;
    }
    if (!targetTile.walkable) {
        console.log(`${logPrefix} Movement failed: Target tile (${targetX}, ${targetY}) is not walkable.`);
        return false;
    }

    // 2. Check if the target is the same as the current tile
    if (entityState.x === targetX && entityState.y === targetY) {
        // console.log(`${logPrefix} Movement ignored: Already at the target tile.`); // Less noisy
        return false; // No movement needed
    }

    // 3. TODO: Implement pathfinding if needed. For now, direct movement.

    // 4. TODO: Check movement cost (stamina/fatigue). Needs entity state to have stamina.
    // const moveCost = calculateMovementCost(entityState.x, entityState.y, targetX, targetY);
    // if (entityState.stamina < moveCost) { ... return false; }
    // updatesToPersist.stamina = entityState.stamina - moveCost;

    // 5. Update entity state (in memory and DB)
    console.log(`${logPrefix} Moving from (${entityState.x}, ${entityState.y}) to (${targetX}, ${targetY})...`);
    const updatesToPersist = { x: targetX, y: targetY };
    // Add stamina update here if implemented: updatesToPersist.stamina = ...

    // Call the appropriate update function
    const updateSuccess = entityType === 'Player'
        ? await updateAttributesFn(updatesToPersist) // updatePlayerAttributes takes one arg
        : await updateAttributesFn(entityId, updatesToPersist); // updateNpcAttributes takes two args

    if (updateSuccess) {
        // 6. Update visual representation (sprite position)
        if (phaserScene && entitySprite) {
            phaserScene.tweens.add({
                targets: entitySprite,
                x: targetX * TILE_WIDTH + TILE_WIDTH / 2, // Center sprite in tile
                y: targetY * TILE_HEIGHT + TILE_HEIGHT / 2, // Center sprite in tile
                duration: 200, // Duration of the movement in ms (TODO: make speed variable?)
                ease: 'Linear'
            });
        } else {
             console.warn(`${logPrefix} Phaser scene or entity sprite not available for visual update.`);
        }

        // 7. Log the movement event
        console.log(`${logPrefix} Moved to (${targetX}, ${targetY})`);

        return true;
    } else {
        console.error(`${logPrefix} Movement failed: Could not update entity attributes in database.`);
        // State should be reverted by the attribute update function on failure.
        return false;
    }
}


/**
 * Attempts to move the player to the target tile coordinates. Wrapper for _moveEntityTo.
 * @param {number} targetX - The target tile X coordinate.
 * @param {number} targetY - The target tile Y coordinate.
 * @returns {Promise<boolean>} True if movement was successful, false otherwise.
 */
async function movePlayerTo(targetX, targetY) {
    const playerState = getPlayerState();
    return _moveEntityTo('Player', null, playerState, updatePlayerAttributes, playerSprite, targetX, targetY);
}

/**
 * Attempts to move a specific NPC to the target tile coordinates. Wrapper for _moveEntityTo.
 * @param {number} npcId - The ID of the NPC to move.
 * @param {number} targetX - The target tile X coordinate.
 * @param {number} targetY - The target tile Y coordinate.
 * @returns {Promise<boolean>} True if movement was successful, false otherwise.
 */
async function moveNpcTo(npcId, targetX, targetY) {
    const npcState = getNpcState(npcId);
    const npcSprite = npcSprites[npcId]; // Get the registered sprite for this NPC

    if (!npcSprite) {
        console.warn(`Movement Engine: No sprite registered for NPC ${npcId}. Cannot move visually.`);
        // Decide if movement should still happen logically without visuals
        // return false; // Option 1: Fail if no sprite
    }

    // Even if sprite is missing, attempt logical move by passing null for sprite
    return _moveEntityTo('NPC', npcId, npcState, updateNpcAttributes, npcSprite || null, targetX, targetY);
}

// --- Helper Functions ---

/**
 * Calculates the cost of moving between two points (placeholder).
 * @param {number} startX
 * @param {number} startY
 * @param {number} endX
 * @param {number} endY
 * @returns {number} The calculated movement cost (e.g., stamina).
 */
function calculateMovementCost(startX, startY, endX, endY) {
    // Simple distance-based cost for now
    const distance = Math.sqrt(Math.pow(endX - startX, 2) + Math.pow(endY - startY, 2));
    return Math.round(distance); // Example: 1 stamina per tile distance
}


// --- Exports ---
export {
    initializeMovement,
    movePlayerTo,
    moveNpcTo, // Export new function
    registerNpcSprite, // Export sprite management functions
    unregisterNpcSprite,
};