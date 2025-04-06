// src/engines/survivalEngine.js
// Manages player survival needs like hunger and thirst.

import { modifyNeed, getPlayerAttribute, updatePlayerAttributes } from './playerEngine.js'; // Use relative path
// Removed import of registerDailyCallback as timeEngine uses a single main tick callback
// import { registerDailyCallback } from './timeEngine.js';
import { showGameOver } from '../managers/uiManager.js'; // Use relative path

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
    // No longer registering callback here; logic will be called from main game tick
    // registerDailyCallback(applyDailySurvivalDecay);
    console.log("Survival Engine initialized and registered daily callback.");
}

// --- Decay Logic ---

/**
 * Applies the daily decay to player's hunger and thirst.
 * Applies health damage if needs are depleted.
 * Checks for player death.
 */
async function applyDailySurvivalDecay() {
    console.log("Applying daily survival decay...");

    // Apply daily decay
    // Using updatePlayerAttributes might be better if we want persistence guarantees,
    // but modifyNeed is simpler for now if persistence is handled elsewhere (e.g., save game)
    modifyNeed('hunger', -DAILY_HUNGER_DECAY);
    modifyNeed('thirst', -DAILY_THIRST_DECAY);

    // Check needs and apply health damage if necessary
    const currentHunger = getPlayerAttribute('hunger');
    const currentThirst = getPlayerAttribute('thirst');
    let healthDamage = 0;

    if (currentHunger <= 0 || currentThirst <= 0) {
        if (currentHunger <= 0) console.warn("Player is starving!");
        if (currentThirst <= 0) console.warn("Player is dehydrated!");
        healthDamage = HEALTH_DAMAGE_PER_DAY;
        modifyNeed('health', -healthDamage);
        console.log(`Applied ${healthDamage} health damage due to depleted needs.`);
    }

    // Check for death
    const currentHealth = getPlayerAttribute('health');
    if (currentHealth <= 0) {
        console.error("Player has died!");
        triggerDeathState();
    }

    // Persist changes (optional here, could be done on save)
    // await updatePlayerAttributes({ hunger: currentHunger, thirst: currentThirst, health: currentHealth });
}

/**
 * Handles the player death state.
 * (Placeholder - likely involves UI changes and disabling input)
 */
function triggerDeathState() {
    console.log("GAME OVER triggered.");
    // Example: Disable game input, show game over screen
    showGameOver("You succumbed to the harsh conditions.");
    // TODO: Add logic to stop timeEngine, disable player input etc.
}

// --- Exports ---
export {
    initializeSurvivalEngine,
    applyDailySurvivalDecay, // Export for potential manual triggering or testing
    // Constants not exported unless needed externally
};