/**
 * @module npcEngine
 * @description Manages Non-Player Characters (NPCs), including their creation, state, schedules, and actions.
 * Interacts with the database, timeEngine, jobEngine, survivalEngine, movementEngine, etc.
 */

// Import specific database functions
import { run, get, all } from '../data/database.js';
import { getTitleDefinition } from '../data/titlesData.js';
import { applySurvivalEffects } from './survivalEngine.js';
import { moveNpcTo } from './movementEngine.js';
import { processWorkShift } from './jobEngine.js'; // Import job processing function
// TODO: Import other engines/utils as needed (e.g., skillEngine, inventoryUtils)
// Example NPC states
const NPC_STATES = {
    IDLE: 'idle',
    WORKING: 'working',
    EATING: 'eating',
    SLEEPING: 'sleeping',
    TRAVELING: 'traveling', // Traveling to work, home, etc.
};
// --- State ---
let activeNpcs = {}; // In-memory store for active NPC data { npcId: npcStateObject }
let isInitialized = false;

// Default NPC attributes
const DEFAULT_NPC_HUNGER = 100.0;
const DEFAULT_NPC_THIRST = 100.0;
const DEFAULT_NPC_HEALTH = 100.0;

/**
 * Initializes the NPC Engine. Loads existing NPCs from the database.
 * @returns {Promise<void>}
 */
async function initializeNPCEngine() {
    console.log("Initializing NPC Engine...");
    activeNpcs = {}; // Clear previous state

    try {
        const npcRows = await all('SELECT * FROM NPCs'); // Use imported 'all'
        console.log(`Loading ${npcRows.length} NPCs from database...`);
        for (const row of npcRows) {
            // TODO: Load skills separately if needed
            activeNpcs[row.npc_id] = {
                id: row.npc_id,
                name: row.name,
                age: row.age,
                householdId: row.household_id,
                x: row.current_tile_x,
                y: row.current_tile_y,
                currentState: row.current_activity || NPC_STATES.IDLE,
                schedule: row.schedule ? JSON.parse(row.schedule) : null, // Assuming schedule is stored as JSON string
                hunger: row.hunger,
                thirst: row.thirst,
                health: row.health,
                title_id: row.title_id || 'commoner',
                skills: {}, // Placeholder - load skills separately
                inventory: {}, // Placeholder - load inventory separately
                // Add other relevant fields from DB
            };
        }
        isInitialized = true;
        console.log("NPC Engine Initialized successfully.");
    } catch (error) {
        console.error("Error initializing NPC Engine:", error);
        // Decide on error handling - proceed with empty state?
        isInitialized = false;
    }
}

/**
 * Creates a new NPC and adds them to the database.
 *
 * @param {object} db - The initialized SQLite database instance.
 * @param {object} initialData - Data for the new NPC (e.g., name, age, householdId, x, y, skills, title_id).
 * @returns {Promise<number|null>} - The ID of the newly created NPC, or null on failure.
 */
async function createNPC(initialData) {
    const {
        name = 'Unnamed NPC',
        age = 25,
        householdId = null,
        x = 50, // Default starting position
        y = 50,
        skills = {}, // Initial skills object { skillName: { level: 1, xp: 0 }, ... }
        title_id = 'commoner'
    } = initialData;
    console.log(`Attempting to create NPC: ${name}, Title: ${title_id}, Household: ${householdId}`);
    // TODO:
    try {
        // 1. Insert basic NPC data into the NPCs table
        const result = await run(
            `INSERT INTO NPCs (name, age, household_id, current_tile_x, current_tile_y, title_id, hunger, thirst, health, current_activity)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                name, age, householdId, x, y, title_id,
                DEFAULT_NPC_HUNGER, DEFAULT_NPC_THIRST, DEFAULT_NPC_HEALTH,
                NPC_STATES.IDLE
            ]
        );

        if (!result.lastID) {
            throw new Error("Failed to insert NPC into database.");
        }
        const newNpcId = result.lastID;
        console.log(` -> NPC created in DB with ID: ${newNpcId}`);

        // 2. Add to in-memory store
        activeNpcs[newNpcId] = {
            id: newNpcId,
            name: name,
            age: age,
            householdId: householdId,
            x: x,
            y: y,
            currentState: NPC_STATES.IDLE,
            schedule: null, // Default schedule
            hunger: DEFAULT_NPC_HUNGER,
            thirst: DEFAULT_NPC_THIRST,
            health: DEFAULT_NPC_HEALTH,
            title_id: title_id,
            skills: {}, // Initialize empty, save separately
            inventory: {}, // Initialize empty
        };

        // 3. Initialize skills in the skills table (if any provided)
        if (Object.keys(skills).length > 0) {
            // TODO: Implement saveSkillsToDb equivalent for NPCs or generalize playerEngine's one
            console.log(`TODO: Save initial skills for NPC ${newNpcId}:`, skills);
            // await saveNpcSkillsToDb(newNpcId, skills);
            activeNpcs[newNpcId].skills = skills; // Store in memory for now
        }

        return newNpcId;

    } catch (error) {
        console.error(`Error creating NPC "${name}":`, error);
        return null; // Indicate failure
    }
}

/**
 * Gets the state object for a specific NPC from the in-memory store.
 * @param {number} npcId - The ID of the NPC.
 * @returns {object | null} The NPC state object or null if not found/initialized.
 */
function getNpcState(npcId) {
    if (!isInitialized) {
        console.warn("NPC Engine not initialized.");
        return null;
    }
    return activeNpcs[npcId] || null;
}

/**
 * Gets a specific attribute for an NPC.
 * @param {number} npcId - The ID of the NPC.
 * @param {string} attributeName - The name of the attribute (e.g., 'name', 'hunger', 'x').
 * @returns {*} The value of the attribute, or undefined if NPC or attribute not found.
 */
function getNpcAttribute(npcId, attributeName) {
    const npcState = getNpcState(npcId);
    return npcState ? npcState[attributeName] : undefined;
}


/**
 * Updates one or more NPC attributes in memory and persists them to the database.
 * @param {number} npcId - The ID of the NPC to update.
 * @param {object} updates - An object with attributes to update (e.g., { hunger: 90, current_activity: 'working', x: 55 }).
 * @returns {Promise<boolean>} True if update was successful (memory and DB), false otherwise.
 */
async function updateNpcAttributes(npcId, updates) {
    const npcState = getNpcState(npcId);
    if (!npcState) {
        console.warn(`NPC Engine: Cannot update attributes for non-existent or uninitialized NPC ID ${npcId}.`);
        return false;
    }

    // Store original properties for potential revert
    const originalProperties = {};
     for (const key in updates) {
        if (Object.hasOwnProperty.call(updates, key) && Object.hasOwnProperty.call(npcState, key)) {
             originalProperties[key] = npcState[key];
        }
    }

    // Update in-memory state first
    Object.assign(npcState, updates);
    console.log(`Updated NPC ${npcId} attributes in memory:`, updates);

    // Persist to database
    try {
        const setClauses = [];
        const values = [];
        for (const key in updates) {
             if (Object.hasOwnProperty.call(updates, key)) {
                 let dbKey = null;
                 let value = updates[key];
                 switch (key) {
                     case 'id': continue; // Cannot update primary key
                     case 'x': dbKey = 'current_tile_x'; break;
                     case 'y': dbKey = 'current_tile_y'; break;
                     case 'currentState': dbKey = 'current_activity'; break;
                     case 'householdId': dbKey = 'household_id'; break;
                     case 'title_id': dbKey = 'title_id'; break; // Added title_id
                     // Map other direct properties to their column names
                     case 'name':
                     case 'age':
                     case 'hunger':
                     case 'thirst':
                     case 'health':
                         dbKey = key; // Column name matches JS key
                         break;
                    case 'targetX': // Add case for targetX
                         dbKey = 'targetX';
                         break;
                    case 'targetY': // Add case for targetY
                         dbKey = 'targetY';
                         break;
                    case 'schedule':
                         dbKey = 'schedule';
                         // Ensure value is stringified only if it's an object
                         value = (value !== null && typeof value === 'object') ? JSON.stringify(value) : null;
                         break;
                     case 'skills': // Skills saved separately
                     case 'inventory': // Inventory saved separately
                         continue;
                     default:
                         console.warn(`Skipping update for unhandled NPC attribute: ${key}`);
                         continue;
                 }
                 if (dbKey) {
                    setClauses.push(`${dbKey} = ?`);
                    values.push(value);
                 }
             }
        }

        if (setClauses.length === 0) {
            console.log(`No valid NPC attributes to update in DB for NPC ${npcId}.`);
            return true; // Memory update succeeded, nothing to persist
        }

        values.push(npcId); // Add npc_id for WHERE clause
        const sql = `UPDATE NPCs SET ${setClauses.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE npc_id = ?`;
        const result = await run(sql, values); // Use imported run

        if (result.changes > 0) {
            console.log(`Successfully persisted NPC update for ID ${npcId} to DB.`);
            return true;
        } else {
            console.warn(`No rows updated in DB for NPC ID ${npcId}. NPC might not exist?`);
            Object.assign(npcState, originalProperties); // Revert memory change
            console.warn(`Reverted in-memory NPC update for ${npcId} as DB update failed.`);
            return false;
        }

    } catch (error) {
        console.error(`Error persisting NPC update for ID ${npcId} to database:`, error);
        Object.assign(npcState, originalProperties); // Revert memory change
        console.warn(`Reverted in-memory NPC update for ${npcId} due to DB error.`);
        return false;
    }
}

/**
 * Sets the current state (activity) of an NPC. Wrapper around updateNpcAttributes.
 * @param {number} npcId - The ID of the NPC to update.
 * @param {string} newState - The new state from NPC_STATES.
 * @returns {Promise<boolean>}
 */
async function setNpcState(npcId, newState) {
    console.log(`Setting NPC ${npcId} state to ${newState}`);
    return updateNpcAttributes(npcId, { currentState: newState });
}

/**
 * Processes a simulation tick for a specific NPC or all NPCs.
 * Determines the NPC's action based on their current state, schedule, needs, and time of day.
 * This would typically be called by the timeEngine for each active NPC.
 * @param {object} engines - References to other game engines (passed during initialization or retrieved globally).
 * @param {object} utils - References to utility modules (passed during initialization or retrieved globally).
 * @param {number} npcId - The ID of the NPC to process.
 * @param {object} currentTime - Current game time information (from timeEngine).
 * @returns {Promise<void>}
 */
async function processNpcTick(engines, utils, npcId, currentTime) { // Removed db param
    console.log(`Processing tick for NPC ${npcId} at time ${currentTime?.timeString || 'N/A'}`);
    // TODO: Implement the core NPC decision logic:
    // 1. Get NPC data from memory
    const npcState = getNpcState(npcId);
    if (!npcState) {
        console.warn(`processNpcTick: Could not find state for NPC ${npcId}. Skipping.`);
        return;
    }
    // 2. Apply Survival Effects & Check Needs
    const survivalOutcome = applySurvivalEffects(npcState); // Modifies npcState directly
    if (survivalOutcome.needsChanged || survivalOutcome.healthChanged) {
        // Persist changes
        const updatesToPersist = {};
        if (survivalOutcome.needsChanged) {
            updatesToPersist.hunger = npcState.hunger;
            updatesToPersist.thirst = npcState.thirst;
        }
        if (survivalOutcome.healthChanged) {
            updatesToPersist.health = npcState.health;
        }
        updateNpcAttributes(npcId, updatesToPersist)
            .catch(err => console.error(`Failed to persist NPC ${npcId} survival updates:`, err));
    }

    // Handle NPC death
    if (survivalOutcome.isDead) {
        console.log(`NPC ${npcId} (${npcState.name}) has died.`);
        // TODO: Implement NPC death handling:
        // - Remove from activeNpcs
        // - Remove from database? Or mark as dead?
        // - Drop inventory?
        // - Trigger any relevant events (e.g., funeral, inheritance)
        // For now, just remove from active list to stop processing
        delete activeNpcs[npcId];
        // TODO: Persist removal/dead status to DB
        return; // Stop further processing for this dead NPC
    }

    // If needs are critical (e.g., very low hunger/thirst), prioritize fulfilling them
    // TODO: Add logic here to check npcState.hunger/thirst levels and potentially override schedule
    // if (npcState.hunger < 20) { /* Set state to EATING/TRAVELING to food */ }
    // 3. Check Schedule & Determine Target State (Basic Example)
    let targetState = NPC_STATES.IDLE; // Default state
    let targetLocation = null; // { x, y } for TRAVELING state
    const schedule = npcState.schedule; // Assuming schedule is loaded and parsed { workStartHour, workEndHour, workLocation: {x, y}, homeLocation: {x, y} }
    const currentHour = currentTime.hour;
    const isAtHome = schedule?.homeLocation && npcState.x === schedule.homeLocation.x && npcState.y === schedule.homeLocation.y;
    const isAtWork = schedule?.workLocation && npcState.x === schedule.workLocation.x && npcState.y === schedule.workLocation.y;

    // Basic Sleep Schedule (e.g., 22:00 - 06:00)
    if (currentHour >= 22 || currentHour < 6) {
        if (isAtHome) {
            targetState = NPC_STATES.SLEEPING;
        } else if (schedule?.homeLocation) {
            targetState = NPC_STATES.TRAVELING;
            targetLocation = schedule.homeLocation;
        } else {
            targetState = NPC_STATES.IDLE; // No home defined? Stay idle.
        }
    }
    // Basic Work Schedule (Example: 8:00 - 17:00)
    else if (schedule?.workLocation && currentHour >= schedule.workStartHour && currentHour < schedule.workEndHour) {
        if (isAtWork) {
            targetState = NPC_STATES.WORKING;
        } else {
            targetState = NPC_STATES.TRAVELING;
            targetLocation = schedule.workLocation;
        }
    }
    // TODO: Add meal times, other activities (e.g., travel home if not work/sleep time)
    else { // Default: Go home if not working or sleeping? Or stay idle?
        if (!isAtHome && schedule?.homeLocation) {
             targetState = NPC_STATES.TRAVELING;
             targetLocation = schedule.homeLocation;
        } else {
             targetState = NPC_STATES.IDLE;
        }
    }

    // 4. Update State and Target Location if Changed
    const stateChanged = npcState.currentState !== targetState;
    const locationChanged = targetLocation && (npcState.targetX !== targetLocation.x || npcState.targetY !== targetLocation.y);

    if (stateChanged || locationChanged) {
        const updates = {};
        if (stateChanged) {
            updates.currentState = targetState;
            console.log(`NPC ${npcId} changing state from ${npcState.currentState} to ${targetState} based on time/schedule.`);
        }
        if (targetLocation) {
            updates.targetX = targetLocation.x;
            updates.targetY = targetLocation.y;
            if (locationChanged) console.log(`NPC ${npcId} setting target location to (${targetLocation.x}, ${targetLocation.y}) for ${targetState}.`);
        } else {
            // Clear target location if not traveling
            updates.targetX = null;
            updates.targetY = null;
        }

        await updateNpcAttributes(npcId, updates);
        // Update local state to match
        Object.assign(npcState, updates);
    }

    // 5. Process Current State Action
    switch (npcState.currentState) {
        case NPC_STATES.TRAVELING:
            if (npcState.targetX !== null && npcState.targetY !== null) {
                // Attempt to move one step towards the target (or use pathfinding later)
                // For now, just call moveNpcTo directly - assumes single step movement logic inside movementEngine for now
                // TODO: Implement pathfinding and step-by-step movement.
                const moveResult = await moveNpcTo(npcId, npcState.targetX, npcState.targetY);
                // If movement succeeded and NPC reached target, potentially change state (e.g., to IDLE, WORKING, SLEEPING)
                // This check needs refinement based on how moveNpcTo signals arrival.
                if (moveResult && npcState.x === npcState.targetX && npcState.y === npcState.targetY) {
                    console.log(`NPC ${npcId} arrived at target (${npcState.targetX}, ${npcState.targetY}). Setting state to IDLE.`);
                    await setNpcState(npcId, NPC_STATES.IDLE); // Revert to IDLE after arrival (or determine next state)
                    // Clear target location
                     await updateNpcAttributes(npcId, { targetX: null, targetY: null });
                }
            } else {
                console.warn(`NPC ${npcId} is in TRAVELING state but has no target coordinates.`);
                await setNpcState(npcId, NPC_STATES.IDLE); // Revert to IDLE if no target
            }
            // e.g., engines.movement.moveNpcTowards(npcId, npcState.targetX, npcState.targetY);
            break;
        case NPC_STATES.WORKING:
            // Call the refactored jobEngine function
            await processWorkShift('NPC', npcId);
            // TODO: Pass necessary engine/util references if processWorkShift requires them later
            break;
        case NPC_STATES.SLEEPING:
            // NPC is sleeping. For now, no specific action needed per tick.
            // TODO: Implement fatigue recovery logic here.
            // console.log(`NPC ${npcId} is sleeping.`); // Can be noisy
            break;
        case NPC_STATES.EATING:
            // TODO: Consume food from inventory (npcState.inventory or household inventory).
            break;
        case NPC_STATES.IDLE:
        default:
            // Do nothing for now, or maybe wander randomly?
            break;
    }
 }

/**
 * Gets the full definition object for a given NPC's current title.
 * @param {number} npcId - The ID of the NPC.
 * @returns {Promise<object | undefined>} The title definition from titlesData.js or undefined.
 */
async function getNpcTitleDetails(npcId) {
    const titleId = getNpcAttribute(npcId, 'title_id');
    if (titleId) {
        return getTitleDefinition(titleId);
    } else {
        console.warn(`Could not find title_id attribute for NPC ${npcId}`);
        return undefined;
    }
    // Removed direct DB access attempt
}

/**
 * Gets all active NPC IDs.
 * @returns {Array<number>} An array of NPC IDs currently loaded in memory.
 */
function getActiveNpcIds() {
    if (!isInitialized) return [];
    return Object.keys(activeNpcs).map(id => parseInt(id, 10));
}

export {
    initializeNPCEngine,
    createNPC,
    getNpcState,
    getNpcAttribute,
    updateNpcAttributes,
    setNpcState,
    processNpcTick,
    getNpcTitleDetails,
    getActiveNpcIds, // Export new function
    NPC_STATES,
    _resetStateForTest // Export for testing only
};

/**
 * Resets the internal state of the engine for testing purposes.
 * WARNING: Do not call this in production code.
 */
function _resetStateForTest() {
    activeNpcs = {};
    isInitialized = false;
    console.log("DEBUG: NPC engine state reset for test.");
}