import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    BUILDING_SPECS, // Import the actual specs for comparison
    getBuildingSpecs,
    getMaterialCost,
    getLaborRequirement
} from '../../../src/utils/buildingUtils';
// Mock laborUtils if its constants are used and need mocking, but here we import directly
// import { LABOR_TYPES } from '../../../src/utils/laborUtils'; // Assuming LABOR_TYPES are stable

describe('buildingUtils', () => {

    beforeEach(() => {
        // Spy on console.warn
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('getBuildingSpecs', () => {
        it('should return the correct specs object for a valid building type', () => {
            const specs = getBuildingSpecs('House');
            // Compare with the imported specs, ensuring it's a deep copy (though structure is simple here)
            expect(specs).toEqual(BUILDING_SPECS['House']);
            expect(specs).not.toBe(BUILDING_SPECS['House']); // Ensure it's a copy
        });

        it('should return null and warn for an invalid building type', () => {
            const specs = getBuildingSpecs('Castle');
            expect(specs).toBeNull();
            expect(console.warn).toHaveBeenCalledWith('Building specs not found for type: Castle');
        });

        it('should return specs for another valid type (Workshop)', () => {
            const specs = getBuildingSpecs('Workshop');
            expect(specs).toEqual(BUILDING_SPECS['Workshop']);
        });
    });

    describe('getMaterialCost', () => {
        it('should return the correct material array for a valid building type', () => {
            const materials = getMaterialCost('House');
            expect(materials).toEqual(BUILDING_SPECS['House'].materials);
        });

        it('should return null for an invalid building type', () => {
            const materials = getMaterialCost('InvalidType');
            expect(materials).toBeNull();
            // getBuildingSpecs already warns, no need to check again here unless getMaterialCost adds its own warning
        });
    });

    describe('getLaborRequirement', () => {
        it('should return the correct labor array for a valid building type', () => {
            const labor = getLaborRequirement('Workshop');
            expect(labor).toEqual(BUILDING_SPECS['Workshop'].labor);
        });

        it('should return null for an invalid building type', () => {
            const labor = getLaborRequirement('DoesNotExist');
            expect(labor).toBeNull();
        });
    });

    // Optional: Test the structure of the BUILDING_SPECS itself
    describe('BUILDING_SPECS Structure', () => {
        it('should contain expected keys for House', () => {
            const houseSpecs = BUILDING_SPECS['House'];
            expect(houseSpecs).toHaveProperty('name');
            expect(houseSpecs).toHaveProperty('description');
            expect(houseSpecs).toHaveProperty('maxOccupants');
            expect(houseSpecs).toHaveProperty('baseSqFt');
            expect(houseSpecs).toHaveProperty('materials');
            expect(houseSpecs).toHaveProperty('labor');
            expect(houseSpecs).toHaveProperty('constructionTimeFactor');
            expect(houseSpecs).toHaveProperty('functions');
            expect(houseSpecs).toHaveProperty('taxModifier');
            expect(Array.isArray(houseSpecs.materials)).toBe(true);
            expect(Array.isArray(houseSpecs.labor)).toBe(true);
        });
    });
});