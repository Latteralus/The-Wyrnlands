// src/data/mountData.js
// Defines properties for different types of mounts available in the game.

const MOUNT_DATA = {
    horse: {
        id: 'horse',
        name: 'Horse',
        description: 'A common riding horse, faster than walking.',
        speedModifier: 1.8, // Multiplier for base movement speed (e.g., 1.8x faster)
        fatigueModifier: 0.7, // Multiplier for fatigue cost per tile (e.g., 70% of walking cost)
        carryingCapacityBonus: 50, // Additional weight player can carry
        cost: 50000, // Cost in copper (5 Gold) - Placeholder
        requiredSkill: { skill: 'riding', level: 1 } // Placeholder for potential skill requirement
    },
    cart_horse: {
        id: 'cart_horse',
        name: 'Horse and Cart',
        description: 'A sturdy horse pulling a cart, slower but carries much more.',
        speedModifier: 1.2, // Slower than just riding, but faster than walking
        fatigueModifier: 1.0, // Same fatigue as walking (pulling is tiring)
        carryingCapacityBonus: 250, // Significant bonus for cargo
        cost: 75000, // 7 Gold, 50 Silver - Placeholder
        requiredSkill: { skill: 'riding', level: 2 } // Placeholder
    },
    // Add other mounts like donkey, ox, etc. later
};

/**
 * Gets the data for a specific mount type.
 * @param {string} mountId - The ID of the mount (e.g., 'horse').
 * @returns {object | null} The mount data object or null if not found.
 */
function getMountData(mountId) {
    return MOUNT_DATA[mountId] || null;
}

export {
    MOUNT_DATA,
    getMountData
};