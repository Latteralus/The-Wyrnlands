// Import Core Modules
import { initializeDatabase } from './src/data/database.js'; // Removed getDb import
// Removed incorrect import for saveLoadManager - functions are imported directly when needed
// import { initializeSaveLoadManager } from './src/managers/saveLoadManager.js';
import { initializeMap, createMapVisuals } from './src/engines/mapEngine.js'; // Import specific functions
import { initializePlayer, getPlayerAttribute } from './src/engines/playerEngine.js'; // Import specific functions
import { initializeMovementEngine } from './src/engines/movementEngine.js';
import { initializeSurvivalEngine } from './src/engines/survivalEngine.js'; // Assuming this exists and is correct
import { initializeBuildingEngine } from './src/engines/buildingEngine.js'; // Assuming this exists and is correct
import { initializeTaxEngine } from './src/engines/taxEngine.js'; // Assuming this exists and is correct
import { initializeSkillEngine } from './src/engines/skillEngine.js'; // Assuming this exists and is correct
import { initializeJobEngine } from './src/engines/jobEngine.js'; // Assuming this exists and is correct
import { initializeNPCEngine } from './src/engines/npcEngine.js'; // Assuming this exists and is correct
import { initializeConstructionEngine } from './src/engines/constructionEngine.js'; // Assuming this exists and is correct
import { initializeTimeEngine, getCurrentTime } from './src/engines/timeEngine.js';
import { initializeUIManager, updateStatusBar, updateTimeDisplay, updateSelectedTileInfo } from './src/managers/uiManager.js';
import { applyDailySurvivalDecay } from './src/engines/survivalEngine.js'; // Import survival function

// Import Utilities (as needed by engines/managers during init or runtime)
import * as dbUtils from './src/utils/dbUtils.js';
import * as inventoryUtils from './src/utils/inventoryUtils.js';
import * as laborUtils from './src/utils/laborUtils.js';
import * as buildingUtils from './src/utils/buildingUtils.js';
import * as nameGen from './src/utils/nameGenerator.js';

// Placeholder Scenes (to be implemented in src/scenes/)
class BootScene extends Phaser.Scene {
    constructor() { super('BootScene'); }
    preload() { console.log("BootScene preload"); }
    create() {
        console.log("BootScene create");
        this.scene.start('PreloaderScene'); // Start preloader after boot
    }
}

class PreloaderScene extends Phaser.Scene {
    constructor() { super('PreloaderScene'); }
    preload() {
        console.log("PreloaderScene preload");
        // TODO: Load assets here (tilesets, spritesheets, etc.)
        // For now, just show a loading message
        this.add.text(this.cameras.main.width / 2, this.cameras.main.height / 2, 'Loading...', { font: '16px Arial', fill: '#ffffff' }).setOrigin(0.5);
    }
    create() {
        console.log("PreloaderScene create");
        // TODO: Once assets are loaded, start the main game scene and UI
        this.scene.start('GameScene');
        this.scene.start('UIScene'); // Start UI scene concurrently
        this.scene.bringToTop('UIScene'); // Ensure UI is drawn on top
    }
}

class GameScene extends Phaser.Scene {
    constructor() {
        super('GameScene');
        // No need to store engines/managers on the scene instance if using direct imports
        // this.engines = {};
        // this.managers = {};
        this.utils = { dbUtils, inventoryUtils, laborUtils, buildingUtils, nameGen }; // Utils might still be useful to pass around
        this.db = null;
        this.gameReady = false; // Use a flag to indicate full initialization completion
    }

    preload() { console.log("GameScene preload"); }

    async create() {
        console.log("GameScene create: Initializing...");
        this.add.text(10, 10, 'Initializing Database...', { font: '16px Arial', fill: '#ffffff' });

        try {
            // 1. Initialize Database
            this.db = await initializeDatabase();
            if (!this.db) {
                throw new Error("Database failed to initialize.");
            }
            console.log("Database Initialized.");
            window.wyrnlands.db = this.db; // Keep global DB access for now if needed elsewhere

            // 2. Initialize Core Engines (Map and Player first)
            console.log("[GameScene] Initializing Map Engine...");
            await initializeMap(); // Uses imported function
            console.log("[GameScene] Map Engine Initialized (State Ready).");

            console.log("[GameScene] Initializing Player Engine...");
            await initializePlayer(); // Uses imported function
            console.log("[GameScene] Player Engine Initialized (State Ready).");

            // --- Visual Setup ---
            const TILE_DRAW_WIDTH = 32;
            const TILE_DRAW_HEIGHT = 32;

            console.log("[GameScene] Creating Map Visuals...");
            createMapVisuals(this, TILE_DRAW_WIDTH, TILE_DRAW_HEIGHT); // Use imported function
            console.log("[GameScene] createMapVisuals called.");

            console.log("[GameScene] Creating Player Visual...");
            const playerX = getPlayerAttribute('x'); // Use imported function
            const playerY = getPlayerAttribute('y'); // Use imported function
            console.log(`[GameScene] Retrieved Player Coords: (${playerX}, ${playerY})`); // Log coords
            if (playerX === undefined || playerY === undefined) {
                // Log error instead of throwing to potentially see more logs
                console.error("[GameScene] CRITICAL: Player position is undefined after initialization. Cannot create player visual.");
                return; // Stop further setup in create if player position is missing
            }
            const playerStartX = playerX * TILE_DRAW_WIDTH + TILE_DRAW_WIDTH / 2;
            const playerStartY = playerY * TILE_DRAW_HEIGHT + TILE_DRAW_HEIGHT / 2;
            this.playerVisual = this.add.circle(playerStartX, playerStartY, TILE_DRAW_WIDTH / 3, 0xffffff); // White circle
            console.log("Player visual created at", playerStartX, playerStartY);

            // 3. Initialize Other Managers & Engines
            console.log("Initializing Save/Load Manager...");
            // initializeSaveLoadManager(); // Removed call - functions are likely called by UI events

            console.log("Initializing Movement Engine...");
            console.log("[GameScene] Initializing Movement Engine...");
            initializeMovementEngine(this, this.playerVisual, TILE_DRAW_WIDTH, TILE_DRAW_HEIGHT); // Use imported function
            console.log("[GameScene] initializeMovementEngine called.");

            console.log("Initializing Survival Engine...");
            initializeSurvivalEngine(); // Assuming it uses getDb/player functions internally

            console.log("Initializing Building Engine...");
            initializeBuildingEngine(); // Assuming it uses getDb/map functions internally

            // Initialize placeholder engines (assuming they don't have complex dependencies yet)
            console.log("Initializing Placeholder Engines (Tax, Skill, Job, NPC, Construction)...");
            initializeTaxEngine();
            initializeSkillEngine();
            initializeJobEngine();
            initializeNPCEngine();
            initializeConstructionEngine();

            // Store utils globally if needed by other modules temporarily
            window.wyrnlands.utils = this.utils;

            console.log("All Engines and Managers Initialized.");

            // 3. Initialize Time Engine (starts the game loop)
            // Pass the gameTick function as the callback
            // Initialize Time Engine last as it starts the tick
            console.log("Initializing Time Engine...");
            initializeTimeEngine(this.gameTick.bind(this)); // Use imported function

            this.gameReady = true; // Set flag indicating successful initialization
            console.log("Game Initialized and Ticking.");
            this.add.text(10, 30, 'Game Ready!', { font: '16px Arial', fill: '#00ff00' });

            // Initial game setup is now mostly done above

        } catch (error) {
            console.error("Initialization failed:", error);
            this.add.text(10, 30, `Initialization Error: ${error.message}`, { font: '16px Arial', fill: '#ff0000' });
        }
    }

    /**
     * The main game tick callback, executed by the timeEngine.
     * @param {object} currentTime - The current game time object from timeEngine.
     */
    gameTick(currentTime) {
        if (!this.gameReady) return; // Don't run if not ready

        // console.log(`Game Tick: ${currentTime.timeString}`); // DEBUG: Can be very noisy

        // --- Update game state based on time ---
        // Order can be important here

        // 1. Update Needs (Hunger/Thirst)
        // TODO: Refactor survivalTick if needed, or call the correct function from survivalEngine
        // For now, assume applyDailySurvivalDecay is the main periodic function (though it's registered via callback)
        // This gameTick might be for *intra-day* updates later.

        // 2. Process NPC actions/schedules
        // TODO: Loop through active NPCs and call processNpcTick
        // this.engines.npc.processNpcTick(this.db, this.engines, this.utils, npcId, currentTime);

        // 3. Process Construction Projects
        // TODO: Loop through active projects and call processConstructionTick
        // this.engines.construction.processConstructionTick(this.db, this.engines, this.utils, projectId);

        // 4. Process Taxes (e.g., check if it's the 1st of the month)
        // TODO: Add logic to call applyMonthlyTaxes periodically
        // if (currentTime.dayOfMonth === 1 && currentTime.hour === 0 && currentTime.minute === 0) { ... }

        // --- Other periodic updates ---

    }

    update(time, delta) {
        // TODO: Game loop logic (updates engines, player state, etc.)
    }
}

class UIScene extends Phaser.Scene {
    constructor() {
        super('UIScene');
        this.uiInitialized = false;
    }

    preload() { console.log("UIScene preload"); }

    create() {
        console.log("UIScene create");
        // Initialize the UI Manager
        initializeUIManager();
        this.uiInitialized = true;
        console.log("UI Manager Initialized via UIScene.");

        // Placeholder text - remove once real UI elements are in index.html
        this.add.text(10, 50, 'UI Layer Active', { font: '12px Arial', fill: '#55ff55' });

        // Example: Add listeners for specific game events if needed later
        // const gameScene = this.scene.get('GameScene');
        // gameScene.events.on('player_stat_changed', this.handleStatChange, this);
    }

    update(time, delta) {
        // Check if UI is ready and core engines are available via direct import
        // Note: Accessing engines via global might still be necessary if UIScene can't easily access GameScene state
        // Or use Phaser's event emitter or registry. Sticking with global for now for simplicity.
        if (!this.uiInitialized || !window.wyrnlands?.game?.scene?.getScene('GameScene')?.gameReady) {
             // Wait until game scene is fully ready
             return;
        }

        // --- Update UI elements periodically ---
        // Use direct imports where possible, fallback to global temporarily if needed

        // Update Time Display
        // Time Engine functions are directly imported
        const currentTime = getCurrentTime();
        updateTimeDisplay(currentTime.timeString);

        // Update Player Status Bars (assuming player engine has methods to get current/max needs)
        // These methods need to be implemented in playerEngine.js
        // Player Engine functions are directly imported
        const hunger = getPlayerAttribute('hunger');
        // Assuming max needs are constant for now, define them or get from playerEngine if dynamic
        const MAX_NEED_VALUE = 100; // Example constant
        updateStatusBar('hunger', hunger ?? 50, MAX_NEED_VALUE); // Use defaults if attribute is undefined

        const thirst = getPlayerAttribute('thirst');
        updateStatusBar('thirst', thirst ?? 50, MAX_NEED_VALUE); // Use defaults

        // Update Selected Tile Info (needs mechanism to select tiles first)
        // const selectedTile = window.wyrnlands.selectedTile; // Example global state
        // updateSelectedTileInfo(selectedTile || null);

    }
}


// Phaser Game Configuration
const config = {
    type: Phaser.AUTO, // Automatically choose WebGL or Canvas
    width: 800,
    height: 600,
    parent: 'game-container', // ID of the div to contain the canvas
    physics: {
        default: 'arcade',
        arcade: {
            // gravity: { y: 0 }, // No gravity needed for top-down
            debug: false // Set to true for physics debugging
        }
    },
    scene: [
        BootScene,
        PreloaderScene,
        GameScene,
        UIScene
        // Add other scenes here as they are created
    ],
    backgroundColor: '#1a1a1a' // Dark background
};

// Initialize Phaser Game
const game = new Phaser.Game(config);

console.log("Phaser game initialized.");

// --- Global Access (Consider alternatives like a Registry or Event Emitter later) ---
// This provides temporary global access for debugging and early development.
// Avoid relying heavily on global variables in the long run.
window.wyrnlands = {
    game: game,
    // Add references to engines/managers here as they are created
    // e.g., mapEngine: null, playerEngine: null, etc.
};

console.log("The Wyrnlands global namespace created.");