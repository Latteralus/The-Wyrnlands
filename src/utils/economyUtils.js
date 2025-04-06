// src/utils/economyUtils.js
// Utility functions for handling economic concepts like currency, pricing, wages, taxes, inflation, etc.

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

// NOTE: The following functions (getEntityFunds, setEntityFunds) are assumed to be
// implemented in and imported from other modules (e.g., a hypothetical fundManager or entityManager).
// The processTransaction function below relies on their availability in its scope.
// Example hypothetical import:
// import { getEntityFunds, setEntityFunds } from '@/managers/fundManager.js';


/**
 * Processes a transaction between two entities.
 * Deducts funds from the payer and adds them to the payee.
 * Relies on assumed helper functions getEntityType, getEntityFunds, setEntityFunds.
 * @param {string} payerId - The ID of the entity paying.
 * @param {string} payeeId - The ID of the entity receiving payment.
 * @param {number} amount - The amount to transfer (in copper, must be positive integer).
 * @param {function} getEntityFundsFunc - Async function to retrieve funds for an entity ID and type.
 * @param {function} setEntityFundsFunc - Async function to set funds for an entity ID and type.
 * @param {string} [reason="Transaction"] - A description for logging purposes.
 * @returns {Promise<boolean>} True if the transaction was successful, false otherwise.
 */
async function processTransaction(payerId, payeeId, amount, getEntityFundsFunc, setEntityFundsFunc, reason = "Transaction") {
    // Use the provided functions instead of importing
    const getEntityFunds = getEntityFundsFunc;
    const setEntityFunds = setEntityFundsFunc;

    console.log(`Processing transaction: ${payerId} pays ${payeeId} ${amount} C for ${reason}`);

    if (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0) {
        console.error(`Transaction failed: Invalid amount ${amount}. Must be a positive integer.`);
        return false; // Fail on invalid amount
    }
    if (!payerId || !payeeId || payerId === payeeId) {
         console.error(`Transaction failed: Invalid payer ('${payerId}') or payee ('${payeeId}').`);
         return false;
    }

    const payerType = getEntityType(payerId);
    const payeeType = getEntityType(payeeId);

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
    // Export assumed helpers only if they were implemented here, otherwise don't
    getEntityType // Exporting this as it's implemented here
};