/**
 * @fileoverview Defines tools available in The Wyrnlands.
 * This includes tools for crafting, gathering, farming, etc.
 */

export const toolsData = {
  stone_axe: {
    id: 'stone_axe',
    name: 'Stone Axe',
    type: 'tool',
    toolType: 'axe', // Specific type for skill checks/effectiveness (axe, pickaxe, hoe, hammer, etc.)
    skill: 'carpentry', // Primary skill associated
    effectiveness: 1, // Base effectiveness multiplier
    durability: 30,
    material: 'stone',
    weight: 2,
    value: 5,
    actions: ['chop_wood', 'combat'], // Possible actions this tool enables/improves
  },
  stone_pickaxe: {
    id: 'stone_pickaxe',
    name: 'Stone Pickaxe',
    type: 'tool',
    toolType: 'pickaxe',
    skill: 'mining',
    effectiveness: 1,
    durability: 30,
    material: 'stone',
    weight: 2.5,
    value: 5,
    actions: ['mine_stone', 'mine_ore'],
  },
  wooden_hoe: {
    id: 'wooden_hoe',
    name: 'Wooden Hoe',
    type: 'tool',
    toolType: 'hoe',
    skill: 'farming',
    effectiveness: 1,
    durability: 20,
    material: 'wood',
    weight: 1.5,
    value: 3,
    actions: ['till_soil', 'plant_seeds'],
  },
  // Add more tools as needed
};

/**
 * Gets the definition for a specific tool.
 * @param {string} toolId - The ID of the tool (e.g., 'stone_axe').
 * @returns {object | undefined} The tool definition object or undefined if not found.
 */
export function getToolDefinition(toolId) {
  return toolsData[toolId];
}

/**
 * Gets all available tool definitions.
 * @returns {object} An object containing all tool definitions.
 */
export function getAllToolDefinitions() {
  return toolsData;
}