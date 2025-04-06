// src/engines/movementEngine.js
// Handles player movement logic, including validation and position updates.

import { isWalkable, getTile } from './mapEngine.js'; // Use relative path
import { getPlayerAttribute, updatePlayerAttributes, modifyNeed } from './playerEngine.js'; // Use relative path
import { getMountData } from '../data/mountData.js'; // Use relative path
import { handleBuildingInteraction } from '../managers/uiManager.js'; // Use relative path

// TODO: Implement pathfinding (e.g., A* algorithm) for more complex movement.
// TODO: Consider movement speed, terrain costs, time consumption.

console.log("Movement Engine Module Loaded");
 
 // --- Phaser Integration ---
 let phaserScene = null;
 let playerSprite = null; // Reference to the Phaser object representing the player
 let tileDrawWidth = 32; // Default, will be set during initialization
 let tileDrawHeight = 32; // Default, will be set during initialization
 
 /**
  * Initializes the movement engine with necessary Phaser references.
  * Sets up input listeners for player movement commands.
  * @param {Phaser.Scene} scene - The main Phaser scene.
  * @param {Phaser.GameObjects.Sprite | Phaser.GameObjects.Arc | any} playerVisual - The visual representation of the player.
  * @param {number} tileWidthPx - The width of a tile in pixels.
  * @param {number} tileHeightPx - The height of a tile in pixels.
  */
 function initializeMovementEngine(scene, playerVisual, tileWidthPx, tileHeightPx) {
     if (!scene || !playerVisual) {
         console.error("MovementEngine: Scene and playerVisual are required for initialization.");
         return;
     }
     phaserScene = scene;
     playerSprite = playerVisual;
     tileDrawWidth = tileWidthPx;
     tileDrawHeight = tileHeightPx;
 
     console.log("Initializing Movement Engine Input Listener...");
 
     // Add input listener for pointer down (click)
     phaserScene.input.on('pointerdown', (pointer) => {
         // Calculate the tile coordinates from the world coordinates
         const worldX = pointer.worldX;
         const worldY = pointer.worldY;
         const targetTileX = Math.floor(worldX / tileDrawWidth);
         const targetTileY = Math.floor(worldY / tileDrawHeight);
 
         console.log(`Pointer down at world coords (${worldX.toFixed(0)}, ${worldY.toFixed(0)}), Tile: (${targetTileX}, ${targetTileY})`);
 
         // Check if the clicked tile has a building
         const clickedTile = getTile(targetTileX, targetTileY);
 
         if (clickedTile && clickedTile.buildingId !== null) {
             console.log(`Clicked on building ID: ${clickedTile.buildingId} at (${targetTileX}, ${targetTileY}). Triggering interaction.`);
             handleBuildingInteraction(clickedTile.buildingId, targetTileX, targetTileY); // Call interaction handler
         } else {
             // No building or tile doesn't exist, attempt to move
             moveToTile(targetTileX, targetTileY);
         }
     });
 
     console.log("Movement Engine Initialized.");
 }
 
/**
 * Attempts to move the player directly to the target tile coordinates.
 * Checks if the target tile is walkable before updating the player's position.
 * @param {number} targetX - The target X coordinate.
 * @param {number} targetY - The target Y coordinate.
 * @returns {boolean} True if the move was successful, false otherwise.
 */
function moveToTile(targetX, targetY) {
    const currentX = getPlayerAttribute('x');
    const currentY = getPlayerAttribute('y');

    if (currentX === undefined || currentY === undefined) {
        console.error("MovementEngine: Player coordinates not found in playerEngine state.");
        return false;
    }

    console.log(`Movement request from (${currentX}, ${currentY}) to (${targetX}, ${targetY})`);

    // 1. Validate Target Tile
    if (!isWalkable(targetX, targetY)) {
        console.log(`Movement failed: Target tile (${targetX}, ${targetY}) is not walkable.`);
        // Optionally provide user feedback here (e.g., sound effect, visual indicator)
        return false;
    }

    // 2. TODO: Implement Pathfinding if needed
    // For now, we assume direct movement is possible if the target is walkable.
    // A pathfinding algorithm (like A*) would be needed to navigate around obstacles.
    // const path = findPath(currentX, currentY, targetX, targetY);
    // if (!path) {
    //     console.log(`Movement failed: No path found to (${targetX}, ${targetY}).`);
    //     return false;
    // }

    // 3. Update Player Position
    // For direct movement:
    updatePlayerAttributes({ x: targetX, y: targetY });
    // Note: updatePlayerAttributes is async, but we don't necessarily need to wait for DB write here.
    console.log(`Movement successful: Player moved to (${targetX}, ${targetY})`);

    // 3.5 Apply Movement Cost (Example: Fatigue) & Consider Mount
    const mountId = getPlayerAttribute('currentMountId');
    let fatigueCost = 0.5; // Base fatigue cost per tile
    let speedModifier = 1.0; // Base speed modifier

    if (mountId) {
        const mountData = getMountData(mountId);
        if (mountData) {
            console.log(`Applying modifiers for mount: ${mountData.name}`);
            fatigueCost *= mountData.fatigueModifier;
            speedModifier = mountData.speedModifier; // Store for potential use
            // TODO: Use speedModifier to affect actual movement time/tween duration
        } else {
            console.warn(`Could not find data for mount ID: ${mountId}`);
        }
    }

    console.log(`Applying fatigue cost: ${fatigueCost.toFixed(2)} (Speed Mod: ${speedModifier.toFixed(1)}x)`);
    modifyNeed('fatigue', -fatigueCost); // Decrease fatigue

    // 4. Trigger visual update in Phaser scene
    if (playerSprite && phaserScene) {
        // Calculate center pixel coordinates for the target tile
        const targetPixelX = targetX * tileDrawWidth + tileDrawWidth / 2;
        const targetPixelY = targetY * tileDrawHeight + tileDrawHeight / 2;
        // TODO: Implement smooth tweening instead of direct setPosition
        playerSprite.setPosition(targetPixelX, targetPixelY);
        console.log(`Player sprite moved to pixel coords (${targetPixelX.toFixed(0)}, ${targetPixelY.toFixed(0)})`);
    } else {
        console.warn("MovementEngine: Player sprite or scene not available for visual update.");
    }

    return true;
}

// --- Exports ---
export {
    initializeMovementEngine,
    moveToTile,
    // Potentially export pathfinding functions later
};