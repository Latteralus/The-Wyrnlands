// src/engines/survivalEngine.js
// Manages player survival needs like hunger and thirst.

// Removed direct playerEngine imports - functions will operate on passed entity state
// import { modifyNeed, getPlayerAttribute, updatePlayerAttributes } from './playerEngine.js';
// Removed timeEngine import
// import { registerDailyCallback } from './timeEngine.js';
// Removed uiManager import - death handling should be external
// import { showGameOver } from '../managers/uiManager.js';

// TODO: Consider environmental effects (temperature, weather) on needs.
// TODO: Consider effects of actions (running, working) on needs.

console.log("Survival Engine Module Loaded");

// --- Constants ---
const DAILY_HUNGER_DECAY = 10.0;
const DAILY_THIRST_DECAY = 15.0;
const HEALTH_DAMAGE_PER_DAY = 5.0; // Damage if hunger or thirst is zero

// --- Initialization ---

function initializeSurvivalEngine() {
    console.log("Initializing Survival Engine...");
    // No longer registering callback here; logic will be called from the main game tick or NPC tick processing.
    console.log("Survival Engine initialized and registered daily callback.");
}

// --- Decay Logic ---

/**
 * Applies survival effects (hunger/thirst decay, starvation/dehydration damage) to a given entity state object.
 * Note: This function MODIFIES the passed-in entityState object directly.
 * The caller is responsible for persisting these changes using the appropriate engine's update function (e.g., updatePlayerAttributes, updateNpcAttributes).
 * @param {object} entityState - The state object of the entity (Player or NPC). Must include hunger, thirst, health properties.
 * @returns {{needsChanged: boolean, healthChanged: boolean, healthDamage: number, isDead: boolean}} - Object indicating the outcome.
 */
function applySurvivalEffects(entityState) {
    // Input validation
    if (!entityState || typeof entityState.hunger !== 'number' || typeof entityState.thirst !== 'number' || typeof entityState.health !== 'number') {
        console.error("Survival Engine: Invalid entityState passed to applySurvivalEffects.", entityState);
        return { needsChanged: false, healthChanged: false, healthDamage: 0, isDead: false };
    }

    const initialHunger = entityState.hunger;
    const initialThirst = entityState.thirst;
    const initialHealth = entityState.health;
    // console.log(`Applying survival effects to entity (ID: ${entityState.id || 'Unknown'})...`); // Less noisy log

    // Apply decay directly to the passed object
    entityState.hunger -= DAILY_HUNGER_DECAY;
    entityState.thirst -= DAILY_THIRST_DECAY;

    // Clamp needs
    if (entityState.hunger < 0) entityState.hunger = 0;
    if (entityState.thirst < 0) entityState.thirst = 0;

    // Check needs and apply health damage if necessary
    let healthDamage = 0;
    let healthChanged = false;

    if (entityState.hunger <= 0 || entityState.thirst <= 0) {
        // Apply health damage
        healthDamage = HEALTH_DAMAGE_PER_DAY;
        entityState.health -= healthDamage;
        if (entityState.health < 0) entityState.health = 0;
        healthChanged = true;
        // console.warn(`Entity (ID: ${entityState.id || 'Unknown'}) taking ${healthDamage} damage from needs. Health: ${entityState.health}`);
    }

    const needsChanged = entityState.hunger !== initialHunger || entityState.thirst !== initialThirst;

    // Check for death
    const isDead = entityState.health <= 0;

    if (isDead) {
        console.error(`Entity (ID: ${entityState.id || 'Unknown'}) has died due to survival conditions!`);
        // Death state is now handled by the caller based on the return value
    }

    return {
        needsChanged,
        healthChanged,
        healthDamage,
        isDead
    };
}

// Removed triggerDeathState - caller handles death based on return value


// --- Exports ---
export {
    initializeSurvivalEngine,
    applySurvivalEffects, // Export the refactored function
    // Constants not exported unless needed externally
};