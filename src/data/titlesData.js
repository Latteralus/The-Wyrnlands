// src/data/titlesData.js
// Defines the titles and nobility system in The Wyrnlands.

// Titles are ordered generally by rank/prestige.
// Specific requirements (reputation, wealth, quests) for achieving titles
// will be handled by game logic (e.g., reputationEngine, questEngine).

const titles = [
    {
        id: 'commoner',
        name: 'Commoner',
        rank: 0,
        description: 'A regular inhabitant with basic rights.',
        privileges: [], // e.g., basic market access
    },
    {
        id: 'freeman',
        name: 'Freeman',
        rank: 1,
        description: 'A commoner who owns land or a small business.',
        privileges: ['own_small_plot', 'own_basic_business'],
    },
    {
        id: 'citizen',
        name: 'Citizen',
        rank: 2,
        description: 'A respected member of the community, possibly a guild member.',
        privileges: ['vote_local_council', 'join_guild'], // Example privileges
    },
    {
        id: 'burgher',
        name: 'Burgher',
        rank: 3,
        description: 'An influential citizen, often a master craftsman or merchant.',
        privileges: ['own_multiple_businesses', 'guild_master_eligible'],
    },
    {
        id: 'reeve',
        name: 'Reeve',
        rank: 4,
        description: 'A local official appointed or elected to oversee village matters.',
        privileges: ['enforce_local_bylaws', 'collect_minor_taxes'],
        isOfficial: true, // Flag for official positions
    },
    {
        id: 'knight',
        name: 'Knight',
        rank: 5,
        description: 'A warrior granted land and title, often in service to a lord.',
        privileges: ['hold_manor', 'command_militia', 'attend_court'],
        requiresFealty: true, // May require swearing fealty
    },
    {
        id: 'baron',
        name: 'Baron', // Or Baroness
        rank: 6,
        description: 'A noble holding significant lands directly from a higher authority.',
        privileges: ['hold_barony', 'judge_local_disputes', 'high_court_access'],
        isNoble: true, // Flag for nobility
    },
    // Add higher ranks like Earl, Duke, etc. as needed
];

/**
 * Gets the definition for a specific title ID.
 * @param {string} titleId - The ID of the title (e.g., 'freeman').
 * @returns {object | undefined} The title definition object or undefined if not found.
 */
function getTitleDefinition(titleId) {
    return titles.find(title => title.id === titleId);
}

/**
 * Gets all defined titles.
 * @returns {Array<object>} An array of all title definition objects.
 */
function getAllTitles() {
    return [...titles]; // Return a copy
}

export {
    titles,
    getTitleDefinition,
    getAllTitles,
};