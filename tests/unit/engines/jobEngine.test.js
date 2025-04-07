// tests/unit/engines/jobEngine.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the database module
vi.mock('../../../src/data/database.js', () => ({
    run: vi.fn(),
    get: vi.fn(),
    all: vi.fn(),
}));

// Mock the skillEngine module
vi.mock('../../../src/engines/skillEngine.js', () => ({
    getSkill: vi.fn(),
    addSkillXP: vi.fn(),
    calculateSkillModifiers: vi.fn(),
}));

// Mock economyUtils and inventoryUtils (as their implementations are complex/tested separately)
vi.mock('../../../src/utils/economyUtils.js', () => ({
    processTransaction: vi.fn(),
}));
vi.mock('../../../src/utils/inventoryUtils.js', () => ({
    addItem: vi.fn(),
}));


// Import the functions to test AFTER mocks are set up
import {
    initializeJobEngine,
    assignJob,
    removeJob,
    processWorkShift
    // jobDefinitions is internal
} from '../../../src/engines/jobEngine.js';
import { run, get } from '../../../src/data/database.js';
import { getSkill, addSkillXP, calculateSkillModifiers } from '../../../src/engines/skillEngine.js';
import { processTransaction } from '../../../src/utils/economyUtils.js';
import { addItem } from '../../../src/utils/inventoryUtils.js';


describe('Job Engine', () => {

    beforeEach(() => {
        // Reset mocks and initialize engine
        vi.clearAllMocks();
        initializeJobEngine(); // Assumes simple synchronous init
    });

    describe('assignJob', () => {
        it('should update Player table for player job assignment', async () => {
            run.mockResolvedValue({ changes: 1 });
            const success = await assignJob('Player', 1, 'Farmer', 10, 'Household');
            expect(run).toHaveBeenCalledWith(
                expect.stringContaining('UPDATE Player SET current_job_type = ?, employer_id = ?, employer_type = ?'),
                ['Farmer', 10, 'Household', 1]
            );
            expect(success).toBe(true);
        });

        it('should update NPCs table for NPC job assignment', async () => {
            run.mockResolvedValue({ changes: 1 });
            const success = await assignJob('NPC', 5, 'Miner', 2, 'Business');
            expect(run).toHaveBeenCalledWith(
                expect.stringContaining('UPDATE NPCs SET current_job_type = ?, employer_id = ?, employer_type = ?'),
                ['Miner', 2, 'Business', 5]
            );
            expect(success).toBe(true);
        });

        it('should handle null employer', async () => {
            run.mockResolvedValue({ changes: 1 });
            const success = await assignJob('Player', 1, 'Farmer', null, null);
            expect(run).toHaveBeenCalledWith(
                expect.stringContaining('UPDATE Player SET current_job_type = ?, employer_id = ?, employer_type = ?'),
                ['Farmer', null, null, 1]
            );
            expect(success).toBe(true);
        });

        it('should return false if job type is unknown', async () => {
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            const success = await assignJob('Player', 1, 'UnknownJob', null, null);
            expect(run).not.toHaveBeenCalled();
            expect(success).toBe(false);
            expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Unknown job type'));
            warnSpy.mockRestore();
        });

        it('should return false if DB update fails', async () => {
            run.mockResolvedValue({ changes: 0 }); // Simulate no rows updated
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            const success = await assignJob('Player', 1, 'Farmer', null, null);
            expect(run).toHaveBeenCalled();
            expect(success).toBe(false);
            expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('not found or no changes made'));
            warnSpy.mockRestore();
        });

        it('should return false on DB error', async () => {
            run.mockRejectedValue(new Error('DB Error'));
            const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            const success = await assignJob('Player', 1, 'Farmer', null, null);
            expect(run).toHaveBeenCalled();
            expect(success).toBe(false);
            expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Error assigning job'), expect.any(Error));
            errorSpy.mockRestore();
        });
    });

    describe('removeJob', () => {
         it('should update Player table for player job removal', async () => {
            run.mockResolvedValue({ changes: 1 });
            const success = await removeJob('Player', 1);
            expect(run).toHaveBeenCalledWith(
                expect.stringContaining('UPDATE Player SET current_job_type = NULL, employer_id = NULL, employer_type = NULL'),
                [1]
            );
            expect(success).toBe(true);
        });

        it('should update NPCs table for NPC job removal', async () => {
            run.mockResolvedValue({ changes: 1 });
            const success = await removeJob('NPC', 5);
            expect(run).toHaveBeenCalledWith(
                expect.stringContaining('UPDATE NPCs SET current_job_type = NULL, employer_id = NULL, employer_type = NULL'),
                [5]
            );
            expect(success).toBe(true);
        });

        it('should return false if DB update fails (no changes)', async () => {
            run.mockResolvedValue({ changes: 0 });
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            const success = await removeJob('Player', 1);
            expect(run).toHaveBeenCalled();
            expect(success).toBe(false);
             expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('not found or no changes made'));
            warnSpy.mockRestore();
        });

         it('should return false on DB error', async () => {
            run.mockRejectedValue(new Error('DB Error'));
            const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            const success = await removeJob('Player', 1);
            expect(run).toHaveBeenCalled();
            expect(success).toBe(false);
            expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Error removing job'), expect.any(Error));
            errorSpy.mockRestore();
        });
    });

    describe('processWorkShift', () => {
        const mockPlayerData = { current_job_type: 'Farmer', employer_id: 10, employer_type: 'Household', household_id: 1 };
        const mockNpcData = { current_job_type: 'Miner', employer_id: 5, employer_type: 'Business', household_id: 2 };
        const mockSelfEmployedData = { current_job_type: 'Farmer', employer_id: null, employer_type: null, household_id: 1 };

        beforeEach(() => {
            // Mock default skill engine responses
            getSkill.mockResolvedValue({ level: 1, xp: 0 });
            calculateSkillModifiers.mockReturnValue({ wageMultiplier: 1.0, outputMultiplier: 1.0 }); // Base modifiers for level 1
            addSkillXP.mockResolvedValue({ levelChanged: false, newLevel: 1 });
            // Mock successful transaction/item add by default
            processTransaction.mockResolvedValue(true);
            addItem.mockResolvedValue(true);
        });

        it('should do nothing if entity has no job', async () => {
            get.mockResolvedValue({ current_job_type: null }); // No job
            await processWorkShift('Player', 1);
            expect(getSkill).not.toHaveBeenCalled();
            expect(processTransaction).not.toHaveBeenCalled();
            expect(addItem).not.toHaveBeenCalled();
            expect(addSkillXP).not.toHaveBeenCalled();
        });

        it('should do nothing if job definition is not found', async () => {
            get.mockResolvedValue({ current_job_type: 'UnknownJob', employer_id: null, employer_type: null, household_id: 1 });
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            await processWorkShift('Player', 1);
            expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Job definition not found'));
            expect(getSkill).not.toHaveBeenCalled();
            warnSpy.mockRestore();
        });

        it('should process employed work shift correctly (payment, output, XP)', async () => {
            get.mockResolvedValue(mockNpcData); // NPC Miner employed by Business 5
            getSkill.mockResolvedValue({ level: 3, xp: 50 }); // Skill level 3
            calculateSkillModifiers.mockReturnValue({ wageMultiplier: 1.1, outputMultiplier: 1.2 }); // Example modifiers for Lvl 3

            await processWorkShift('NPC', 123); // NPC ID 123

            // Check skill interaction
            expect(getSkill).toHaveBeenCalledWith('NPC', 123, 'mining'); // Correct skill for Miner
            expect(calculateSkillModifiers).toHaveBeenCalledWith('mining', 3);

            // Check payment (Wage = 8 * 1.1 = 8.8 -> rounded 9)
            expect(processTransaction).toHaveBeenCalledWith(
                5,          // Employer ID (Business 5)
                'Business', // Employer Type
                2,          // Payee Household ID (Household 2)
                'Household',// Payee Type
                9,          // Calculated wage
                'Wage for Miner' // Reason
            );

            // Check output (Output = 1 * 1.2 = 1.2 -> floor 1)
            expect(addItem).toHaveBeenCalledWith(
                'Business', // Employer Type
                5,          // Employer ID
                'Stone',    // Output Item
                1           // Calculated quantity (floored)
            );

            // Check XP gain (XP = 1 * 1.0 = 1 -> rounded 1)
            expect(addSkillXP).toHaveBeenCalledWith('NPC', 123, 'mining', 1);
        });

        it('should process self-employed work shift correctly (output, XP, no payment)', async () => {
            get.mockResolvedValue(mockSelfEmployedData); // Player Farmer, self-employed
            getSkill.mockResolvedValue({ level: 2, xp: 10 }); // Skill level 2
            calculateSkillModifiers.mockReturnValue({ wageMultiplier: 1.05, outputMultiplier: 1.1 }); // Example modifiers for Lvl 2

            await processWorkShift('Player', 1);

            // Check skill interaction
            expect(getSkill).toHaveBeenCalledWith('Player', 1, 'farming');
            expect(calculateSkillModifiers).toHaveBeenCalledWith('farming', 2);

            // Check NO payment called
            expect(processTransaction).not.toHaveBeenCalled();

            // Check output (Output = 2 * 1.1 = 2.2 -> floor 2)
            expect(addItem).toHaveBeenCalledWith(
                'Household', // Entity's Household
                1,           // Entity's Household ID
                'Wheat',     // Output Item
                2            // Calculated quantity (floored)
            );

            // Check XP gain (XP = 1 * 1.0 = 1 -> rounded 1)
            expect(addSkillXP).toHaveBeenCalledWith('Player', 1, 'farming', 1);
        });

         it('should handle database error during entity data fetch', async () => {
            get.mockRejectedValue(new Error('DB Get Error'));
            const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            await processWorkShift('Player', 1);
            expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Error processing work shift'), expect.any(Error));
            expect(getSkill).not.toHaveBeenCalled(); // Should fail before skill check
            errorSpy.mockRestore();
        });

        // Add more tests for edge cases:
        // - What if entity has no household_id? (Payment/output should fail gracefully)
        // - What if skill engine calls fail?
        // - What if economy/inventory calls fail?
    });

});