// src/engines/playerEngine.js
// Manages the player's state, including attributes, needs, skills, etc.
// Import specific database functions instead of getDb
import { run, get, all } from '../data/database.js'; // Removed 'prepare'
import { getTitleDefinition } from '../data/titlesData.js'; // Import title helper
import { addItem } from '../utils/inventoryUtils.js'; // Import inventory function
// TODO: Integrate with skillEngine, survivalEngine, etc.

console.log("Player Engine Module Loaded");
console.log("Player Engine Module Loaded");

// --- Constants ---
const STARTING_HUNGER = 100.0;
const STARTING_THIRST = 100.0;
const STARTING_HEALTH = 100.0;
const MAX_NEED = 100.0; // Max value for needs like hunger/thirst/health
const DEFAULT_START_X = 50; // Center of a default 100x100 map
const DEFAULT_START_Y = 50;
// --- Player State ---
let playerState = {
    id: null, // Will be loaded from DB
    name: "Adventurer", // Default name
    surname: "", // Added
    gender: "unknown", // Added
    title: "", // DEPRECATED - Use title_id instead. Keep for potential compatibility during transition? Or remove? Let's remove for clarity.
    title_id: 'commoner', // Default title ID
    x: DEFAULT_START_X, // Corrected starting X
    y: DEFAULT_START_Y, // Corrected starting Y
    hunger: STARTING_HUNGER,
    thirst: STARTING_THIRST,
    health: STARTING_HEALTH, // Added
    // TODO: Add tiredness, armor etc. later
    skills: {}, // Initialized below
    inventory: {}, // Placeholder
    householdId: null, // Will be set/loaded
    currentMountId: null, // ID of the currently active mount (e.g., 'horse'), null if none
    // title: "", // Removed deprecated field
};

let isInitialized = false;

// --- Initialization ---

/**
 * Initializes the player engine, loading the player's state.
 * For now, it just sets default values. Later, it should load from the DB.
 * @param {object} [initialData={}] - Optional initial data to override defaults.
 *                                  This should include data from character creation
 *                                  if a new player is being made.
 * @returns {Promise<void>}
 */
async function initializePlayer(initialData = { playerFirstName: null, playerLastName: null, startingTool: null }) { // Add defaults for new options
    console.log("Initializing player...");

    // Reset to defaults first
    playerState = {
        id: null,
        id: null,
        name: "Adventurer",
        surname: "",
        gender: "unknown",
        // title: "", // Removed deprecated field
        title_id: 'commoner', // Add default title_id
        x: DEFAULT_START_X,
        y: DEFAULT_START_Y,
        hunger: STARTING_HUNGER,
        thirst: STARTING_THIRST,
        health: STARTING_HEALTH,
        skills: { // Initialize default skills
            farming: { level: 1, xp: 0 },
            carpentry: { level: 1, xp: 0 },
            masonry: { level: 1, xp: 0 },
            mining: { level: 1, xp: 0 },
            // Add other skills from skillsData.js if needed
        },
        inventory: {},
        householdId: null,
        ...initialData, // Apply overrides AFTER defaults are set
        currentMountId: initialData.currentMountId || null, // Ensure mount ID is handled
        // Explicitly add startingTool if provided, as it's not part of the default structure
        startingTool: initialData.startingTool || null
    };

    try {
        // Database functions are imported directly
        // Assume database.js handles its own initialization check

        // --- Load Player Data ---
        // For MVP, assume only one player record exists or load the first one.
        // A proper implementation might involve selecting based on a user session or save file.
        const playerData = await get('SELECT * FROM Player ORDER BY player_id ASC LIMIT 1'); // Use imported get

        // Check specifically for a valid player_id to ensure we loaded a real player
        if (playerData && playerData.player_id !== null && playerData.player_id !== undefined) {
            console.log("Loading existing player data from database...");
            console.log('DEBUG: Loaded playerData:', playerData); // Add log to inspect data
            playerState.id = playerData.player_id;
            playerState.name = playerData.name;
            playerState.surname = playerData.surname || ""; // Handle potential nulls from DB
            playerState.gender = playerData.gender || "unknown";
            // playerState.title = playerData.title || ""; // Removed deprecated field
            playerState.title_id = playerData.title_id || 'commoner'; // Load title_id, default if null
            playerState.x = playerData.current_tile_x;
            playerState.y = playerData.current_tile_y;
            playerState.hunger = playerData.hunger;
            playerState.thirst = playerData.thirst;
            playerState.health = playerData.health;
            playerState.householdId = playerData.household_id;
            playerState.currentMountId = playerData.current_mount_id; // Load mount ID
            // Note: Skills are loaded separately below. Inventory might be too.

        } else {
            // --- Create New Player Data ---
            console.log("No player data found in DB. Creating new player entry...");
            // Use the default state already set up (including initialData overrides)
            // Ensure the data being inserted reflects any initialData provided (e.g., from char creation)
            // Use specific initialData fields if provided for new player creation
            const firstName = initialData.playerFirstName || playerState.name; // Use provided first name or default
            const lastName = initialData.playerLastName || playerState.surname; // Use provided last name or default
            const startingTool = initialData.startingTool; // Get starting tool

            console.log(` -> Creating new player with Name: ${firstName}, Surname: ${lastName}, Starting Tool: ${startingTool}`);

            const insertResult = await run( // Use imported run
                `INSERT INTO Player (name, surname, gender, title_id, current_tile_x, current_tile_y, hunger, thirst, health, household_id, current_mount_id)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    firstName, lastName, // Use separate first/last names
                    playerState.gender, playerState.title_id,
                    playerState.x, playerState.y, playerState.hunger, playerState.thirst, playerState.health,
                    playerState.householdId, // This might be null initially
                    playerState.currentMountId
                ]
            );

            if (insertResult.lastID) {
                playerState.id = insertResult.lastID;
                console.log(`DEBUG: New player created with ID: ${playerState.id}. Name: ${firstName} ${lastName}.`);
                // Update in-memory state with the actual names used
                playerState.name = firstName;
                playerState.surname = lastName;

                // Now save the initial skills for the new player
                await saveSkillsToDb(playerState.id, playerState.skills);

                // Add starting tool to inventory
                if (startingTool) {
                    console.log(`Adding starting tool '${startingTool}' to player ${playerState.id}'s inventory.`);
                    try {
                        const added = await addItem('Player', playerState.id, startingTool, 1);
                        if (!added) {
                            console.error(`Failed to add starting tool ${startingTool} to inventory for player ${playerState.id}.`);
                        }
                    } catch (invError) {
                        console.error(`Error adding starting tool ${startingTool} to inventory:`, invError);
                    }
                }
            } else {
                console.error("Failed to insert new player into database.");
                // Proceed with default in-memory state?
            }
        }

        // --- Load Skills Data (if player exists) ---
        if (playerState.id) {
            const skillData = await all('SELECT skill_name, level, experience FROM Skills WHERE owner_id = ? AND owner_type = ?', [playerState.id, 'Player']); // Use imported all
            if (skillData && skillData.length > 0) {
                 console.log(`Loading ${skillData.length} skills for player ID ${playerState.id}...`);
                 playerState.skills = {}; // Clear default skills before loading
                 skillData.forEach(skill => {
                     playerState.skills[skill.skill_name] = { level: skill.level, xp: skill.experience };
                 });
            } else if (playerData) { // Only warn if player existed but had no skills
                 console.warn(`No skills found in DB for existing player ID ${playerState.id}. Keeping defaults (if any).`);
                 // If we loaded an existing player but found no skills, should we save the defaults?
                 // For now, we keep the defaults that were set earlier.
                 // await saveSkillsToDb(db, playerState.id, playerState.skills); // Optionally save defaults here
            }
        }

        // TODO: Load inventory if needed

    } catch (error) {
        console.error("Error during player initialization from database:", error);
        // Keep the default state initialized earlier as a fallback
    }

    isInitialized = true;
    console.log(`Player initialized: ${playerState.name}`);
}

// --- Accessors ---

/**
 * Gets the current player state object.
 * @returns {object | null} The player state object or null if not initialized.
 */
function getPlayerState() {
    if (!isInitialized) {
        console.warn("Player Engine not initialized. Call initializePlayer() first.");
        return null;
    }
    // Return a copy to prevent direct modification? Or allow direct modification?
    // For now, return direct reference. Could change later if needed.
    return playerState;
}

/**
 * Gets a specific player attribute.
 * @param {string} attributeName - The name of the attribute (e.g., 'name', 'hunger').
 * @returns {*} The value of the attribute, or undefined if not found or not initialized.
 */
function getPlayerAttribute(attributeName) {
    if (!isInitialized) {
        console.warn("Player Engine not initialized.");
        return undefined;
    }
    return playerState[attributeName];
}

/**
 * Gets the player's current skill level and XP.
 * @param {string} skillName - The name of the skill.
 * @returns {{level: number, xp: number} | null} Skill details or null if skill doesn't exist.
 */
function getSkill(skillName) {
     if (!isInitialized) {
        console.warn("Player Engine not initialized.");
        return null;
    }
    return playerState.skills[skillName] || { level: 0, xp: 0 }; // Return default if skill not present
}

/**
 * Gets the full definition object for the player's current title.
 * @returns {object | undefined} The title definition from titlesData.js or undefined.
 */
function getPlayerTitleDetails() {
    if (!isInitialized) {
        console.warn("Player Engine not initialized.");
        return undefined;
    }
    const titleId = playerState.title_id;
    return getTitleDefinition(titleId);
}

// --- Modifiers ---

/**
 * Updates one or more player attributes in memory and persists them to the database.
 * @param {object} updates - An object with attributes to update (e.g., { hunger: 90, name: 'NewName', x: 55 }).
 * @returns {Promise<boolean>} True if update was successful (memory and DB), false otherwise.
 */
async function updatePlayerAttributes(updates) {
    if (!isInitialized || !playerState.id) {
        console.warn("Player Engine not initialized or player ID missing. Cannot update attributes.");
        return false;
    }

    // Store original properties for potential revert
    const originalProperties = {};
     for (const key in updates) {
        if (Object.hasOwnProperty.call(updates, key) && Object.hasOwnProperty.call(playerState, key)) {
             originalProperties[key] = playerState[key];
        }
    }

    // Update in-memory state first, iterating explicitly
    // Modify the existing playerState object directly
    for (const key in updates) {
        if (Object.hasOwnProperty.call(updates, key) && Object.hasOwnProperty.call(playerState, key)) {
            // console.log(`DEBUG: Updating playerState[${key}] from ${playerState[key]} to ${updates[key]}`);
            playerState[key] = updates[key]; // Modify directly
        } else {
            // console.log(`DEBUG: Skipping update for key: ${key} (hasOwnProperty checks failed)`);
        }
    }
    console.log("Updated player attributes in memory:", updates);

    // Persist to database
    try {
        // Use imported 'run' function directly
        // Assume database.js handles initialization check internally now

        // Build SET clause dynamically, mapping JS names to DB column names
        const setClauses = [];
        const values = [];
        for (const key in updates) {
             if (Object.hasOwnProperty.call(updates, key)) {
                 let dbKey = null; // Initialize dbKey to null
                 let value = updates[key];
                 switch (key) {
                     case 'id': continue; // Cannot update primary key
                     case 'x': dbKey = 'current_tile_x'; break;
                     case 'y': dbKey = 'current_tile_y'; break;
                     case 'householdId': dbKey = 'household_id'; break;
                     // Map other direct properties to their column names
                     case 'name':
                     case 'surname':
                     case 'gender':
                     // case 'title': // Removed deprecated field
                     case 'title_id': // Add title_id mapping
                     case 'hunger':
                     case 'thirst':
                     case 'health':
                     // Add 'armor' here if it becomes a direct column
                         dbKey = key; // Column name matches JS key
                         break;
                    case 'currentMountId':
                         dbKey = 'current_mount_id'; // Map to DB column
                         break;
                     case 'skills': // Skills are saved separately
                     case 'inventory': // Inventory saved separately
                         continue;
                     default:
                         console.warn(`Skipping update for unhandled player attribute: ${key}`);
                         continue; // Skip keys not explicitly handled
                 }
                 // Ensure dbKey was set (i.e., it's a valid column to update)
                 if (dbKey) {
                    setClauses.push(`${dbKey} = ?`);
                    values.push(value);
                 }
             }
        }

        if (setClauses.length === 0) {
            console.log("No valid player attributes to update in DB.");
            return true; // Memory update succeeded, nothing to persist
        }

        // Add player ID for WHERE clause
        values.push(playerState.id);

        const sql = `UPDATE Player SET ${setClauses.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE player_id = ?`;
        const result = await run(sql, values); // Use imported run

        if (result.changes > 0) {
            console.log(`Successfully persisted player update for ID ${playerState.id} to DB.`);
            return true;
        } else {
            console.warn(`No rows updated in DB for player ID ${playerState.id}. Player might not exist?`);
            Object.assign(playerState, originalProperties); // Revert memory change
            console.warn(`Reverted in-memory player update as DB update failed.`);
            return false;
        }

    } catch (error) {
        console.error(`Error persisting player update for ID ${playerState.id} to database:`, error);
        Object.assign(playerState, originalProperties); // Revert memory change
        console.warn(`Reverted in-memory player update due to DB error.`);
        return false;
    }
}

/**
 * Modifies a player's need (e.g., hunger, thirst) ensuring it stays within bounds.
 * @param {string} need - The name of the need ('hunger', 'thirst').
 * @param {number} amount - The amount to change by (can be negative).
 */
function modifyNeed(need, amount) {
    if (!isInitialized || playerState[need] === undefined) {
        console.warn(`Cannot modify need "${need}". Player engine not initialized or need does not exist.`);
        return;
    }
    playerState[need] += amount;
    // Clamp values
    if (playerState[need] > MAX_NEED) playerState[need] = MAX_NEED;
    if (playerState[need] < 0) playerState[need] = 0;

    console.log(`Need ${need} changed by ${amount} to ${playerState[need]}`);
    // Persist the change using the existing update function
    updatePlayerAttributes({ [need]: playerState[need] });
}

/**
 * Adds experience to a skill and handles level ups.
 * @param {string} skillName
 * @param {number} xpAmount
 */
function addSkillXP(skillName, xpAmount) {
     if (!isInitialized) {
        console.warn("Player Engine not initialized. Cannot add XP.");
        return;
    }
    // Check if skill exists and initialize if not
    if (!playerState.skills[skillName]) {
        playerState.skills[skillName] = { level: 1, xp: 0 };
    }
    const skill = playerState.skills[skillName];

    // Return early if already at max level (e.g., 100)
    if (skill.level >= 100) {
         console.log(`${skillName} is already at max level (100). No XP gained.`);
         return; // Exit if already max level
    }

    // Add XP
    skill.xp += xpAmount;
    console.log(`Added ${xpAmount} XP to ${skillName}. New total XP before level check: ${skill.xp}`);

    // --- Level Up Logic ---
    // Example: XP needed = current level * 100
    // TODO: Make this formula configurable, potentially per skill in skillsData.js
    const calculateXpForNextLevel = (level) => level * 100;

    let xpNeeded = calculateXpForNextLevel(skill.level);
    // Loop while XP is sufficient AND level is below max
    while (skill.xp >= xpNeeded && skill.level < 100) {
        skill.level++;
        skill.xp -= xpNeeded; // Subtract cost of the level gained
        console.log(`LEVEL UP! ${skillName} reached level ${skill.level}!`);
        // TODO: Add potential notifications or effects for level up

        // Check if max level reached *after* leveling up
        if (skill.level >= 100) {
             skill.xp = 0; // Cap XP at max level
             console.log(`${skillName} reached max level (100).`);
             break; // Exit loop immediately upon reaching max level
        }

        // Calculate XP needed for the *next* level for the loop condition
        xpNeeded = calculateXpForNextLevel(skill.level);
    }
    // --- End Level Up Logic ---

     // Persist the skill change using the existing helper function
     // Ensure we have a DB connection and player ID before attempting to save
     if (playerState.id) {
         // Call saveSkillsToDb directly, assuming DB is ready via database.js init
         saveSkillsToDb(playerState.id, { [skillName]: skill })
             .catch(error => {
                  console.error("Error saving skill XP change:", error);
                  // TODO: Potentially revert in-memory skill change on DB error?
             });
     } else {
         console.warn("Cannot save skill XP change: Player ID not set.");
     }
}

/**
 * Saves player skills to the database using imported prepare/run functions.
 * @param {number} playerId - The player's ID.
 * @param {object} skillsObject - The skills object to save (e.g., playerState.skills).
 */
async function saveSkillsToDb(playerId, skillsObject) {
    if (!playerId || !skillsObject) return;
    console.log(`Saving skills for player ID ${playerId}...`);

    // Use INSERT OR REPLACE (UPSERT) to add/update skills via individual run calls
    const sql = `
        INSERT INTO Skills (owner_id, owner_type, skill_name, level, experience)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(owner_id, owner_type, skill_name) DO UPDATE SET
        level = excluded.level,
        experience = excluded.experience,
        updated_at = CURRENT_TIMESTAMP
    `;

    try {
        for (const skillName in skillsObject) {
            if (Object.hasOwnProperty.call(skillsObject, skillName)) {
                const skill = skillsObject[skillName];
                console.log(`DEBUG: Saving skill ${skillName} with level ${skill.level}, xp ${skill.xp}`);
                await run(sql, [playerId, 'Player', skillName, skill.level, skill.xp]); // Use imported run
            }
        }
        console.log("Skills saved successfully (individual statements).");
    } catch (error) {
        console.error("Error saving skills to database:", error);
        // Consider how to handle partial failures if needed
        throw error; // Re-throw error
    }
    // No stmt.finalize() needed when using run directly
}

/**
 * Resets the player engine state for testing purposes.
 * WARNING: Do not call this in production code.
 */
function _resetState() {
     playerState = { // Reset to initial structure, not necessarily defaults
        id: null, name: "DefaultReset", surname: "", gender: "unknown", title_id: "commoner", // Use title_id
        x: DEFAULT_START_X, y: DEFAULT_START_Y,
        hunger: STARTING_HUNGER, thirst: STARTING_THIRST, health: STARTING_HEALTH,
        skills: {}, inventory: {}, householdId: null, currentMountId: null,
    };
    isInitialized = false;
    console.log("DEBUG: Player engine state reset.");
}

/**
 * Gets the internal player state directly for testing.
 * WARNING: Do not call this in production code.
 * @returns {object} The internal playerState object.
 */
function _getPlayerState() {
    // Return a shallow copy to potentially avoid state issues in tests
    return { ...playerState };
}

/**
 * Sets the internal isInitialized flag for testing.
 * WARNING: Do not call this in production code.
 * @param {boolean} value
 */
function _setIsInitialized(value) {
    isInitialized = value;
}


// --- Exports ---
 /**
  * Sets the internal player state ID directly for testing.
  * WARNING: Do not call this in production code.
  * @param {number | null} id
  */
 function _setPlayerStateIdForTest(id) {
     if (playerState) {
         playerState.id = id;
     }
 }
 
export {
    initializePlayer,
    getPlayerState,
    getPlayerAttribute,
    getSkill,
    getPlayerTitleDetails, // Export new function
    updatePlayerAttributes,
    modifyNeed,
    addSkillXP,
    // Constants if needed externally
    MAX_NEED,
    _getPlayerState,
    _resetState, // Export for testing
    _setIsInitialized, // Export for testing
    _setPlayerStateIdForTest, // Export for testing
};