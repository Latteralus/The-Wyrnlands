// tests/unit/data/mountData.test.js
import { describe, it, expect } from 'vitest';
import { getMountData, MOUNT_DATA } from '@/data/mountData.js'; // Use path alias

describe('Mount Data', () => {

    it('should export MOUNT_DATA object', () => {
        expect(MOUNT_DATA).toBeDefined();
        expect(typeof MOUNT_DATA).toBe('object');
        expect(MOUNT_DATA.horse).toBeDefined(); // Check for a known mount
    });

    describe('getMountData', () => {
        it('should return correct data for a known mount ID (horse)', () => {
            const horseData = getMountData('horse');
            expect(horseData).not.toBeNull();
            expect(horseData.id).toBe('horse');
            expect(horseData.name).toBe('Horse');
            expect(horseData.speedModifier).toBe(1.8);
            expect(horseData.fatigueModifier).toBe(0.7);
            expect(horseData.carryingCapacityBonus).toBe(50);
        });

        it('should return correct data for another known mount ID (cart_horse)', () => {
            const cartHorseData = getMountData('cart_horse');
            expect(cartHorseData).not.toBeNull();
            expect(cartHorseData.id).toBe('cart_horse');
            expect(cartHorseData.name).toBe('Horse and Cart');
            expect(cartHorseData.speedModifier).toBe(1.2);
            expect(cartHorseData.fatigueModifier).toBe(1.0);
            expect(cartHorseData.carryingCapacityBonus).toBe(250);
        });

        it('should return null for an unknown mount ID', () => {
            const unknownData = getMountData('griffin');
            expect(unknownData).toBeNull();
        });

        it('should return null for invalid input (null, undefined, number)', () => {
            expect(getMountData(null)).toBeNull();
            expect(getMountData(undefined)).toBeNull();
            expect(getMountData(123)).toBeNull();
        });
    });
});