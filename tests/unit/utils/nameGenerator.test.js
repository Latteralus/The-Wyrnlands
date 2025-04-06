import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { generateName } from '../../../src/utils/nameGenerator';

// Import the lists to verify names come from them (optional but good practice)
import {
    MALE_FIRST_NAMES,
    FEMALE_FIRST_NAMES,
    LAST_NAME_PREFIXES,
    LAST_NAME_SUFFIXES
} from '../../../src/utils/nameGenerator'; // Adjust path if lists aren't exported

describe('nameGenerator', () => {

    beforeEach(() => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        // Optional: Seed Math.random for predictable tests if needed, but usually testing format/source is enough.
        // vi.spyOn(Math, 'random').mockReturnValue(0.5); // Example seeding
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should return a string', () => {
        const name = generateName();
        expect(typeof name).toBe('string');
    });

    it('should return a name with two parts (first and last)', () => {
        const name = generateName();
        const parts = name.split(' ');
        expect(parts.length).toBe(2);
        expect(parts[0]).not.toBe(''); // First name shouldn't be empty
        expect(parts[1]).not.toBe(''); // Last name shouldn't be empty
    });

    it('should generate a first name from the MALE list by default or when gender is "male" or "any"', () => {
        for (let i = 0; i < 10; i++) { // Run a few times due to randomness
            const name = generateName('male');
            const firstName = name.split(' ')[0];
            expect(MALE_FIRST_NAMES).toContain(firstName);
        }
         for (let i = 0; i < 10; i++) {
            const name = generateName('any');
            const firstName = name.split(' ')[0];
            expect(MALE_FIRST_NAMES).toContain(firstName);
        }
         for (let i = 0; i < 10; i++) {
            const name = generateName(); // Default is 'any' -> male list
            const firstName = name.split(' ')[0];
            expect(MALE_FIRST_NAMES).toContain(firstName);
        }
    });

    it('should generate a first name from the FEMALE list when gender is "female"', () => {
         // Ensure female list is not empty before testing
         if (FEMALE_FIRST_NAMES.length > 0) {
            for (let i = 0; i < 10; i++) { // Run a few times
                const name = generateName('female');
                const firstName = name.split(' ')[0];
                expect(FEMALE_FIRST_NAMES).toContain(firstName);
            }
         } else {
             // If female list is empty, it should fall back to male list
             const name = generateName('female');
             const firstName = name.split(' ')[0];
             expect(MALE_FIRST_NAMES).toContain(firstName);
         }
    });

    it('should generate a last name composed of a prefix and suffix from the lists', () => {
        for (let i = 0; i < 10; i++) { // Run a few times
            const name = generateName();
            const lastName = name.split(' ')[1];
            let foundMatch = false;
            for (const prefix of LAST_NAME_PREFIXES) {
                for (const suffix of LAST_NAME_SUFFIXES) {
                    if (lastName === prefix + suffix) {
                        foundMatch = true;
                        break;
                    }
                }
                if (foundMatch) break;
            }
            expect(foundMatch, `Last name "${lastName}" not formed from prefix+suffix`).toBe(true);
        }
    });

     it('should log the generated name and gender', () => {
        generateName('female');
        expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Generated name (female):'));
        generateName();
        expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Generated name (any):'));
    });

});