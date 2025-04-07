// Import Core Modules
import { initializeDatabase, importDatabase } from './src/data/database.js'; // Import importDatabase
// Removed incorrect import for saveLoadManager - functions are imported directly when needed
// import { initializeSaveLoadManager } from './src/managers/saveLoadManager.js';
import { initializeMap, createMapVisuals } from './src/engines/mapEngine.js'; // Import specific functions
import { initializePlayer, getPlayerAttribute, getPlayerTitleDetails, getPlayerState, updatePlayerAttributes } from './src/engines/playerEngine.js'; // Added getPlayerState, updatePlayerAttributes
import { initializeMovement, registerNpcSprite } from './src/engines/movementEngine.js'; // Corrected import name, Added registerNpcSprite
import { initializeSurvivalEngine } from './src/engines/survivalEngine.js';
import { initializeBuildingEngine } from './src/engines/buildingEngine.js'; // Assuming this exists and is correct
import { initializeTaxEngine } from './src/engines/taxEngine.js'; // Assuming this exists and is correct
import { initializeSkillEngine } from './src/engines/skillEngine.js'; // Assuming this exists and is correct
import { initializeJobEngine } from './src/engines/jobEngine.js'; // Assuming this exists and is correct
import { initializeNPCEngine, getActiveNpcIds, getNpcAttribute } from './src/engines/npcEngine.js'; // Added getActiveNpcIds, getNpcAttribute
import { initializeConstructionEngine } from './src/engines/constructionEngine.js';
import { initializeTimeEngine, getCurrentTime } from './src/engines/timeEngine.js';
import { initializeUIManager, updateStatusBar, updateTimeDisplay, updateSelectedTileInfo, updatePlayerTitleDisplay, showGameOver } from './src/managers/uiManager.js'; // Added updatePlayerTitleDisplay, showGameOver
import { applySurvivalEffects } from './src/engines/survivalEngine.js'; // Import refactored survival function
// Removed old import: import { applyDailySurvivalDecay } from './src/engines/survivalEngine.js';
// Import Utilities (as needed by engines/managers during init or runtime)
import * as dbUtils from './src/utils/dbUtils.js';
import * as inventoryUtils from './src/utils/inventoryUtils.js';
import * as laborUtils from './src/utils/laborUtils.js';
import * as buildingUtils from './src/utils/buildingUtils.js';
import * as nameGen from './src/utils/nameGenerator.js'; // Import name generator

// Placeholder Scenes (to be implemented in src/scenes/)
class BootScene extends Phaser.Scene {
    constructor() { super('BootScene'); }
    preload() { console.log("BootScene preload"); }
    create() {
        console.log("BootScene create");
        // Pass the options received by startGame (stored globally temporarily)
        this.scene.start('PreloaderScene', window.wyrnlandsStartOptions || {});
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
    // Add init method to receive data passed from scene.start
    init(data) {
        console.log("PreloaderScene init received data:", data);
        this.startOptions = data || {};
    }
    create() {
        console.log("PreloaderScene create");
        // Pass the received startOptions along to GameScene and UIScene
        this.scene.start('GameScene', this.startOptions); // Pass data
        this.scene.start('UIScene', this.startOptions); // Pass data
        this.scene.bringToTop('UIScene');
    }
}

class GameScene extends Phaser.Scene {
    constructor() {
        super('GameScene');
        this.utils = { dbUtils, inventoryUtils, laborUtils, buildingUtils, nameGen };
        this.db = null;
        this.gameReady = false;
        this.startOptions = {}; // To store options passed from startGame
    }

    // Add init method to receive data passed from scene.start
    init(data) {
        console.log("GameScene init received data:", data);
        this.startOptions = data || {};
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
            // Pass relevant options from startOptions to initializePlayer
            const playerInitData = {};
            if (this.startOptions.playerName) {
                playerInitData.name = this.startOptions.playerName;
                playerInitData.playerFirstName = this.startOptions.playerFirstName; // Pass first name
                playerInitData.playerLastName = this.startOptions.playerLastName;   // Pass last name
            }
            if (this.startOptions.startingTool) {
                playerInitData.startingTool = this.startOptions.startingTool; // Pass starting tool
            }
            // Add other options if needed
            await initializePlayer(playerInitData); // Pass initial data including name and tool
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
            this.cameras.main.startFollow(this.playerVisual); // Make camera follow the player
            console.log("Player visual created at", playerStartX, playerStartY);

            // 3. Initialize Other Managers & Engines
            console.log("Initializing Save/Load Manager...");
            // initializeSaveLoadManager(); // Removed call - functions are likely called by UI events

            console.log("Initializing Movement Engine...");
            console.log("[GameScene] Initializing Movement Engine...");
            initializeMovement(this, this.playerVisual, TILE_DRAW_WIDTH, TILE_DRAW_HEIGHT); // Use corrected imported function name
            console.log("[GameScene] initializeMovement called.");

            console.log("Initializing Survival Engine...");
            initializeSurvivalEngine(); // Assuming it uses getDb/player functions internally

            console.log("Initializing Building Engine...");
            initializeBuildingEngine(); // Assuming it uses getDb/map functions internally

            // Initialize placeholder engines (assuming they don't have complex dependencies yet)
            console.log("Initializing Placeholder Engines (Tax, Skill, Job, NPC, Construction)...");
            initializeTaxEngine();
            initializeSkillEngine();
            initializeJobEngine();
            await initializeNPCEngine(); // Ensure NPC data is loaded before creating visuals
            initializeConstructionEngine();

            // --- Create NPC Visuals ---
            console.log("[GameScene] Creating NPC Visuals...");
            const npcIds = getActiveNpcIds();
            for (const npcId of npcIds) {
                const npcX = getNpcAttribute(npcId, 'x');
                const npcY = getNpcAttribute(npcId, 'y');
                if (npcX !== undefined && npcY !== undefined) {
                    const npcStartX = npcX * TILE_DRAW_WIDTH + TILE_DRAW_WIDTH / 2;
                    const npcStartY = npcY * TILE_DRAW_HEIGHT + TILE_DRAW_HEIGHT / 2;
                    // Simple grey circle for NPCs for now
                    const npcSprite = this.add.circle(npcStartX, npcStartY, TILE_DRAW_WIDTH / 3.5, 0x888888);
                    registerNpcSprite(npcId, npcSprite); // Register with movement engine
                } else {
                    console.warn(`Could not get position for NPC ${npcId} to create visual.`);
                }
            }
            console.log(`[GameScene] Created visuals for ${npcIds.length} NPCs.`);
            // --- End NPC Visuals ---

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

        // --- Daily Updates ---
        // TODO: This check is basic. Implement a more robust way to track day changes (e.g., event from timeEngine or store last processed day).
        if (currentTime.hour === 0 && currentTime.minute === 0 && Math.floor(currentTime.second) === 0) {
            console.log(`--- Processing Daily Updates for Day ${currentTime.day} ---`);

            // 1. Apply Player Survival Effects
            const playerState = getPlayerState();
            if (playerState) {
                const survivalOutcome = applySurvivalEffects(playerState); // Modifies playerState directly

                // Persist changes if any occurred
                if (survivalOutcome.needsChanged || survivalOutcome.healthChanged) {
                    const updatesToPersist = {};
                    if (survivalOutcome.needsChanged) {
                        updatesToPersist.hunger = playerState.hunger;
                        updatesToPersist.thirst = playerState.thirst;
                    }
                    if (survivalOutcome.healthChanged) {
                        updatesToPersist.health = playerState.health;
                    }
                    updatePlayerAttributes(updatesToPersist)
                        .catch(err => console.error("Failed to persist player survival updates:", err));
                }

                // Handle player death
                if (survivalOutcome.isDead) {
                    // TODO: Stop timeEngine, disable input, etc.
                    showGameOver("You succumbed to the harsh conditions.");
                    this.gameReady = false; // Stop further ticks processing in this scene
                    // Consider stopping the time engine globally:
                    // import { stopTicking } from './src/engines/timeEngine.js'; stopTicking();
                }
            }

            // 2. Apply NPC Survival Effects (Loop through active NPCs)
            // TODO: Implement this loop after NPC engine refactor is complete and integrated
            // const npcIds = getActiveNpcIds();
            // for (const npcId of npcIds) {
            //     const npcState = getNpcState(npcId);
            //     if (npcState) {
            //         const npcSurvivalOutcome = applySurvivalEffects(npcState);
            //         if (npcSurvivalOutcome.needsChanged || npcSurvivalOutcome.healthChanged) {
            //             // Persist changes using updateNpcAttributes
            //         }
            //         if (npcSurvivalOutcome.isDead) {
            //             // Handle NPC death (remove from simulation, etc.)
            //         }
            //     }
            // }

            // 3. Apply Taxes (if it's the start of the month)
            // TODO: Implement monthly tax logic check
            // if (currentTime.dayOfMonth === 1) { ... }

        }
        // --- End Daily Updates ---


        // --- Frequent Updates (Can happen multiple times per day) ---

        // Process NPC actions/schedules (can happen multiple times per day)
        const activeNpcIds = getActiveNpcIds();
        for (const npcId of activeNpcIds) {
            // Pass null for engines/utils for now, as processNpcTick doesn't use them directly yet
            processNpcTick(null, this.utils, npcId, currentTime)
                .catch(err => console.error(`Error processing tick for NPC ${npcId}:`, err));
        }


        // 3. Process Construction Projects
        // TODO: Loop through active projects and call processConstructionTick
        // this.engines.construction.processConstructionTick(this.db, this.engines, this.utils, projectId);


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
        this.startOptions = {}; // To store options passed from startGame
    }

    // Add init method to receive data passed from scene.start
    init(data) {
        console.log("UIScene init received data:", data);
        this.startOptions = data || {};
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

        // Update Player Title Display
        const titleDetails = getPlayerTitleDetails(); // Get the full title object
        updatePlayerTitleDisplay(titleDetails?.name || 'Commoner'); // Pass the name to the UI function

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

// --- Screen Navigation Logic ---

function showScreen(screenId) {
    console.log(`Switching to screen: ${screenId}`);
    // Hide all screens
    document.querySelectorAll('.screen').forEach(screen => {
        screen.classList.remove('active');
    });
    // Show the target screen
    const targetScreen = document.getElementById(screenId);
    if (targetScreen) {
        targetScreen.classList.add('active');
    } else {
        console.error(`Screen with ID "${screenId}" not found.`);
    }
}

// --- Game Initialization Function ---
// Moved Phaser init and engine setup into this function
async function startGame(options = {}) {
    console.log("startGame function called with options:", options);
    // Ensure game screen is visible
    showScreen('game-screen');

    // Store options globally so scenes can access them if needed via window object
    // (Alternative: Use Phaser's Registry or pass data via scene.start)
    window.wyrnlandsStartOptions = options;

    // Initialize Phaser Game using the original config
    const game = new Phaser.Game(config);
    console.log("Phaser game initialized.");

    // --- Global Access ---
    window.wyrnlands = {
        game: game,
        db: null,
        utils: {},
        startOptions: options // Store options globally if needed for debugging/other access
    };
    console.log("The Wyrnlands global namespace created.");

    // Scene transitions are now handled within the scene classes themselves
    // using the data passed via scene.start and received in init().
}


// --- Event Listeners for Menu Navigation ---
document.addEventListener('DOMContentLoaded', () => {
    console.log("DOM Loaded, setting up menu listeners.");

    const newGameButton = document.getElementById('new-game-button');
    const loadGameButton = document.getElementById('load-game-button');
    const settingsButton = document.getElementById('settings-button');
    const backButtons = document.querySelectorAll('.back-button');
    const startNewGameConfirmButton = document.getElementById('start-new-game-confirm-button');
    const loadFileInput = document.getElementById('load-file-input');
    const loadStatus = document.getElementById('load-status');
    const randomizeNameButton = document.getElementById('randomize-name-button'); // Get randomize button
    // const continueGameButton = document.getElementById('continue-game-button'); // TODO: Handle continue logic

    if (newGameButton) {
        newGameButton.addEventListener('click', () => {
            showScreen('new-game-screen');
        });
    }

    if (loadGameButton) {
        loadGameButton.addEventListener('click', () => {
            showScreen('load-game-screen');
            // Note: Actual loading is triggered by the file input change event below
        });
    }

    if (settingsButton) {
        settingsButton.addEventListener('click', () => {
            showScreen('settings-screen');
        });
    }

    backButtons.forEach(button => {
        button.addEventListener('click', () => {
            showScreen('homepage-screen'); // All back buttons go to homepage
        });
    });

    if (randomizeNameButton) {
        randomizeNameButton.addEventListener('click', () => {
            const firstNameInput = document.getElementById('player-first-name');
            const lastNameInput = document.getElementById('player-last-name');
            if (firstNameInput && lastNameInput) {
                // Generate a full name and split it (simple approach)
                const fullName = nameGen.generateName(); // Use imported function
                const nameParts = fullName.split(' ');
                firstNameInput.value = nameParts[0] || '';
                lastNameInput.value = nameParts.slice(1).join(' ') || ''; // Handle potential multiple parts in last name
                console.log(`Randomized name to: ${firstNameInput.value} ${lastNameInput.value}`);
            }
        });
    }

    if (startNewGameConfirmButton) {
        startNewGameConfirmButton.addEventListener('click', () => {
            const firstNameInput = document.getElementById('player-first-name');
            const lastNameInput = document.getElementById('player-last-name');
            const toolSelect = document.getElementById('starting-tool');

            const firstName = firstNameInput ? firstNameInput.value.trim() : 'Adventurer';
            const lastName = lastNameInput ? lastNameInput.value.trim() : '';
            const startingTool = toolSelect ? toolSelect.value : 'stone_axe'; // Default to axe if not found

            // Combine first and last name for the 'name' property used internally
            const playerName = `${firstName} ${lastName}`.trim();

            console.log(`Starting new game for player: ${playerName} (First: ${firstName}, Last: ${lastName}), Tool: ${startingTool}`);

            // Pass all relevant options
            startGame({
                playerName: playerName, // Combined name
                playerFirstName: firstName,
                playerLastName: lastName,
                startingTool: startingTool
            });
        });
    }

    if (loadFileInput) {
        loadFileInput.addEventListener('change', async (event) => {
            const file = event.target.files[0];
            if (file) {
                loadStatus.textContent = `Loading ${file.name}...`;
                const reader = new FileReader();

                reader.onload = async (e) => {
                    const fileContent = e.target.result; // This is an ArrayBuffer
                    if (fileContent) {
                        try {
                            loadStatus.textContent = `Importing database from ${file.name}...`;
                            await importDatabase(new Uint8Array(fileContent)); // Pass Uint8Array to sql.js
                            loadStatus.textContent = `Database imported successfully. Starting game...`;
                            // Short delay to allow UI update before potentially heavy game start
                            await new Promise(resolve => setTimeout(resolve, 100));
                            startGame({ loadedSave: true }); // Indicate game is starting from a load
                        } catch (error) {
                            console.error("Error importing database:", error);
                            loadStatus.textContent = `Error importing database: ${error.message}`;
                        }
                    } else {
                        loadStatus.textContent = 'Error reading file content.';
                    }
                }; // End reader.onload

                reader.onerror = (e) => {
                    console.error("Error reading file:", e);
                    loadStatus.textContent = 'Error reading file.';
                }; // End reader.onerror

                reader.readAsArrayBuffer(file); // Read the file as ArrayBuffer

            } else { // If no file was selected
                loadStatus.textContent = '';
            }
        }); // End event listener
    } // End if (loadFileInput)

    // Initially show the homepage
    showScreen('homepage-screen');
});