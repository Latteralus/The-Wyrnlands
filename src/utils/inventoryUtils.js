/**
 * @module inventoryUtils
 * @description Utilities for managing player and household inventories.
 * Interacts with the database to track items.
 */

import { run, get, all } from '../data/database.js'; // Import DB functions

/**
 * Adds an item to a specified inventory (Player, Household, or Building).
 * Handles updating quantity if the item already exists, or inserting a new row.
 *
 * @param {string} ownerType - 'Player', 'Household', or 'Building'.
 * @param {number} ownerId - The ID of the household or building.
 * @param {string} itemType - The type/name of the item to add.
 * @param {number} quantity - The quantity to add (must be positive).
 * @param {number} [condition=100.0] - Optional condition for tools/equipment.
 * @returns {Promise<boolean>} True if successful, false otherwise.
 */
async function addItem(ownerType, ownerId, itemType, quantity, condition = 100.0) {
    if (quantity <= 0) {
        console.warn(`addItem: Cannot add non-positive quantity (${quantity}) of ${itemType}.`);
        return false;
    }
    const validOwnerTypes = ['Player', 'Household', 'Building'];
    if (!validOwnerTypes.includes(ownerType)) {
        console.error(`addItem: Invalid ownerType "${ownerType}". Must be one of: ${validOwnerTypes.join(', ')}.`);
        return false;
    }

    // Determine the correct column name based on ownerType
    let ownerIdColumn;
    let nullColumns = [];
    if (ownerType === 'Player') {
        ownerIdColumn = 'player_id';
        nullColumns = ['household_id', 'building_id'];
    } else if (ownerType === 'Household') {
        ownerIdColumn = 'household_id';
        nullColumns = ['player_id', 'building_id'];
    } else { // Building
        ownerIdColumn = 'building_id';
        nullColumns = ['player_id', 'household_id'];
    }

    console.log(`Adding ${quantity} ${itemType} to ${ownerType} ${ownerId}`);

    try {
        // Check if the item already exists in this specific inventory
        const existingItem = await get(
            `SELECT inventory_id, quantity FROM Inventory WHERE ${ownerIdColumn} = ? AND item_type = ?`,
            [ownerId, itemType]
        );
        console.log('DEBUG inventoryUtils: existingItem result from get:', existingItem); // Add debug log

        if (existingItem) {
            // Update existing item quantity
            const newQuantity = existingItem.quantity + quantity;
            const result = await run(
                'UPDATE Inventory SET quantity = ?, updated_at = CURRENT_TIMESTAMP WHERE inventory_id = ?',
                [newQuantity, existingItem.inventory_id]
            );
            return result.changes > 0;
        } else {
            // Insert new item row
            // Ensure the other owner ID column is explicitly set to NULL
            // Insert new item row, ensuring other owner IDs are NULL
            const result = await run(
                `INSERT INTO Inventory (item_type, quantity, condition, ${ownerIdColumn}, ${nullColumns[0]}, ${nullColumns[1]})
                 VALUES (?, ?, ?, ?, NULL, NULL)`,
                [itemType, quantity, condition, ownerId]
            );
            return result.lastID !== undefined;
        }
    } catch (error) {
        console.error(`Error adding item ${itemType} to ${ownerType} ${ownerId}:`, error);
        return false;
    }
}

/**
 * Removes an item from a specified inventory (Player, Household, or Building).
 * Decreases quantity or deletes the row if quantity reaches zero or less.
 *
 * @param {string} ownerType - 'Player', 'Household', or 'Building'.
 * @param {number} ownerId - The ID of the household or building.
 * @param {string} itemType - The type/name of the item to remove.
 * @param {number} quantity - The quantity to remove (must be positive).
 * @returns {Promise<boolean>} - True if removal was successful, false otherwise (e.g., insufficient quantity).
 */
async function removeItem(ownerType, ownerId, itemType, quantity) {
     if (quantity <= 0) {
        console.warn(`removeItem: Cannot remove non-positive quantity (${quantity}) of ${itemType}.`);
        return false;
    }
    const validOwnerTypes = ['Player', 'Household', 'Building'];
    if (!validOwnerTypes.includes(ownerType)) {
        console.error(`removeItem: Invalid ownerType "${ownerType}". Must be one of: ${validOwnerTypes.join(', ')}.`);
        return false;
    }

    const ownerIdColumn = ownerType === 'Player' ? 'player_id' : (ownerType === 'Household' ? 'household_id' : 'building_id');
    console.log(`Removing ${quantity} ${itemType} from ${ownerType} ${ownerId}`);

    try {
        // Find the item in the specific inventory
        const existingItem = await get(
            `SELECT inventory_id, quantity FROM Inventory WHERE ${ownerIdColumn} = ? AND item_type = ?`,
            [ownerId, itemType]
        );

        if (!existingItem) {
            console.warn(`removeItem: Item ${itemType} not found in inventory for ${ownerType} ${ownerId}.`);
            return false;
        }

        if (existingItem.quantity < quantity) {
            console.warn(`removeItem: Insufficient quantity of ${itemType} (${existingItem.quantity}) to remove ${quantity} for ${ownerType} ${ownerId}.`);
            return false;
        }

        const newQuantity = existingItem.quantity - quantity;

        if (newQuantity <= 0) {
            // Delete the row if quantity is zero or less
            const result = await run('DELETE FROM Inventory WHERE inventory_id = ?', [existingItem.inventory_id]);
            return result.changes > 0;
        } else {
            // Update the quantity
            const result = await run(
                'UPDATE Inventory SET quantity = ?, updated_at = CURRENT_TIMESTAMP WHERE inventory_id = ?',
                [newQuantity, existingItem.inventory_id]
            );
            return result.changes > 0;
        }
    } catch (error) {
        console.error(`Error removing item ${itemType} from ${ownerType} ${ownerId}:`, error);
        return false;
    }
}

/**
 * Gets the quantity of a specific item in an inventory (Player, Household, or Building).
 *
 * @param {string} ownerType - 'Player', 'Household', or 'Building'.
 * @param {number} ownerId - The ID of the player, household, or building.
 * @param {string} itemType - The type/name of the item to check.
 * @returns {Promise<number>} - The quantity of the item (0 if not found or error).
 */
async function getItemQuantity(ownerType, ownerId, itemType) {
    const validOwnerTypes = ['Player', 'Household', 'Building'];
    if (!validOwnerTypes.includes(ownerType)) {
        console.error(`getItemQuantity: Invalid ownerType "${ownerType}".`);
        return 0;
    }
    const ownerIdColumn = ownerType === 'Player' ? 'player_id' : (ownerType === 'Household' ? 'household_id' : 'building_id');
    // console.log(`Getting quantity of ${itemType} for ${ownerType} ${ownerId}`); // Less noisy log

    try {
        const row = await get(
            `SELECT quantity FROM Inventory WHERE ${ownerIdColumn} = ? AND item_type = ?`,
            [ownerId, itemType]
        );
        return row ? row.quantity : 0;
    } catch (error) {
        console.error(`Error getting quantity for item ${itemType} for ${ownerType} ${ownerId}:`, error);
        return 0;
    }
}

/**
 * Gets all items in a specified inventory (Player, Household, or Building).
 *
 * @param {string} ownerType - 'Player', 'Household', or 'Building'.
 * @param {number} ownerId - The ID of the player, household, or building.
 * @returns {Promise<Array<{item_type: string, quantity: number, condition: number}>>} - An array of items.
 */
async function getInventory(ownerType, ownerId) {
    const validOwnerTypes = ['Player', 'Household', 'Building'];
    if (!validOwnerTypes.includes(ownerType)) {
        console.error(`getInventory: Invalid ownerType "${ownerType}".`);
        return [];
    }
    const ownerIdColumn = ownerType === 'Player' ? 'player_id' : (ownerType === 'Household' ? 'household_id' : 'building_id');
    console.log(`Getting inventory for ${ownerType} ${ownerId}`);

    try {
        const rows = await all(
            `SELECT item_type, quantity, condition FROM Inventory WHERE ${ownerIdColumn} = ? ORDER BY item_type`,
            [ownerId]
        );
        return rows || [];
    } catch (error) {
        console.error(`Error getting inventory for ${ownerType} ${ownerId}:`, error);
        return [];
    }
}


export { addItem, removeItem, getItemQuantity, getInventory };