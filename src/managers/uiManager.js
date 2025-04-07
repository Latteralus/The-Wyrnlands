/**
 * @module uiManager
 * @description Manages the HTML-based UI elements, updating displays for stats, time, selected info, etc.
 * Also handles showing interaction menus.
 */

// Assume specific HTML element IDs exist in index.html
const UI_ELEMENTS = {
    hungerBar: 'hunger-bar-fill', // ID of the fill element inside the hunger bar
    thirstBar: 'thirst-bar-fill', // ID of the fill element inside the thirst bar
    timeDisplay: 'time-display',
    playerTitleDisplay: 'player-title-display', // Added for player title
    selectedTileInfo: 'selected-tile-info',
    // Add other UI element IDs as needed
    interactionMenu: 'interaction-menu', // Placeholder ID for the interaction menu container
};

/**
 * Initializes the UI Manager. Gets references to key UI elements.
 */
function initializeUIManager() {
    console.log("UI Manager Initialized");
    // Could potentially cache element references here, but querying on demand is also fine for now.
    // Example: this.hungerBarElement = document.getElementById(UI_ELEMENTS.hungerBar);
}

/**
 * Updates the visual representation of a status bar (e.g., hunger, thirst).
 * Assumes the bar has a 'fill' element whose width is set via percentage.
 *
 * @param {string} barType - 'hunger' or 'thirst' (or others). Matches keys in UI_ELEMENTS.
 * @param {number} currentValue - The current value of the stat.
 * @param {number} maxValue - The maximum value of the stat.
 */
function updateStatusBar(barType, currentValue, maxValue) {
    const elementId = UI_ELEMENTS[`${barType}Bar`];
    if (!elementId) {
        console.warn(`UI Manager: No element ID defined for status bar type "${barType}"`);
        return;
    }
    const element = document.getElementById(elementId);
    if (element) {
        const percentage = maxValue > 0 ? (currentValue / maxValue) * 100 : 0;
        element.style.width = `${Math.max(0, Math.min(100, percentage))}%`;
        // console.log(`Updating ${barType} bar to ${percentage}%`);
    } else {
        console.warn(`UI Manager: Element with ID "${elementId}" not found for status bar.`);
    }
}

/**
 * Updates the displayed game time.
 *
 * @param {string} timeString - The formatted time string (e.g., "Day 1, 08:00:00").
 */
function updateTimeDisplay(timeString) {
    const element = document.getElementById(UI_ELEMENTS.timeDisplay);
    if (element) {
        element.textContent = timeString;
    } else {
        console.warn(`UI Manager: Element with ID "${UI_ELEMENTS.timeDisplay}" not found for time display.`);
    }
}

/**
 * Updates the display area showing information about the currently selected tile.
 *
 * @param {object|null} tileData - An object containing information about the tile (e.g., type, coordinates, contents), or null if none selected.
 */
function updateSelectedTileInfo(tileData) {
    const element = document.getElementById(UI_ELEMENTS.selectedTileInfo);
    if (element) {
        if (tileData) {
            // Format the tile data into a user-friendly string
            // Example: `Tile (${tileData.x}, ${tileData.y}): ${tileData.type} - ${tileData.contents || 'Empty'}`
            element.textContent = `Selected: (${tileData.x}, ${tileData.y}) Type: ${tileData.type || 'Unknown'}`; // Basic example
        } else {
            element.textContent = 'Selected: None';
        }
    } else {
        console.warn(`UI Manager: Element with ID "${UI_ELEMENTS.selectedTileInfo}" not found for tile info display.`);
    }
 }
 
 /**
  * Updates the displayed player title.
  *
  * @param {string} titleName - The name of the player's current title (e.g., "Freeman", "Commoner").
  */
 function updatePlayerTitleDisplay(titleName) {
     const element = document.getElementById(UI_ELEMENTS.playerTitleDisplay);
     if (element) {
         element.textContent = titleName || 'Unknown Title'; // Display the title name
     } else {
         console.warn(`UI Manager: Element with ID "${UI_ELEMENTS.playerTitleDisplay}" not found for player title display.`);
     }
 }
 
 // Add other UI update functions as needed (e.g., showModal, updateInventoryDisplay)
 
 export {
    initializeUIManager,
    updateStatusBar,
    updateTimeDisplay,
    updatePlayerTitleDisplay, // Export new function
    updateSelectedTileInfo,
    handleBuildingInteraction,
    showInteractionMenu, // Export the function
    hideInteractionMenu, // Export the function
    showGameOver // Export placeholder
};

/**
 * Handles the initiation of an interaction with a building.
 * Fetches available interactions and displays them.
 * @param {number} buildingId - The ID of the building being interacted with.
 * @param {number} tileX - The X coordinate of the tile the building is on (or part of).
 * @param {number} tileY - The Y coordinate of the tile the building is on (or part of).
 */
async function handleBuildingInteraction(buildingId, tileX, tileY) {
    console.log(`Handling interaction for building ID: ${buildingId} at (${tileX}, ${tileY})`);
    // Import and use getBuildingInteractions from buildingEngine
    const { getBuildingInteractions } = await import('@/engines/buildingEngine.js'); // Dynamic import might help with mocking
    const interactions = await getBuildingInteractions(buildingId, tileX, tileY); // Ensure await here
    /* Placeholder interactions removed
    const interactions = [ // Placeholder interactions
    */

    if (interactions && interactions.length > 0) {
        showInteractionMenu(interactions, tileX, tileY);
    } else {
        console.log(`No interactions available for building ${buildingId}.`);
        // Optionally show a message to the player
    }
}

/**
 * Displays a contextual interaction menu near the specified tile.
 * (Placeholder - needs actual HTML/CSS implementation)
 * @param {Array<object>} interactions - Array of interaction objects { label: string, action: function }.
 * @param {number} tileX - The X coordinate of the target tile.
 * @param {number} tileY - The Y coordinate of the target tile.
 */
function showInteractionMenu(interactions, tileX, tileY) {
    console.log(`Showing interaction menu at (${tileX}, ${tileY}) with options:`, interactions.map(i => i.label));
    const menuElement = document.getElementById(UI_ELEMENTS.interactionMenu);
    if (!menuElement) {
        console.error(`UI Manager: Interaction menu element with ID "${UI_ELEMENTS.interactionMenu}" not found.`);
        return;
    }

    // Clear previous menu items
    menuElement.innerHTML = '';
    menuElement.style.display = 'block';
    // TODO: Position the menu near the clicked tile (tileX, tileY) - requires converting tile coords to screen coords
    // Example positioning (needs refinement):
    // menuElement.style.left = `${tileX * 32 + 40}px`; // Placeholder positioning
    // menuElement.style.top = `${tileY * 32}px`;      // Placeholder positioning

    // Create buttons for each interaction
    interactions.forEach(interaction => {
        const button = document.createElement('button');
        button.textContent = interaction.label;
        button.onclick = () => {
            console.log(`Executing action: ${interaction.label}`);
            interaction.action(); // Execute the action function associated with the button
            hideInteractionMenu(); // Hide menu after action is clicked
        };
        menuElement.appendChild(button);
    });

    // Add a close button or click-outside-to-close logic
    const closeButton = document.createElement('button');
    closeButton.textContent = 'Close';
    closeButton.onclick = hideInteractionMenu;
    menuElement.appendChild(closeButton);
}

/**
 * Hides the interaction menu.
 */
function hideInteractionMenu() {
    const menuElement = document.getElementById(UI_ELEMENTS.interactionMenu);
    if (menuElement) {
        menuElement.style.display = 'none';
        menuElement.innerHTML = ''; // Clear content
    }
}

/**
 * Displays the Game Over screen/message.
 * (Placeholder - needs actual UI implementation)
 * @param {string} message - The reason for the game over.
 */
function showGameOver(message) {
    console.error(`--- GAME OVER --- \n${message}`);
    // TODO: Implement actual Game Over UI (e.g., show a modal, disable game input)
    // Example:
    // const gameOverModal = document.getElementById('game-over-modal');
    // const gameOverMessage = document.getElementById('game-over-message');
    // if (gameOverModal && gameOverMessage) {
    //     gameOverMessage.textContent = message;
    //     gameOverModal.style.display = 'block';
    // }
}