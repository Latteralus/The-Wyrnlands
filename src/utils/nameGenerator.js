/**
 * @module nameGenerator
 * @description Generates names, potentially based on cultural styles (e.g., Saxon).
 */

// Simple placeholder lists
const MALE_FIRST_NAMES = ['Aethelred', 'Beowulf', 'Ceol', 'Dunstan', 'Eadric', 'Leofric'];
const FEMALE_FIRST_NAMES = ['Aelfgifu', 'Bertha', 'Cyneburh', 'Eadgyth', 'Frideswide', 'Mildrith'];
const LAST_NAME_PREFIXES = ['Ash', 'Black', 'Fair', 'Grim', 'Long', 'Stone'];
const LAST_NAME_SUFFIXES = ['wood', 'well', 'ford', 'shaw', 'croft', 'by'];

/**
 * Generates a random name.
 * In a real implementation, this could be much more sophisticated, considering gender, culture, etc.
 *
 * @param {string} [gender='any'] - Optional gender ('male', 'female', 'any'). Currently ignored by placeholder.
 * @returns {string} A randomly generated full name.
 */
function generateName(gender = 'any') {
    // Simple placeholder: pick randomly from lists
    const firstNameList = (gender === 'female' && FEMALE_FIRST_NAMES.length > 0) ? FEMALE_FIRST_NAMES : MALE_FIRST_NAMES;
    const firstName = firstNameList[Math.floor(Math.random() * firstNameList.length)];

    const prefix = LAST_NAME_PREFIXES[Math.floor(Math.random() * LAST_NAME_PREFIXES.length)];
    const suffix = LAST_NAME_SUFFIXES[Math.floor(Math.random() * LAST_NAME_SUFFIXES.length)];
    const lastName = prefix + suffix;

    const fullName = `${firstName} ${lastName}`;
    console.log(`Generated name (${gender}): ${fullName}`); // Log for debugging
    return fullName;
}


export { generateName, MALE_FIRST_NAMES, FEMALE_FIRST_NAMES, LAST_NAME_PREFIXES, LAST_NAME_SUFFIXES }; // Export lists for testing