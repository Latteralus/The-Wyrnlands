/**
 * @module jobEngine
 * @description Manages job assignments, work shifts, wage payments, and output routing for players and NPCs.
 * Interacts with skillEngine, playerEngine/npcEngine, inventoryUtils, and the database.
 */

// Import specific database functions
import { run, get, all } from '../data/database.js';
// Import specific engine/util functions as needed
import { getSkill, addSkillXP, calculateSkillModifiers } from './skillEngine.js';
import { processTransaction } from '../utils/economyUtils.js';
import { addItem } from '../utils/inventoryUtils.js'; // Import addItem function
// import { updatePlayerAttributes } from './playerEngine.js';
// import { updateNpcAttributes } from './npcEngine.js';
// --- State ---
let isInitialized = false;
// --- State ---
// TODO: Load job definitions (base wage, output, required skill) from a data file (e.g., src/data/jobsData.js)
const jobDefinitions = {
    Farmer: { baseWage: 5, baseOutput: { item: 'Wheat', quantity: 2 }, skill: 'farming' },
    Miner: { baseWage: 8, baseOutput: { item: 'Stone', quantity: 1 }, skill: 'mining' },
    Blacksmith: { baseWage: 12, baseOutput: { item: 'Tool', quantity: 0.1 }, skill: 'carpentry' }, // Example
    // Add more jobs
};

/**
 * Initializes the Job Engine.
 */
function initializeJobEngine() {
    console.log("Job Engine Initialized");
    // TODO: Load jobDefinitions from a data file
    isInitialized = true;
}

/**
 * Assigns a job to an entity (player or NPC) by updating their record.
 * Note: This currently assumes Player/NPC tables have `current_job_type`, `employer_id`, `employer_type` columns.
 * TODO: Update schema if these columns don't exist.
 *
 * @param {string} entityType - 'Player' or 'NPC'.
 * @param {number} entityId - The ID of the entity.
 * @param {string} jobType - The type of job (e.g., 'Farmer', 'Blacksmith'). Must match a key in jobDefinitions.
 * @param {number|null} employerId - The ID of the employing entity (e.g., household ID, business ID), or null.
 * @param {string|null} employerType - 'Household', 'Business', or null.
 * @returns {Promise<boolean>} - True if the job was assigned successfully.
 */
async function assignJob(entityType, entityId, jobType, employerId, employerType) {
    if (!isInitialized) {
        console.warn("Job Engine not initialized.");
        return false;
    }
    if (!jobDefinitions[jobType]) {
        console.warn(`Job assignment failed: Unknown job type "${jobType}".`);
        return false;
    }
    // TODO: Add validation if entity can take the job (skills, reputation etc.)

    console.log(`Assigning job ${jobType} to ${entityType} ${entityId} (Employer: ${employerType} ${employerId || 'None'})`);

    const tableName = entityType === 'Player' ? 'Player' : 'NPCs';
    const idColumn = entityType === 'Player' ? 'player_id' : 'npc_id';

    try {
        // Update the entity's record directly
        const result = await run(
            `UPDATE ${tableName} SET current_job_type = ?, employer_id = ?, employer_type = ?, updated_at = CURRENT_TIMESTAMP
             WHERE ${idColumn} = ?`,
            [jobType, employerId, employerType, entityId]
        );

        if (result.changes > 0) {
            console.log(`Job ${jobType} assigned successfully to ${entityType} ${entityId}.`);
            // TODO: Update in-memory state if player/npc engines cache job info
            // TODO: Update employer records (e.g., add to employee list in a Business table/state)
            return true;
        } else {
            console.warn(`Job assignment failed: ${entityType} ${entityId} not found or no changes made.`);
            return false;
        }
    } catch (error) {
        console.error(`Error assigning job ${jobType} to ${entityType} ${entityId}:`, error);
        return false;
    }
}

/**
 * Removes the current job assignment from an entity by setting job fields to null.
 *
 * @param {string} entityType - 'Player' or 'NPC'.
 * @param {number} entityId - The ID of the entity.
 * @returns {Promise<boolean>} - True if the job was removed successfully.
 */
async function removeJob(entityType, entityId) {
     if (!isInitialized) {
        console.warn("Job Engine not initialized.");
        return false;
    }
    console.log(`Removing job from ${entityType} ${entityId}`);

    const tableName = entityType === 'Player' ? 'Player' : 'NPCs';
    const idColumn = entityType === 'Player' ? 'player_id' : 'npc_id';

    try {
        // Set job-related fields to NULL
        const result = await run(
            `UPDATE ${tableName} SET current_job_type = NULL, employer_id = NULL, employer_type = NULL, updated_at = CURRENT_TIMESTAMP
             WHERE ${idColumn} = ?`,
            [entityId]
        );

        if (result.changes > 0) {
            console.log(`Job removed successfully from ${entityType} ${entityId}.`);
            // TODO: Update in-memory state if player/npc engines cache job info
            // TODO: Update employer records (e.g., remove from employee list)
            return true;
        } else {
            console.warn(`Job removal failed: ${entityType} ${entityId} not found or no changes made (maybe already unemployed?).`);
            return false; // Return false if no rows were updated
        }
    } catch (error) {
        console.error(`Error removing job from ${entityType} ${entityId}:`, error);
        return false;
    }
}

/**
 * Processes a work shift for an entity. Calculates wages and output based on job type and skill level.
 * This would typically be called periodically (e.g., daily or per shift by npcEngine/player actions).
 *
 * @param {string} entityType - 'Player' or 'NPC'.
 * @param {number} entityId - The ID of the entity performing work.
 * @returns {Promise<void>}
 */
// TODO: Re-introduce engine/util dependencies via imports or pass necessary functions/state
// async function processWorkShift(entityType, entityId, skillEngine, inventoryUtils, economyUtils) {
async function processWorkShift(entityType, entityId) {
     if (!isInitialized) {
        console.warn("Job Engine not initialized.");
        return;
    }
    console.log(`Processing work shift for ${entityType} ${entityId}`);

    const tableName = entityType === 'Player' ? 'Player' : 'NPCs';
    const idColumn = entityType === 'Player' ? 'player_id' : 'npc_id';

    try {
        // 1. Get the entity's current job details
        const entityData = await get(
            `SELECT current_job_type, employer_id, employer_type, household_id FROM ${tableName} WHERE ${idColumn} = ?`,
            [entityId]
        );

        if (!entityData || !entityData.current_job_type) {
            console.log(`${entityType} ${entityId} has no current job. Skipping work shift.`);
            return;
        }

        const { current_job_type: jobType, employer_id: employerId, employer_type: employerType, household_id: entityHouseholdId } = entityData;
        const jobDef = jobDefinitions[jobType];
        if (!jobDef) {
            console.warn(`Cannot process work shift: Job definition not found for "${jobType}".`);
            return;
        }

        // 2. Get relevant skill level & calculate modifiers
        const skillName = jobDef.skill;
        let xpGained = 1; // Base XP gain per shift (TODO: Make this configurable per job?)

        // Get actual skill level
        const skillData = await getSkill(entityType, entityId, skillName);
        const skillLevel = skillData.level;

        // Calculate modifiers based on actual level
        const modifiers = calculateSkillModifiers(skillName, skillLevel); // { wageMultiplier, outputMultiplier }
        // TODO: Add XP multiplier to calculateSkillModifiers or define here
        const xpMultiplier = 1.0; // Placeholder

        // 3. Calculate final wage and output
        const finalWage = Math.round(jobDef.baseWage * modifiers.wageMultiplier);
        const finalOutputQuantity = jobDef.baseOutput.quantity * modifiers.outputMultiplier;
        const outputItem = jobDef.baseOutput.item;

        console.log(`${entityType} ${entityId} (${jobType}, Lvl ${skillLevel}): Wage=${finalWage}, Output=${finalOutputQuantity.toFixed(2)} ${outputItem}`);

        // 4. Handle Payment & Output (Requires economyUtils, inventoryUtils)
        if (employerId && employerType) {
            // Employed: Pay wage from employer to entity's household
            if (finalWage > 0 && entityHouseholdId) {
                console.log(`Attempting to pay wage ${finalWage} from ${employerType} ${employerId} to Household ${entityHouseholdId}.`);
                // Note: processTransaction needs entity IDs, not just numeric IDs. Assuming format like 'household_1', 'business_5'.
                // TODO: Ensure employerId and entityHouseholdId are formatted correctly or adjust processTransaction/getEntityType.
                // For now, assuming they are numeric IDs and we need to map them to types for processTransaction.
                // This mapping logic might be better handled within processTransaction or dedicated entity manager.
                const payerEntityType = employerType; // Should be 'Business' or 'Household' from DB
                const payeeEntityType = 'Household'; // Wages always go to the entity's household

                if (!payerEntityType) {
                     console.warn(`Cannot pay wage for ${entityType} ${entityId}: Employer type is missing.`);
                } else {
                    const paymentSuccess = await processTransaction(
                        employerId,      // Payer ID
                        payerEntityType, // Payer Type
                        entityHouseholdId, // Payee ID
                        payeeEntityType, // Payee Type
                        finalWage,         // Amount
                        `Wage for ${jobType}` // Reason
                    );
                    if (!paymentSuccess) {
                        console.warn(`Wage payment failed for ${entityType} ${entityId}.`);
                        // Decide if work shift should still grant XP/output if payment fails? Probably not.
                        // return; // Optional: Stop processing if payment fails
                    }
                }
            } else if (finalWage > 0 && !entityHouseholdId) {
                 console.warn(`Cannot pay wage for ${entityType} ${entityId}: Entity has no assigned household.`);
            }

            // Add output to employer inventory
            if (finalOutputQuantity > 0 && outputItem) {
                console.log(`Adding ${finalOutputQuantity.toFixed(2)} ${outputItem} to ${employerType} ${employerId} inventory.`);
                // Assuming employerType is 'Household' or 'Business' and addItem supports these.
                // Need to ensure addItem handles fractional quantities appropriately if needed, or round here.
                await addItem(employerType, employerId, outputItem, Math.floor(finalOutputQuantity)); // Using floor for now
            }
        } else {
            // Self-employed/Gathering: No wage, output goes to entity's household inventory
            if (finalOutputQuantity > 0 && outputItem && entityHouseholdId) {
                console.log(`Adding ${finalOutputQuantity.toFixed(2)} ${outputItem} to Household ${entityHouseholdId} inventory.`);
                await addItem('Household', entityHouseholdId, outputItem, Math.floor(finalOutputQuantity)); // Using floor for now
            } else if (finalOutputQuantity > 0 && !entityHouseholdId) {
                 console.warn(`Cannot add job output for ${entityType} ${entityId}: Entity has no assigned household.`);
            }
        }

        // 5. Add Skill XP
        const finalXpGained = Math.round(xpGained * xpMultiplier); // Use placeholder xpMultiplier for now
        if (finalXpGained > 0) {
            console.log(`Adding ${finalXpGained} XP to ${skillName} skill for ${entityType} ${entityId}.`);
            await addSkillXP(entityType, entityId, skillName, finalXpGained);
        }

    } catch (error) {
        console.error(`Error processing work shift for ${entityType} ${entityId}:`, error);
    }
}

export { initializeJobEngine, assignJob, removeJob, processWorkShift };