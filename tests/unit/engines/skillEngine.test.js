// tests/unit/engines/skillEngine.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the database module
vi.mock('../../../src/data/database.js', () => ({
    run: vi.fn(),
    get: vi.fn(),
    all: vi.fn(), // Not used by skillEngine directly, but good practice
}));

// Import the functions to test AFTER mocks are set up
import {
    initializeSkillEngine,
    addSkillXP,
    getSkill,
    calculateSkillModifiers
    // MAX_SKILL_LEVEL and calculateXpForNextLevel are internal constants/helpers
} from '../../../src/engines/skillEngine.js';
import { run, get } from '../../../src/data/database.js';

describe('Skill Engine', () => {

    beforeEach(() => {
        // Reset mocks and initialize engine before each test
        vi.clearAllMocks();
        initializeSkillEngine(); // Assumes initialize is synchronous and simple
    });

    describe('getSkill', () => {
        it('should return skill level and XP if found in DB', async () => {
            get.mockResolvedValue({ level: 5, experience: 120 });
            const skillData = await getSkill('Player', 1, 'Farming');
            expect(get).toHaveBeenCalledWith(
                'SELECT level, experience FROM Skills WHERE owner_id = ? AND owner_type = ? AND skill_name = ?',
                [1, 'Player', 'Farming']
            );
            expect(skillData).toEqual({ level: 5, xp: 120 });
        });

        it('should return default level 1, 0 XP if skill not found in DB', async () => {
            get.mockResolvedValue(null); // Simulate skill not found
            const skillData = await getSkill('NPC', 10, 'Mining');
            expect(get).toHaveBeenCalledWith(
                'SELECT level, experience FROM Skills WHERE owner_id = ? AND owner_type = ? AND skill_name = ?',
                [10, 'NPC', 'Mining']
            );
            expect(skillData).toEqual({ level: 1, xp: 0 });
        });

        it('should return default level 1, 0 XP on database error', async () => {
            get.mockRejectedValue(new Error('DB Error'));
            const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            const skillData = await getSkill('Player', 1, 'Farming');
            expect(skillData).toEqual({ level: 1, xp: 0 });
            expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Error getting skill'), expect.any(Error));
            errorSpy.mockRestore();
        });
    });

    describe('addSkillXP', () => {
        // Mock calculateXpForNextLevel (internal helper) if needed, or test its effects
        // For level * 100: Lvl 1->2 needs 100 XP, Lvl 2->3 needs 200 XP

        it('should add XP without leveling up', async () => {
            get.mockResolvedValue({ level: 1, experience: 50 }); // Start at Lvl 1, 50 XP
            run.mockResolvedValue({ changes: 1 }); // Mock successful update

            const result = await addSkillXP('Player', 1, 'Farming', 20); // Add 20 XP

            expect(get).toHaveBeenCalledTimes(1);
            expect(run).toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO Skills'), // UPSERT SQL
                [1, 'Player', 'Farming', 1, 70] // ID, Type, Name, New Level, New XP (50+20)
            );
            expect(result).toEqual({ levelChanged: false, newLevel: 1 });
        });

        it('should add XP and level up once', async () => {
            get.mockResolvedValue({ level: 1, experience: 80 }); // Start at Lvl 1, 80 XP
            run.mockResolvedValue({ changes: 1 });

            const result = await addSkillXP('Player', 1, 'Farming', 30); // Add 30 XP (Total 110)

            expect(get).toHaveBeenCalledTimes(1);
            // Level 1 needs 100 XP. 110 >= 100. Level up!
            // New Level = 2. Remaining XP = 110 - 100 = 10.
            expect(run).toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO Skills'),
                [1, 'Player', 'Farming', 2, 10] // ID, Type, Name, New Level, New XP
            );
            expect(result).toEqual({ levelChanged: true, newLevel: 2 });
        });

        it('should add XP and level up multiple times', async () => {
            get.mockResolvedValue({ level: 1, experience: 50 }); // Start Lvl 1, 50 XP
            run.mockResolvedValue({ changes: 1 });

            const result = await addSkillXP('Player', 1, 'Farming', 300); // Add 300 XP (Total 350)

            expect(get).toHaveBeenCalledTimes(1);
            // Lvl 1 -> 2 needs 100 XP (350 >= 100). Lvl = 2, XP = 250.
            // Lvl 2 -> 3 needs 200 XP (250 >= 200). Lvl = 3, XP = 50.
            // Lvl 3 -> 4 needs 300 XP (50 < 300). Stop.
            expect(run).toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO Skills'),
                [1, 'Player', 'Farming', 3, 50] // Final Level 3, 50 XP
            );
            expect(result).toEqual({ levelChanged: true, newLevel: 3 });
        });

        it('should handle leveling up exactly to threshold', async () => {
            get.mockResolvedValue({ level: 1, experience: 0 });
            run.mockResolvedValue({ changes: 1 });
            const result = await addSkillXP('Player', 1, 'Farming', 100); // Add exactly 100 XP
            // Lvl 1 -> 2 needs 100 XP (100 >= 100). Lvl = 2, XP = 0.
            expect(run).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO Skills'), [1, 'Player', 'Farming', 2, 0]);
            expect(result).toEqual({ levelChanged: true, newLevel: 2 });
        });

        it('should initialize skill if not found before adding XP', async () => {
            get.mockResolvedValue(null); // Skill not found
            run.mockResolvedValue({ changes: 1 });
            const result = await addSkillXP('NPC', 5, 'Mining', 20); // Add 20 XP
            // Starts at Lvl 1, 0 XP. Adds 20 XP.
            // Lvl 1 -> 2 needs 100 XP (20 < 100). No level up.
            expect(get).toHaveBeenCalledTimes(1);
            expect(run).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO Skills'), [5, 'NPC', 'Mining', 1, 20]);
            expect(result).toEqual({ levelChanged: false, newLevel: 1 });
        });

        it('should not add XP if already at max level', async () => {
             const MAX_SKILL_LEVEL = 100; // Assuming internal constant is 100
             get.mockResolvedValue({ level: MAX_SKILL_LEVEL, experience: 50 }); // Already max level
             const result = await addSkillXP('Player', 1, 'Farming', 1000);
             expect(run).not.toHaveBeenCalled(); // Should not attempt to update DB
             expect(result).toEqual({ levelChanged: false, newLevel: MAX_SKILL_LEVEL });
        });

         it('should cap XP at 0 when reaching max level', async () => {
             const MAX_SKILL_LEVEL = 100;
             // Need level 99 and enough XP to hit 100
             const xpNeededForLvl100 = 99 * 100;
             get.mockResolvedValue({ level: 99, experience: xpNeededForLvl100 - 10 }); // 10 XP away from level 100
             run.mockResolvedValue({ changes: 1 });

             const result = await addSkillXP('Player', 1, 'Farming', 50); // Add 50 XP (Total > needed)

             expect(get).toHaveBeenCalledTimes(1);
             // Lvl 99 -> 100 needs 9900 XP. Have 9890 + 50 = 9940. Level up!
             // New Level = 100. XP capped at 0.
             expect(run).toHaveBeenCalledWith(
                 expect.stringContaining('INSERT INTO Skills'),
                 [1, 'Player', 'Farming', 100, 0] // Final Level 100, 0 XP
             );
             expect(result).toEqual({ levelChanged: true, newLevel: 100 });
         });

        it('should return no change if xpToAdd is zero or negative', async () => {
            expect(await addSkillXP('Player', 1, 'Farming', 0)).toEqual({ levelChanged: false, newLevel: 0 });
            expect(await addSkillXP('Player', 1, 'Farming', -10)).toEqual({ levelChanged: false, newLevel: 0 });
            expect(get).not.toHaveBeenCalled();
            expect(run).not.toHaveBeenCalled();
        });

        it('should return no change on database error', async () => {
            get.mockResolvedValue({ level: 1, experience: 50 });
            run.mockRejectedValue(new Error('DB Error')); // Simulate update failure
            const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            const result = await addSkillXP('Player', 1, 'Farming', 20);
            expect(result).toEqual({ levelChanged: false, newLevel: 0 });
            expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Error adding skill XP'), expect.any(Error));
            errorSpy.mockRestore();
        });
    });

    describe('calculateSkillModifiers', () => {
        // Test the specific formula used
        it('should calculate modifiers correctly for level 1', () => {
            // Actual formula: bonus = level * 0.1 = 1 * 0.1 = 0.1
            // wage = 1.0 + 0.1 = 1.1
            // output = 1.0 + 0.1 * 1.5 = 1.15
            expect(calculateSkillModifiers('Farming', 1)).toEqual({
                wageMultiplier: 1.1,
                outputMultiplier: 1.15
            });
        });

        it('should calculate modifiers correctly for level 5', () => {
             // Actual formula: bonus = level * 0.1 = 5 * 0.1 = 0.5
             // wage = 1.0 + 0.5 = 1.5
             // output = 1.0 + 0.5 * 1.5 = 1.75
            expect(calculateSkillModifiers('Mining', 5)).toEqual({
                wageMultiplier: 1.5,
                outputMultiplier: 1.75
            });
        });


         it('should calculate modifiers correctly for level 10', () => {
             // Actual formula: bonus = level * 0.1 = 10 * 0.1 = 1.0
             // wage = 1.0 + 1.0 = 2.0
             // output = 1.0 + 1.0 * 1.5 = 2.5
            expect(calculateSkillModifiers('Carpentry', 10)).toEqual({
                wageMultiplier: 2.0,
                outputMultiplier: 2.5
            });
        });
        // Removed redundant test case that tested the actual code formula,
        // as all tests now use the actual formula.

    });

});