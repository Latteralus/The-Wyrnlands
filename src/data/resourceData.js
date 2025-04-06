/**
 * @fileoverview Defines resources and intermediate goods in The Wyrnlands.
 * This includes raw materials gathered from the environment and items crafted from them.
 */

export const resourceData = {
  // --- Raw Resources ---
  wood_log: {
    id: 'wood_log',
    name: 'Wood Log',
    type: 'resource', // 'resource', 'intermediate', 'consumable', 'component'
    category: 'raw', // 'raw', 'processed', 'food', etc.
    description: 'A rough log harvested from a tree.',
    weight: 5,
    value: 1, // Base value
    stackable: true,
    maxStack: 50,
    source: ['forest', 'woodcutting'], // Where/how it's obtained
  },
  stone: {
    id: 'stone',
    name: 'Stone',
    type: 'resource',
    category: 'raw',
    description: 'A chunk of rock, useful for building.',
    weight: 8,
    value: 1,
    stackable: true,
    maxStack: 50,
    source: ['quarry', 'mining'],
  },
  iron_ore: {
    id: 'iron_ore',
    name: 'Iron Ore',
    type: 'resource',
    category: 'raw',
    description: 'Raw ore containing iron.',
    weight: 10,
    value: 3,
    stackable: true,
    maxStack: 50,
    source: ['mine', 'mining'],
  },
  // --- Intermediate Goods ---
  plank: {
    id: 'plank',
    name: 'Plank',
    type: 'intermediate',
    category: 'processed',
    description: 'A shaped piece of wood, ready for construction.',
    weight: 2,
    value: 3, // Higher value than raw log
    stackable: true,
    maxStack: 100,
    source: ['carpentry_workshop', 'crafting'], // How it's made
    recipe: { wood_log: 1 }, // Example: 1 log makes 1 plank (adjust later)
  },
  iron_ingot: {
    id: 'iron_ingot',
    name: 'Iron Ingot',
    type: 'intermediate',
    category: 'processed',
    description: 'Refined iron, ready for smithing.',
    weight: 8, // Less than ore due to refinement? Or same? TBD
    value: 10,
    stackable: true,
    maxStack: 50,
    source: ['smelter', 'crafting'],
    recipe: { iron_ore: 2, coal: 1 }, // Example recipe
  },
  // --- Consumables ---
   raw_meat: {
    id: 'raw_meat',
    name: 'Raw Meat',
    type: 'consumable',
    category: 'food',
    description: 'Fresh meat from hunting. Needs cooking.',
    weight: 1,
    value: 2,
    stackable: true,
    maxStack: 20,
    source: ['hunting'],
    spoilageRate: 0.1, // Example: % spoilage per day
    effects: { hunger: 5 }, // Eating raw might give minimal hunger relief but risk disease?
  },
  // Add more resources and intermediates as needed
};

/**
 * Gets the definition for a specific resource or item.
 * @param {string} itemId - The ID of the item (e.g., 'wood_log').
 * @returns {object | undefined} The item definition object or undefined if not found.
 */
export function getItemDefinition(itemId) {
  return resourceData[itemId];
}

/**
 * Gets all available item definitions.
 * @returns {object} An object containing all item definitions.
 */
export function getAllItemDefinitions() {
  return resourceData;
}