/**
 * @module npcEngine
 * @description Manages Non-Player Characters (NPCs), including their creation, state, schedules, and actions.
 * Interacts with the database, timeEngine, jobEngine, survivalEngine, movementEngine, etc.
 */

// Example NPC states
const NPC_STATES = {
    IDLE: 'idle',
    WORKING: 'working',
    EATING: 'eating',
    SLEEPING: 'sleeping',
    TRAVELING: 'traveling', // Traveling to work, home, etc.
};

/**
 * Initializes the NPC Engine.
 * @param {object} db - The initialized SQLite database instance.
 * @param {object} engines - References to other game engines (timeEngine, jobEngine, etc.).
 */
function initializeNPCEngine(db, engines) {
    console.log("NPC Engine Initialized");
    // Store references if needed
    // this.db = db;
    // this.engines = engines;
    // this.npcs = {}; // Could load active NPCs into memory
}

/**
 * Creates a new NPC and adds them to the database.
 *
 * @param {object} db - The initialized SQLite database instance.
 * @param {object} initialData - Data for the new NPC (e.g., name, startingHouseholdId, initialSkills).
 * @returns {Promise<number>} - The ID of the newly created NPC.
 */
async function createNPC(db, initialData) {
    const { name = 'Unnamed NPC', householdId = null, skills = {} } = initialData;
    console.log(`Creating NPC: ${name}, Household: ${householdId}`);
    // TODO:
    // 1. Insert basic NPC data into the NPCs table (name, householdId, currentState='IDLE', etc.).
    // 2. Get the new NPC's ID.
    // 3. Initialize default needs (hunger, thirst) - potentially via survivalEngine or direct DB insert.
    // 4. Initialize skills in the skills table (linking to NPC ID).
    // 5. Return the new NPC ID.

    // Placeholder:
    const newNpcId = Math.floor(Math.random() * 1000); // Replace with actual DB insert ID
    console.log(` -> NPC created with ID: ${newNpcId}`);
    return newNpcId;
}

/**
 * Updates the state of a specific NPC.
 *
 * @param {object} db - The initialized SQLite database instance.
 * @param {number} npcId - The ID of the NPC to update.
 * @param {string} newState - The new state from NPC_STATES.
 * @param {object} [stateData={}] - Optional data related to the state (e.g., target destination for TRAVELING).
 * @returns {Promise<void>}
 */
async function setNpcState(db, npcId, newState, stateData = {}) {
    console.log(`Setting NPC ${npcId} state to ${newState}`, stateData);
    // TODO:
    // 1. Update the NPC's currentState and stateData in the database.
    // 2. Potentially update in-memory representation if used.
}

/**
 * Processes a simulation tick for a specific NPC or all NPCs.
 * Determines the NPC's action based on their current state, schedule, needs, and time of day.
 * This would typically be called by the timeEngine for each active NPC.
 *
 * @param {object} db - The initialized SQLite database instance.
 * @param {object} engines - References to other game engines.
 * @param {object} utils - References to utility modules.
 * @param {number} npcId - The ID of the NPC to process.
 * @param {object} currentTime - Current game time information (from timeEngine).
 * @returns {Promise<void>}
 */
async function processNpcTick(db, engines, utils, npcId, currentTime) {
    console.log(`Processing tick for NPC ${npcId} at time ${currentTime?.timeString || 'N/A'}`);
    // TODO: Implement the core NPC decision logic:
    // 1. Get NPC data (current state, job, needs, schedule, location) from DB/memory.
    // 2. Check needs (hunger, thirst, fatigue) via survivalEngine. If critical, prioritize fulfilling need (e.g., EATING, SLEEPING).
    // 3. Check schedule based on currentTime:
    //    - If work time & has job:
    //        - If not at work location, set state to TRAVELING (to work).
    //        - If at work location, set state to WORKING, call jobEngine.processWorkShift().
    //    - If meal time:
    //        - If not at home/tavern, set state to TRAVELING (to food source).
    //        - If at food source, set state to EATING (consume food from inventory via inventoryUtils).
    //    - If sleep time:
    //        - If not at home, set state to TRAVELING (to home).
    //        - If at home, set state to SLEEPING.
    //    - Else (free time):
    //        - Set state to IDLE or potentially other activities (socializing - future).
    // 4. If state is TRAVELING, call movementEngine to move towards target. Update state when destination reached.
    // 5. Update NPC state in DB using setNpcState().
}

export { initializeNPCEngine, createNPC, setNpcState, processNpcTick, NPC_STATES };