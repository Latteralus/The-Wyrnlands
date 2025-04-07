// tests/unit/engines/survivalEngine.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';

// No direct dependencies to mock for the core logic,
// but we might mock console or UI functions if testing death trigger side effects (which were removed).

// Import the functions to test
import {
    initializeSurvivalEngine,
    applySurvivalEffects
    // Constants are internal
} from '../../../src/engines/survivalEngine.js';

describe('Survival Engine', () => {

    beforeEach(() => {
        // Initialize engine before each test (currently does very little)
        initializeSurvivalEngine();
    });

    describe('applySurvivalEffects', () => {
        it('should apply normal daily decay to hunger and thirst', () => {
            const entityState = { id: 1, hunger: 100, thirst: 100, health: 100 };
            const result = applySurvivalEffects(entityState);

            // Check state modification
            expect(entityState.hunger).toBeCloseTo(90); // 100 - 10
            expect(entityState.thirst).toBeCloseTo(85); // 100 - 15
            expect(entityState.health).toBe(100); // No health damage

            // Check return value
            expect(result.needsChanged).toBe(true);
            expect(result.healthChanged).toBe(false);
            expect(result.healthDamage).toBe(0);
            expect(result.isDead).toBe(false);
        });

        it('should clamp hunger and thirst at 0', () => {
            const entityState = { id: 1, hunger: 5, thirst: 10, health: 100 };
            applySurvivalEffects(entityState);
            expect(entityState.hunger).toBe(0); // 5 - 10 clamped
            expect(entityState.thirst).toBe(0); // 10 - 15 clamped
        });

        it('should apply health damage if hunger is zero', () => {
            const entityState = { id: 1, hunger: 0, thirst: 50, health: 80 };
            const result = applySurvivalEffects(entityState);

            expect(entityState.hunger).toBe(0); // 0 - 10 clamped
            expect(entityState.thirst).toBeCloseTo(35); // 50 - 15
            expect(entityState.health).toBeCloseTo(75); // 80 - 5

            expect(result.needsChanged).toBe(true); // Thirst changed
            expect(result.healthChanged).toBe(true);
            expect(result.healthDamage).toBe(5); // HEALTH_DAMAGE_PER_DAY
            expect(result.isDead).toBe(false);
        });

        it('should apply health damage if thirst is zero', () => {
            const entityState = { id: 1, hunger: 50, thirst: 0, health: 80 };
            const result = applySurvivalEffects(entityState);

            expect(entityState.hunger).toBeCloseTo(40); // 50 - 10
            expect(entityState.thirst).toBe(0); // 0 - 15 clamped
            expect(entityState.health).toBeCloseTo(75); // 80 - 5

            expect(result.needsChanged).toBe(true); // Hunger changed
            expect(result.healthChanged).toBe(true);
            expect(result.healthDamage).toBe(5);
            expect(result.isDead).toBe(false);
        });

        it('should apply health damage only once if both hunger and thirst are zero', () => {
            const entityState = { id: 1, hunger: 0, thirst: 0, health: 80 };
            const result = applySurvivalEffects(entityState);

            expect(entityState.hunger).toBe(0);
            expect(entityState.thirst).toBe(0);
            expect(entityState.health).toBeCloseTo(75); // 80 - 5 (only once)

            expect(result.needsChanged).toBe(false); // Needs were already 0
            expect(result.healthChanged).toBe(true);
            expect(result.healthDamage).toBe(5);
            expect(result.isDead).toBe(false);
        });

        it('should clamp health at 0', () => {
            const entityState = { id: 1, hunger: 0, thirst: 50, health: 3 }; // Low health
            applySurvivalEffects(entityState);
            expect(entityState.health).toBe(0); // 3 - 5 clamped
        });

        it('should return isDead true if health reaches zero', () => {
            const entityState = { id: 1, hunger: 0, thirst: 50, health: 5 }; // Health will reach 0
            const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {}); // Suppress death log
            const result = applySurvivalEffects(entityState);

            expect(entityState.health).toBe(0);
            expect(result.isDead).toBe(true);
            expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('has died'));
            errorSpy.mockRestore();
        });

         it('should return isDead true if health starts at zero', () => {
            const entityState = { id: 1, hunger: 50, thirst: 50, health: 0 };
            const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            const result = applySurvivalEffects(entityState);

            expect(entityState.health).toBe(0); // Stays 0
            expect(result.isDead).toBe(true); // Already dead
            // Death message might not log again if health didn't change *this tick* to <= 0
            // Let's test if health damage occurs first
             const entityState2 = { id: 2, hunger: 0, thirst: 0, health: 0 };
             const result2 = applySurvivalEffects(entityState2);
             expect(entityState2.health).toBe(0); // Damage applied, clamped
             expect(result2.isDead).toBe(true);
             expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('has died')); // Should log death

            errorSpy.mockRestore();
        });

        it('should handle invalid entityState input gracefully', () => {
            const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            const result1 = applySurvivalEffects(null);
            const result2 = applySurvivalEffects({});
            const result3 = applySurvivalEffects({ hunger: 50, thirst: 'abc', health: 50 });

            expect(result1).toEqual({ needsChanged: false, healthChanged: false, healthDamage: 0, isDead: false });
            expect(result2).toEqual({ needsChanged: false, healthChanged: false, healthDamage: 0, isDead: false });
            expect(result3).toEqual({ needsChanged: false, healthChanged: false, healthDamage: 0, isDead: false });
            expect(errorSpy).toHaveBeenCalledTimes(3);
            // Adjust assertion to check the first argument (the message string)
            expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid entityState'), expect.anything());
            errorSpy.mockRestore();
        });
    });

});