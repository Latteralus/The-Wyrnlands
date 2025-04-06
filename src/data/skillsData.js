/**
 * @fileoverview Defines the skills available in The Wyrnlands.
 * This includes skill names, descriptions, and potentially configuration
 * for leveling, experience gain, etc.
 */

export const skillsData = {
  farming: {
    name: 'Farming',
    description: 'Cultivating crops and managing farmland.',
    initialLevel: 1,
    maxLevel: 100,
    // Add experience curve, effects per level, etc. later
  },
  carpentry: {
    name: 'Carpentry',
    description: 'Working with wood to build structures and items.',
    initialLevel: 1,
    maxLevel: 100,
  },
  masonry: {
    name: 'Masonry',
    description: 'Working with stone for construction.',
    initialLevel: 1,
    maxLevel: 100,
  },
  mining: {
    name: 'Mining',
    description: 'Extracting ores and minerals from the earth.',
    initialLevel: 1,
    maxLevel: 100,
  },
  // Add more skills as needed
};

/**
 * Gets the definition for a specific skill.
 * @param {string} skillId - The ID of the skill (e.g., 'farming').
 * @returns {object | undefined} The skill definition object or undefined if not found.
 */
export function getSkillDefinition(skillId) {
  return skillsData[skillId];
}

/**
 * Gets all available skill definitions.
 * @returns {object} An object containing all skill definitions.
 */
export function getAllSkillDefinitions() {
  return skillsData;
}