// src/managers/saveLoadManager.js
// Handles saving the game state to a .sqlite file and loading it back.

import { exportDatabase, importDatabase, initializeDatabase, isDbInitialized } from '../data/database.js';

// Ensure FileSaver.js is loaded (typically via index.html)
if (typeof saveAs === 'undefined') {
    console.error("FileSaver.js (saveAs function) not found. Make sure it's included in index.html.");
    // Optionally throw an error or provide a dummy function to prevent crashes
    // window.saveAs = () => { console.error("FileSaver not loaded!"); };
}

/**
 * Exports the current database state and triggers a download.
 * @param {string} [filename='wyrnlands_save.sqlite'] - The desired name for the save file.
 * @returns {Promise<void>}
 */
async function saveGame(filename = 'wyrnlands_save.sqlite') {
    console.log("Attempting to save game...");
    if (!isDbInitialized) {
        console.error("Cannot save game: Database not initialized.");
        alert("Error: Database not ready. Cannot save game."); // User feedback
        return;
    }

    try {
        const data = await exportDatabase(); // Get data as Uint8Array
        const blob = new Blob([data], { type: "application/x-sqlite3" });

        // Use FileSaver.js to trigger the download
        saveAs(blob, filename); // saveAs is globally available from FileSaver.js

        console.log(`Game saved successfully as ${filename}`);
        alert(`Game saved as ${filename}`); // Simple user feedback

    } catch (error) {
        console.error("Error saving game:", error);
        alert(`Error saving game: ${error.message}`); // User feedback
    }
}

/**
 * Handles the file selection process for loading a game.
 * Creates a hidden file input element, triggers a click, and reads the selected file.
 * @returns {Promise<void>} Resolves when a file is selected and processed, rejects on error or cancellation.
 */
function triggerLoadGame() {
    return new Promise((resolve, reject) => {
        console.log("Triggering load game file selection...");
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = '.sqlite, .db, application/x-sqlite3'; // Accept common SQLite extensions

        fileInput.onchange = async (event) => {
            const file = event.target.files[0];
            if (!file) {
                console.log("No file selected.");
                reject(new Error("No file selected.")); // Or resolve without action
                return;
            }

            console.log(`File selected: ${file.name} (Type: ${file.type}, Size: ${file.size} bytes)`);

            if (file.size === 0) {
                 console.error("Selected file is empty.");
                 alert("Error: Selected save file is empty.");
                 reject(new Error("Selected file is empty."));
                 return;
            }

            // Proceed to load the file content
            try {
                await loadGameFromFile(file);
                resolve(); // Indicate successful load process initiation
            } catch (error) {
                reject(error); // Propagate error from loadGameFromFile
            } finally {
                 // Clean up the input element? Not strictly necessary as it's not added to DOM.
            }
        };

        // Handle cancellation (though browser support varies)
        fileInput.oncancel = () => { // Note: 'oncancel' might not be universally supported
             console.log("File selection cancelled.");
             reject(new Error("File selection cancelled."));
        };


        // Trigger the file selection dialog
        fileInput.click();
    });
}


/**
 * Reads the content of a selected .sqlite file and imports it into the database.
 * @param {File} file - The file object selected by the user.
 * @returns {Promise<void>}
 */
async function loadGameFromFile(file) {
    console.log(`Attempting to load game from file: ${file.name}`);
    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = async (event) => { // Reverted to simple async handler
            try {
                const arrayBuffer = event.target.result;
                if (!arrayBuffer || arrayBuffer.byteLength === 0) {
                     throw new Error("File read resulted in empty buffer.");
                }
                const data = new Uint8Array(arrayBuffer);
                console.log(`File read successfully (${data.length} bytes). Importing database...`);

                // Ensure database module is ready (sql.js loaded) before importing
                // initializeDatabase might be needed if loading before initial game setup
                if (!isDbInitialized && !SQL) { // Check if SQL lib itself is loaded
                    console.warn("Initializing database module before loading save...");
                    await initializeDatabase(); // Make sure SQL is loaded via initSqlJs
                }

                await importDatabase(data); // Replace current DB with loaded data

                console.log("Game loaded successfully from file.");
                alert("Game loaded successfully!"); // Simple user feedback

                // TODO: Trigger game state refresh/reload in Phaser scenes
                // This might involve emitting an event that scenes listen for.
                // Example: window.wyrnlands.eventEmitter.emit('game_loaded');

                resolve();

            } catch (error) {
                console.error("Error processing or importing loaded file:", error);
                alert(`Error loading game: ${error.message}`); // User feedback
                reject(error); // This reject should propagate to the outer promise
            }
        };

        reader.onerror = (event) => {
            console.error("Error reading file:", event.target.error);
            alert(`Error reading file: ${event.target.error.message}`);
            reject(event.target.error);
        };

        // Read the file as an ArrayBuffer
        reader.readAsArrayBuffer(file);
    });
}


// Export the public functions
export {
    saveGame,
    triggerLoadGame,
    loadGameFromFile // Exporting this might be useful for drag-and-drop later
};