// Declare isInitialized at the very top
let isInitialized = false;

/**
 * @module skillEngine
 * @description Manages player and NPC skills, experience gain, leveling, and skill-based calculations (e.g., wage/output).
 * Interacts with the database to persist skill data.
 */

// Import specific database functions
import { run, get, all } from '../data/database.js';

// Example: Define XP thresholds for leveling up
// Removed XP_THRESHOLDS array, using formula instead
// const XP_THRESHOLDS = [0, 100, 250, 500, 1000, 2000];
// TODO: Consider making this configurable per skill or using a formula.
// Example formula: xpForNextLevel = level * 100
const calculateXpForNextLevel = (level) => level * 100; // Matches playerEngine for now
const MAX_SKILL_LEVEL = 100;
// --- State ---
// let isInitialized = false; // Declaration moved to top
// TODO: Load skill definitions (names, descriptions) from a data file?
/**
 * Initializes the Skill Engine.
 */
function initializeSkillEngine() {
    console.log("Skill Engine Initialized");
    // Load skill definitions if needed
    isInitialized = true;
}

/**
 * Adds experience points to a specific skill for an entity (player or NPC).
 * Handles level ups if XP threshold is met. Persists changes to the database.
 *
 * @param {string} entityType - 'Player' or 'NPC'.
 * @param {number} entityId - The ID of the player or NPC.
 * @param {string} skillName - The name of the skill (e.g., 'Carpentry', 'Farming').
 * @param {number} xpToAdd - The amount of experience points to add.
 * @returns {Promise<{levelChanged: boolean, newLevel: number}>} - Info about level change. Returns { levelChanged: false, newLevel: currentLevel } on error or if not initialized.
 */
async function addSkillXP(entityType, entityId, skillName, xpToAdd) {
     if (!isInitialized) {
        console.warn("Skill Engine not initialized. Cannot add XP.");
        return { levelChanged: false, newLevel: 0 }; // Indicate no change on error
    }
     if (xpToAdd <= 0) return { levelChanged: false, newLevel: 0 }; // No change if no XP added

    console.log(`Adding ${xpToAdd} XP to ${skillName} for ${entityType} ${entityId}`);

    try {
        // 1. Get current skill data or initialize if not found
        let skillData = await getSkill(entityType, entityId, skillName);
        let currentLevel = skillData.level;
        let currentXp = skillData.xp;
        let initialLevel = currentLevel; // Store initial level for comparison

        // Return early if already at max level
        if (currentLevel >= MAX_SKILL_LEVEL) {
             console.log(`${skillName} is already at max level (${MAX_SKILL_LEVEL}). No XP gained.`);
             return { levelChanged: false, newLevel: currentLevel };
        }

        // 3. Add xpToAdd to current XP.
        currentXp += xpToAdd;
        console.log(` -> New total XP before level check: ${currentXp}`);

        // 4. Check for level ups using the formula
        let xpNeeded = calculateXpForNextLevel(currentLevel);
        while (currentXp >= xpNeeded && currentLevel < MAX_SKILL_LEVEL) {
            currentLevel++;
            currentXp -= xpNeeded; // Subtract cost of the level gained
            console.log(`LEVEL UP! ${entityType} ${entityId}'s ${skillName} reached level ${currentLevel}!`);

            // Check if max level reached *after* leveling up
            if (currentLevel >= MAX_SKILL_LEVEL) {
                 currentXp = 0; // Cap XP at max level
                 console.log(`${skillName} reached max level (${MAX_SKILL_LEVEL}).`);
                 break; // Exit loop
            }
            // Calculate XP needed for the *next* level
            xpNeeded = calculateXpForNextLevel(currentLevel);
        }

        // 5 & 6. Update skill in DB using UPSERT
        const sql = `
            INSERT INTO Skills (owner_id, owner_type, skill_name, level, experience)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(owner_id, owner_type, skill_name) DO UPDATE SET
            level = excluded.level,
            experience = excluded.experience,
            updated_at = CURRENT_TIMESTAMP
        `;
        await run(sql, [entityId, entityType, skillName, currentLevel, currentXp]);

        const levelChanged = currentLevel > initialLevel;
        console.log(` -> Skill ${skillName} updated. New Level: ${currentLevel}, New XP: ${currentXp}. Level changed: ${levelChanged}`);
        return { levelChanged, newLevel: currentLevel };

    } catch (error) {
        console.error(`Error adding skill XP for ${entityType} ${entityId}, skill ${skillName}:`, error);
        return { levelChanged: false, newLevel: 0 }; // Indicate no change on error
    }
}

/**
 * Gets the current level and XP of a specific skill for an entity.
 *
 * @param {string} entityType - 'Player' or 'NPC'.
 * @param {number} entityId - The ID of the player or NPC.
 * @param {string} skillName - The name of the skill.
 * @returns {Promise<{level: number, xp: number}>} - The current level and XP (defaults to level 1, 0 XP if not found).
 */
async function getSkill(entityType, entityId, skillName) {
     if (!isInitialized) {
        console.warn("Skill Engine not initialized.");
        return { level: 1, xp: 0 }; // Return default on error
    }
    // console.log(`Getting skill ${skillName} for ${entityType} ${entityId}`); // Less noisy log
    try {
        const row = await get(
            'SELECT level, experience FROM Skills WHERE owner_id = ? AND owner_type = ? AND skill_name = ?',
            [entityId, entityType, skillName]
        );
        if (row) {
            return { level: row.level, xp: row.experience };
        } else {
            // Skill not found in DB, return default starting values (Level 1, 0 XP)
            return { level: 1, xp: 0 };
        }
    } catch (error) {
        console.error(`Error getting skill ${skillName} for ${entityType} ${entityId}:`, error);
        return { level: 1, xp: 0 }; // Return default on error
    }
}
// Removed getSkillLevel as getSkill provides both level and XP

/**
 * Calculates the wage/output ratio based on skill level.
 * This is a placeholder; the actual formula might be more complex.
 *
 * @param {string} skillName - The name of the skill.
 * @param {number} level - The level of the skill.
 * @returns {object} - An object containing calculated wage multiplier and output multiplier.
 */
function calculateSkillModifiers(skillName, level) {
    // Example: Simple linear scaling
    const baseWageMultiplier = 1.0;
    const baseOutputMultiplier = 1.0;
    const levelBonus = level * 0.1; // 10% bonus per level

    const wageMultiplier = baseWageMultiplier + levelBonus;
    const outputMultiplier = baseOutputMultiplier + levelBonus * 1.5; // Output scales faster

    console.log(`Calculated modifiers for ${skillName} Level ${level}: Wage x${wageMultiplier}, Output x${outputMultiplier}`);
    return { wageMultiplier, outputMultiplier };
}

export { initializeSkillEngine, addSkillXP, getSkill, calculateSkillModifiers }; // Removed getSkillLevel, XP_THRESHOLDS