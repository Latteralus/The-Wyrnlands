// tests/unit/engines/survivalEngine.test.js
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// --- Hoisted Mocks ---
const { mockPlayerEngine, mockTimeEngine, mockUiManager } = vi.hoisted(() => {
    return {
        mockPlayerEngine: {
            modifyNeed: vi.fn(),
            getPlayerAttribute: vi.fn(),
            // updatePlayerAttributes: vi.fn(), // Not strictly needed for these tests yet
        },
        mockTimeEngine: {
            registerDailyCallback: vi.fn(),
        },
        mockUiManager: {
            showGameOver: vi.fn(),
        }
    };
});

// --- Mock Modules ---
vi.mock('@/engines/playerEngine.js', () => mockPlayerEngine);
vi.mock('@/engines/timeEngine.js', () => mockTimeEngine);
vi.mock('@/managers/uiManager.js', () => mockUiManager);

// --- Import Subject ---
import { initializeSurvivalEngine, applyDailySurvivalDecay } from '@/engines/survivalEngine.js';

// --- Test Suite ---
describe('Survival Engine', () => {

    beforeEach(() => {
        vi.clearAllMocks();
        // Default mock implementations
        mockPlayerEngine.getPlayerAttribute.mockImplementation((attr) => {
            if (attr === 'hunger') return 50;
            if (attr === 'thirst') return 50;
            if (attr === 'health') return 100;
            return undefined;
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    // --- Initialization Tests ---
    describe('initializeSurvivalEngine', () => {
        it('should register applyDailySurvivalDecay with timeEngine', () => {
            initializeSurvivalEngine();
            expect(mockTimeEngine.registerDailyCallback).toHaveBeenCalledOnce();
            expect(mockTimeEngine.registerDailyCallback).toHaveBeenCalledWith(applyDailySurvivalDecay);
        });
    });

    // --- Daily Decay Tests ---
    describe('applyDailySurvivalDecay', () => {
        it('should call modifyNeed for hunger and thirst with correct decay values', async () => {
            await applyDailySurvivalDecay();
            expect(mockPlayerEngine.modifyNeed).toHaveBeenCalledWith('hunger', -10.0); // DAILY_HUNGER_DECAY
            expect(mockPlayerEngine.modifyNeed).toHaveBeenCalledWith('thirst', -15.0); // DAILY_THIRST_DECAY
        });

        it('should apply health damage if hunger is zero or below', async () => {
            mockPlayerEngine.getPlayerAttribute.mockImplementation((attr) => {
                if (attr === 'hunger') return 0; // Hunger depleted
                if (attr === 'thirst') return 50;
                if (attr === 'health') return 100;
                return undefined;
            });
            await applyDailySurvivalDecay();
            expect(mockPlayerEngine.modifyNeed).toHaveBeenCalledWith('health', -5.0); // HEALTH_DAMAGE_PER_DAY
        });

        it('should apply health damage if thirst is zero or below', async () => {
            mockPlayerEngine.getPlayerAttribute.mockImplementation((attr) => {
                if (attr === 'hunger') return 50;
                if (attr === 'thirst') return 0; // Thirst depleted
                if (attr === 'health') return 100;
                return undefined;
            });
            await applyDailySurvivalDecay();
            expect(mockPlayerEngine.modifyNeed).toHaveBeenCalledWith('health', -5.0); // HEALTH_DAMAGE_PER_DAY
        });

         it('should apply health damage only once if both hunger and thirst are zero', async () => {
            mockPlayerEngine.getPlayerAttribute.mockImplementation((attr) => {
                if (attr === 'hunger') return 0;
                if (attr === 'thirst') return 0;
                if (attr === 'health') return 100;
                return undefined;
            });
            await applyDailySurvivalDecay();
            // modifyNeed for health should only be called once with -5.0
            const healthCalls = mockPlayerEngine.modifyNeed.mock.calls.filter(call => call[0] === 'health');
            expect(healthCalls.length).toBe(1);
            expect(healthCalls[0][1]).toBe(-5.0);
        });

        it('should NOT apply health damage if hunger and thirst are above zero', async () => {
            // Default mock implementation already has needs > 0
            await applyDailySurvivalDecay();
            expect(mockPlayerEngine.modifyNeed).not.toHaveBeenCalledWith('health', expect.any(Number));
        });

        it('should trigger death state if health reaches zero or below after damage', async () => {
            mockPlayerEngine.getPlayerAttribute.mockImplementation((attr) => {
                if (attr === 'hunger') return 0; // Trigger health damage
                if (attr === 'thirst') return 50;
                if (attr === 'health') return 5; // Health is low before damage
                return undefined;
            });
             // Mock modifyNeed for health to simulate the health dropping to 0
             const originalModifyNeed = mockPlayerEngine.modifyNeed;
             mockPlayerEngine.modifyNeed = vi.fn((need, amount) => {
                 if (need === 'health') {
                     // Simulate health check *after* modification
                     mockPlayerEngine.getPlayerAttribute.mockImplementationOnce((attr) => {
                         if (attr === 'health') return 0; // Health is now 0
                         return 50; // Other needs
                     });
                 }
                 // Call original mock logic if needed, or just track calls
                 originalModifyNeed(need, amount);
             });


            await applyDailySurvivalDecay();

            // Restore original mock after test if necessary (though beforeEach handles it)
            // mockPlayerEngine.modifyNeed = originalModifyNeed;

            expect(mockPlayerEngine.modifyNeed).toHaveBeenCalledWith('health', -5.0);
            expect(mockUiManager.showGameOver).toHaveBeenCalledOnce();
             expect(mockUiManager.showGameOver).toHaveBeenCalledWith(expect.any(String)); // Check if called with a message
        });

        it('should NOT trigger death state if health is above zero after damage', async () => {
            mockPlayerEngine.getPlayerAttribute.mockImplementation((attr) => {
                if (attr === 'hunger') return 0; // Trigger health damage
                if (attr === 'thirst') return 50;
                if (attr === 'health') return 10; // Health is sufficient before damage
                return undefined;
            });
             // Mock modifyNeed for health to simulate health dropping but not to zero
             const originalModifyNeed = mockPlayerEngine.modifyNeed;
             mockPlayerEngine.modifyNeed = vi.fn((need, amount) => {
                 if (need === 'health') {
                     // Simulate health check *after* modification
                     mockPlayerEngine.getPlayerAttribute.mockImplementationOnce((attr) => {
                         if (attr === 'health') return 5; // Health is now 5
                         return 50; // Other needs
                     });
                 }
                 originalModifyNeed(need, amount);
             });

            await applyDailySurvivalDecay();

            expect(mockPlayerEngine.modifyNeed).toHaveBeenCalledWith('health', -5.0);
            expect(mockUiManager.showGameOver).not.toHaveBeenCalled();
        });
    });
});