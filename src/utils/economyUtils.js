// src/utils/economyUtils.js
// Utility functions for handling economic concepts like currency, pricing, wages, taxes, inflation, etc.

import { run, get } from '../data/database.js'; // Import DB functions
// --- Currency System ---
// All currency amounts are stored as integers representing the smallest unit (e.g., Copper Pieces).
const COPPER_PER_SILVER = 100;
const SILVER_PER_GOLD = 100;
const COPPER_PER_GOLD = COPPER_PER_SILVER * SILVER_PER_GOLD; // 10,000

// TODO: Implement functions for:
// - Calculating transaction costs/taxes.
// - Determining market prices based on supply/demand (complex).
// - Calculating wages based on skill/reputation/job type. (Partially done)
// - Managing business/household finances (income, expenses, profit/loss).
// - Handling inflation/deflation effects.
// - Processing payments between entities (players, NPCs, businesses, guilds). (Partially done)

console.log("Economy Utilities Loaded");

/**
 * Formats a raw currency value (in smallest units, e.g., copper) into a string representation.
 * Example: 12345 -> "1 G, 23 S, 45 C"
 * @param {number} rawAmount - The amount in the smallest currency unit.
 * @returns {string} The formatted currency string.
 */
function formatCurrency(rawAmount) {
    if (typeof rawAmount !== 'number' || !Number.isInteger(rawAmount)) {
        console.warn(`formatCurrency: Invalid input amount: ${rawAmount}. Returning '0 C'.`);
        return '0 C';
    }
    if (rawAmount === 0) return '0 C';

    const isNegative = rawAmount < 0;
    let amount = Math.abs(rawAmount);

    const gold = Math.floor(amount / COPPER_PER_GOLD);
    amount %= COPPER_PER_GOLD;
    const silver = Math.floor(amount / COPPER_PER_SILVER);
    amount %= COPPER_PER_SILVER;
    const copper = amount;

    let parts = [];
    if (gold > 0) {
        parts.push(`${gold} G`);
        // Always add silver part if gold exists, even if zero
        parts.push(`${silver} S`);
        // Always add copper part if gold exists, even if zero
        parts.push(`${copper} C`);
    } else if (silver > 0) {
        parts.push(`${silver} S`);
        // Always add copper part if silver exists, even if zero
        parts.push(`${copper} C`);
    } else {
        // Only copper exists (or amount is zero)
        parts.push(`${copper} C`);
    }

    return (isNegative ? '-' : '') + parts.join(', ');
}


// Example function placeholder - Refined
function calculateWage(skillLevel = 1, jobDifficulty = 1, reputationModifier = 0) {
    console.log(`Calculating wage for skill ${skillLevel}, difficulty ${jobDifficulty}, rep mod ${reputationModifier}`);
    // TODO: Refine base wage, multipliers - potentially load from game data/config
    const baseWage = 10; // Base copper per hour/day? Define time unit elsewhere.
    const skillBonus = Math.max(0, (skillLevel - 1) * 2); // Example: +2 copper per skill level above 1
    const difficultyBonus = Math.max(0, (jobDifficulty - 1) * 1); // Example: +1 copper per difficulty level above 1
    // Reputation modifier could be a direct +/- copper amount or a percentage. Using direct amount for now.
    const calculatedWage = baseWage + skillBonus + difficultyBonus + reputationModifier;
    return Math.max(1, Math.floor(calculatedWage)); // Ensure wage is at least 1 copper
}

// --- Transaction Processing (Relies on External Fund Management Functions) ---

/**
 * Determines the type of entity based on its ID prefix.
 * @param {string} entityId - e.g., 'player_1', 'npc_123', 'biz_45', 'guild_abc'
 * @returns {'Player' | 'NPC' | 'Business' | 'Guild' | 'Unknown'}
 */
function getEntityType(entityId) {
    if (typeof entityId !== 'string') return 'Unknown';
    if (entityId.startsWith('player_')) return 'Player';
    if (entityId.startsWith('npc_')) return 'NPC';
    if (entityId.startsWith('biz_')) return 'Business';
    if (entityId.startsWith('guild_')) return 'Guild';
    // Add other types if needed (e.g., 'household_')
    return 'Unknown';
}

// --- Fund Management Helpers ---
// These interact directly with the database for now.
// TODO: Consider caching funds in memory for performance if needed.

/**
 * Retrieves the current funds for a given entity (Household, Business, etc.).
 * Assumes funds are stored in a 'funds' column in the entity's table.
 * @param {string} entityId - The ID of the entity (e.g., household_id, business_id).
 * @param {string} entityType - 'Household', 'Business', etc. (determines table name).
 * @returns {Promise<number|null>} The current funds in copper, or null if not found/error.
 */
async function getEntityFunds(entityId, entityType) {
    // Determine table and column names based on type
    let tableName;
    let idColumn;
    switch (entityType) {
        case 'Household':
            tableName = 'Households';
            idColumn = 'household_id';
            break;
        // TODO: Add cases for 'Business', 'Guild' etc. if they store funds directly
        // case 'Business':
        //     tableName = 'Businesses';
        //     idColumn = 'business_id';
        //     break;
        default:
            console.error(`getEntityFunds: Unsupported entity type "${entityType}".`);
            return null;
    }

    try {
        const row = await get(`SELECT funds FROM ${tableName} WHERE ${idColumn} = ?`, [entityId]);
        if (row) {
            return row.funds; // Assuming 'funds' column stores copper value
        } else {
            console.warn(`getEntityFunds: Entity ${entityType} ${entityId} not found.`);
            return null;
        }
    } catch (error) {
        console.error(`Error getting funds for ${entityType} ${entityId}:`, error);
        return null;
    }
}

/**
 * Sets the funds for a given entity.
 * @param {string} entityId - The ID of the entity.
 * @param {string} entityType - 'Household', 'Business', etc.
 * @param {number} newAmount - The new fund amount in copper (must be non-negative integer).
 * @returns {Promise<boolean>} True if successful, false otherwise.
 */
async function setEntityFunds(entityId, entityType, newAmount) {
    if (typeof newAmount !== 'number' || !Number.isInteger(newAmount) || newAmount < 0) {
        console.error(`setEntityFunds: Invalid new amount ${newAmount}. Must be a non-negative integer.`);
        return false;
    }

    let tableName;
    let idColumn;
     switch (entityType) {
        case 'Household':
            tableName = 'Households';
            idColumn = 'household_id';
            break;
        // TODO: Add cases for 'Business', 'Guild' etc.
        default:
            console.error(`setEntityFunds: Unsupported entity type "${entityType}".`);
            return false;
    }

    try {
        const result = await run(
            `UPDATE ${tableName} SET funds = ?, updated_at = CURRENT_TIMESTAMP WHERE ${idColumn} = ?`,
            [newAmount, entityId]
        );
        if (result.changes > 0) {
            // console.log(`Funds updated for ${entityType} ${entityId} to ${newAmount} C.`); // Less noisy log
            return true;
        } else {
            console.warn(`setEntityFunds: Entity ${entityType} ${entityId} not found or funds not changed.`);
            return false; // Return false if no row was updated
        }
    } catch (error) {
        console.error(`Error setting funds for ${entityType} ${entityId}:`, error);
        return false;
    }
}

// --- Transaction Processing ---
// (processTransaction function remains here, now using the above helpers)

/**
 * Processes a transaction between two entities.
 * Deducts funds from the payer and adds them to the payee.
 * Relies on assumed helper functions getEntityType, getEntityFunds, setEntityFunds.
 * @param {string} payerId - The ID of the entity paying.
 * @param {number} payerId - The numeric ID of the entity paying.
 * @param {string} payerType - The type of the payer ('Household', 'Business', etc.).
 * @param {number} payeeId - The numeric ID of the entity receiving payment.
 * @param {string} payeeType - The type of the payee ('Household', 'Business', etc.).
 * @param {number} amount - The amount to transfer (in copper, must be positive integer).
 * @param {string} [reason="Transaction"] - A description for logging purposes.
 * @returns {Promise<boolean>} True if the transaction was successful, false otherwise.
 */
async function processTransaction(payerId, payerType, payeeId, payeeType, amount, reason = "Transaction") {
    // Uses getEntityFunds and setEntityFunds defined in this module

    console.log(`Processing transaction: ${payerId} pays ${payeeId} ${amount} C for ${reason}`);

    if (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0) {
        console.error(`Transaction failed: Invalid amount ${amount}. Must be a positive integer.`);
        return false; // Fail on invalid amount
    }
    // IDs should be numbers now, types are passed in. Check for null/undefined IDs.
    if (payerId == null || payeeId == null || (payerId === payeeId && payerType === payeeType)) {
         console.error(`Transaction failed: Invalid payer (ID: ${payerId}, Type: ${payerType}) or payee (ID: ${payeeId}, Type: ${payeeType}).`);
         return false;
    }

    // Validate types passed in
    const validTypes = ['Household', 'Business', 'Guild']; // Extend as needed
    if (!validTypes.includes(payerType) || !validTypes.includes(payeeType)) {
        console.error(`Transaction failed: Invalid entity type provided. Payer: ${payerType}, Payee: ${payeeType}.`);
        return false;
    }
    // Removed internal getEntityType calls

    if (payerType === 'Unknown' || payeeType === 'Unknown') {
        console.error(`Transaction failed: Unknown entity type for payer ('${payerType}') or payee ('${payeeType}').`);
        return false;
    }

    try {
        const payerFunds = await getEntityFunds(payerId, payerType);
        const payeeFunds = await getEntityFunds(payeeId, payeeType);

        if (payerFunds === null || payeeFunds === null) {
             console.error(`Transaction failed: Could not retrieve funds for payer or payee.`);
             return false;
        }

        if (payerFunds < amount) {
            console.warn(`Transaction failed: Payer ${payerId} (${payerType}) has insufficient funds (${payerFunds} C) to pay ${amount} C.`);
            return false;
        }

        // Perform the transfer
        const payerSuccess = await setEntityFunds(payerId, payerType, payerFunds - amount);
        if (!payerSuccess) {
            console.error(`Transaction failed: Failed to deduct funds from payer ${payerId}.`);
            // Attempt to revert payee funds if deduction failed? Complex. For now, just fail.
            return false;
        }

        const payeeSuccess = await setEntityFunds(payeeId, payeeType, payeeFunds + amount);
        if (!payeeSuccess) {
            console.error(`Transaction failed: Failed to add funds to payee ${payeeId}. Attempting to revert payer funds.`);
            // Attempt to revert payer funds
            const revertSuccess = await setEntityFunds(payerId, payerType, payerFunds); // Put original amount back
            if (!revertSuccess) {
                 console.error(`CRITICAL ERROR: Failed to revert payer funds for ${payerId} after failed payee update! Funds may be lost.`);
            }
            return false;
        }

        console.log(`Transaction successful: ${payerId} paid ${payeeId} ${amount} C.`);
        // TODO: Log transaction details to a ledger?
        return true;

    } catch (error) {
        console.error(`Transaction failed due to an error:`, error);
        // Consider attempting reverts here as well, though complex depending on where the error occurred.
        return false;
    }
}

/**
 * Calculates tax amount for a given transaction amount and rate.
 * @param {number} transactionAmount - The base amount (in copper).
 * @param {number} taxRate - The tax rate as a decimal (e.g., 0.05 for 5%).
 * @returns {number} The calculated tax amount in copper, rounded down.
 */
function calculateTransactionTax(transactionAmount, taxRate) {
    if (typeof transactionAmount !== 'number' || typeof taxRate !== 'number' || taxRate < 0) {
        return 0;
    }
    return Math.floor(transactionAmount * taxRate);
}


export {
    COPPER_PER_SILVER, // Export constants if needed elsewhere
    SILVER_PER_GOLD,
    COPPER_PER_GOLD,
    formatCurrency,
    calculateWage,
    processTransaction,
    calculateTransactionTax,
    getEntityFunds, // Export new helpers
    setEntityFunds,
    getEntityType // Exporting this as it's implemented here
};