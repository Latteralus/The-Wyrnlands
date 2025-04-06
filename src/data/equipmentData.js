/**
 * @fileoverview Defines equipment items available in The Wyrnlands.
 * This includes armor, clothing, and potentially accessories.
 */

export const equipmentData = {
  // --- Armor ---
  leather_helmet: {
    id: 'leather_helmet',
    name: 'Leather Helmet',
    type: 'armor', // 'armor', 'clothing', 'accessory'
    slot: 'head', // 'head', 'body', 'legs', 'feet', 'hands', 'accessory1', 'accessory2'
    defense: 2,
    durability: 50,
    material: 'leather',
    weight: 1,
    value: 10,
  },
  leather_tunic: {
    id: 'leather_tunic',
    name: 'Leather Tunic',
    type: 'armor',
    slot: 'body',
    defense: 5,
    durability: 80,
    material: 'leather',
    weight: 3,
    value: 25,
  },
  // --- Clothing ---
  simple_shirt: {
    id: 'simple_shirt',
    name: 'Simple Shirt',
    type: 'clothing',
    slot: 'body',
    defense: 0,
    durability: 30,
    material: 'cloth',
    weight: 0.5,
    value: 5,
    insulation: 1, // Example property for warmth/cold resistance
  },
  // Add more equipment items as needed
};

/**
 * Gets the definition for a specific equipment item.
 * @param {string} equipmentId - The ID of the equipment (e.g., 'leather_helmet').
 * @returns {object | undefined} The equipment definition object or undefined if not found.
 */
export function getEquipmentDefinition(equipmentId) {
  return equipmentData[equipmentId];
}

/**
 * Gets all available equipment definitions.
 * @returns {object} An object containing all equipment definitions.
 */
export function getAllEquipmentDefinitions() {
  return equipmentData;
}