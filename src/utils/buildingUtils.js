/**
 * @module buildingUtils
 * @description Provides specifications and utility functions related to building types.
 * Centralizes data like material costs, labor requirements, size, etc.
 */

import { LABOR_TYPES } from './laborUtils.js'; // Assuming labor types are defined here

// Define specifications for different building types
// This structure can be expanded significantly
const BUILDING_SPECS = {
    'House': {
        name: 'House',
        description: 'A simple dwelling for a small family.',
        maxOccupants: 4,
        baseSqFt: 600, // Base size
        materials: [ // Materials needed for construction
            { item: 'Wood', quantity: 50 },
            { item: 'Stone', quantity: 20 },
            { item: 'Nails', quantity: 100 }, // Example material
        ],
        labor: [ // Labor units needed for construction
            { type: LABOR_TYPES.GENERAL, amount: 40 },
            { type: LABOR_TYPES.CARPENTRY, amount: 60 },
        ],
        constructionTimeFactor: 1.0, // Base time factor (can adjust per building)
        functions: ['housing', 'storage'], // What the building can do
        taxModifier: 1.0, // Base tax rate modifier
    },
    'Workshop': {
        name: 'Workshop',
        description: 'A place for crafting and production.',
        maxOccupants: 2, // Workers
        baseSqFt: 400,
        materials: [
            { item: 'Wood', quantity: 80 },
            { item: 'Stone', quantity: 40 },
            { item: 'Nails', quantity: 150 },
        ],
        labor: [
            { type: LABOR_TYPES.GENERAL, amount: 50 },
            { type: LABOR_TYPES.CARPENTRY, amount: 40 },
            { type: LABOR_TYPES.MASONRY, amount: 20 }, // Requires some masonry
        ],
        constructionTimeFactor: 1.2,
        functions: ['production', 'storage'],
        taxModifier: 1.5, // Higher tax potential
    },
    // Add other building types like 'Farm', 'Mill', 'Bakery', 'QuarryShed', etc.
};

/**
 * Retrieves the specifications for a given building type.
 *
 * @param {string} buildingType - The name of the building type (e.g., 'House').
 * @returns {object | null} - The specification object for the building type, or null if not found.
 */
function getBuildingSpecs(buildingType) {
    if (BUILDING_SPECS[buildingType]) {
        // Return a copy to prevent accidental modification of the original specs
        return JSON.parse(JSON.stringify(BUILDING_SPECS[buildingType]));
    } else {
        console.warn(`Building specs not found for type: ${buildingType}`);
        return null;
    }
}

/**
 * Calculates the total material cost for a building type.
 * (Could be expanded later to factor in market prices).
 *
 * @param {string} buildingType - The name of the building type.
 * @returns {Array<object> | null} - An array of { item, quantity } objects, or null if type not found.
 */
function getMaterialCost(buildingType) {
    const specs = getBuildingSpecs(buildingType);
    return specs ? specs.materials : null;
}

/**
 * Calculates the total labor required for a building type.
 *
 * @param {string} buildingType - The name of the building type.
 * @returns {Array<object> | null} - An array of { type, amount } objects, or null if type not found.
 */
function getLaborRequirement(buildingType) {
    const specs = getBuildingSpecs(buildingType);
    return specs ? specs.labor : null;
}

export {
    BUILDING_SPECS,
    getBuildingSpecs,
    getMaterialCost,
    getLaborRequirement
};