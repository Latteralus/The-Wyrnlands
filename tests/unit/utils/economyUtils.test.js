// tests/unit/utils/economyUtils.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the database module
vi.mock('../../../src/data/database.js', () => ({
    run: vi.fn(),
    get: vi.fn(),
    all: vi.fn(), // Although not used directly by economyUtils yet
}));

// Import the functions to test AFTER mocks are set up
import {
    formatCurrency,
    calculateWage,
    getEntityType,
    getEntityFunds,
    setEntityFunds,
    processTransaction,
    calculateTransactionTax,
    COPPER_PER_SILVER,
    SILVER_PER_GOLD,
    COPPER_PER_GOLD
} from '../../../src/utils/economyUtils.js';
import { run, get } from '../../../src/data/database.js';

describe('Economy Utilities', () => {

    beforeEach(() => {
        // Reset mocks before each test
        vi.clearAllMocks();
    });

    describe('formatCurrency', () => {
        it('should format copper correctly', () => {
            expect(formatCurrency(45)).toBe('45 C');
        });
        it('should format silver and copper correctly', () => {
            expect(formatCurrency(2345)).toBe('23 S, 45 C');
        });
        it('should format gold, silver, and copper correctly', () => {
            expect(formatCurrency(12345)).toBe('1 G, 23 S, 45 C');
        });
        it('should format gold and copper (zero silver) correctly', () => {
            expect(formatCurrency(10045)).toBe('1 G, 0 S, 45 C');
        });
         it('should format gold and silver (zero copper) correctly', () => {
            expect(formatCurrency(12300)).toBe('1 G, 23 S, 0 C');
        });
        it('should format only gold correctly', () => {
            expect(formatCurrency(20000)).toBe('2 G, 0 S, 0 C');
        });
         it('should format only silver correctly', () => {
            expect(formatCurrency(500)).toBe('5 S, 0 C');
        });
        it('should handle zero correctly', () => {
            expect(formatCurrency(0)).toBe('0 C');
        });
        it('should handle negative amounts correctly', () => {
            expect(formatCurrency(-12345)).toBe('-1 G, 23 S, 45 C');
            expect(formatCurrency(-45)).toBe('-45 C');
        });
        it('should handle invalid input', () => {
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            expect(formatCurrency(null)).toBe('0 C');
            expect(formatCurrency(undefined)).toBe('0 C');
            expect(formatCurrency('abc')).toBe('0 C');
            expect(formatCurrency(123.45)).toBe('0 C'); // Non-integer
            expect(warnSpy).toHaveBeenCalledTimes(4);
            warnSpy.mockRestore();
        });
    });

    describe('calculateWage', () => {
        // Basic tests, assuming the formula remains simple
        it('should calculate base wage correctly', () => {
            expect(calculateWage(1, 1, 0)).toBe(10); // Base wage
        });
        it('should apply skill bonus', () => {
            expect(calculateWage(3, 1, 0)).toBe(14); // 10 + (3-1)*2
        });
        it('should apply difficulty bonus', () => {
            expect(calculateWage(1, 2, 0)).toBe(11); // 10 + (2-1)*1
        });
        it('should apply reputation modifier', () => {
            expect(calculateWage(1, 1, 5)).toBe(15); // 10 + 5
            expect(calculateWage(1, 1, -3)).toBe(7); // 10 - 3
        });
        it('should combine bonuses and modifiers', () => {
            expect(calculateWage(3, 2, 5)).toBe(20); // 10 + 4 + 1 + 5
        });
        it('should ensure minimum wage of 1', () => {
            expect(calculateWage(1, 1, -15)).toBe(1);
        });
    });

    describe('getEntityType', () => {
        // This function doesn't exist in the provided code, assuming it was intended for processTransaction logic
        // If it's added later, tests would go here.
        // For now, processTransaction determines type internally based on ID structure (which isn't robust)
        // or relies on the caller providing the type. The refactored version uses the latter.
         it.skip('should identify entity types (if function existed)', () => {
            // expect(getEntityType('player_1')).toBe('Player');
            // expect(getEntityType('npc_123')).toBe('NPC');
            // expect(getEntityType('biz_45')).toBe('Business');
            // expect(getEntityType('guild_abc')).toBe('Guild');
            // expect(getEntityType('household_10')).toBe('Household'); // Example
            // expect(getEntityType('unknown_id')).toBe('Unknown');
            // expect(getEntityType(123)).toBe('Unknown');
            // expect(getEntityType(null)).toBe('Unknown');
         });
    });

    describe('getEntityFunds', () => {
        it('should get funds for a Household', async () => {
            get.mockResolvedValue({ funds: 1234 });
            const funds = await getEntityFunds(5, 'Household');
            expect(get).toHaveBeenCalledWith('SELECT funds FROM Households WHERE household_id = ?', [5]);
            expect(funds).toBe(1234);
        });

        it('should return null if entity not found', async () => {
            get.mockResolvedValue(null);
            const funds = await getEntityFunds(99, 'Household');
            expect(get).toHaveBeenCalledWith('SELECT funds FROM Households WHERE household_id = ?', [99]);
            expect(funds).toBeNull();
        });

        it('should return null for unsupported entity type', async () => {
            const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            const funds = await getEntityFunds(1, 'UnknownType');
            expect(get).not.toHaveBeenCalled();
            expect(funds).toBeNull();
            expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Unsupported entity type'));
            errorSpy.mockRestore();
        });

        it('should return null on database error', async () => {
            const dbError = new Error('DB Error');
            get.mockRejectedValue(dbError);
            const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            const funds = await getEntityFunds(5, 'Household');
            expect(get).toHaveBeenCalledWith('SELECT funds FROM Households WHERE household_id = ?', [5]);
            expect(funds).toBeNull();
            expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Error getting funds'), dbError);
            errorSpy.mockRestore();
        });
    });

    describe('setEntityFunds', () => {
        it('should set funds for a Household', async () => {
            run.mockResolvedValue({ changes: 1 });
            const success = await setEntityFunds(5, 'Household', 5000);
            expect(run).toHaveBeenCalledWith(
                'UPDATE Households SET funds = ?, updated_at = CURRENT_TIMESTAMP WHERE household_id = ?',
                [5000, 5]
            );
            expect(success).toBe(true);
        });

        it('should return false if entity not found or no changes made', async () => {
            run.mockResolvedValue({ changes: 0 });
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            const success = await setEntityFunds(99, 'Household', 5000);
            expect(run).toHaveBeenCalledWith(
                'UPDATE Households SET funds = ?, updated_at = CURRENT_TIMESTAMP WHERE household_id = ?',
                [5000, 99]
            );
            expect(success).toBe(false);
            expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('not found or funds not changed'));
            warnSpy.mockRestore();
        });

        it('should return false for unsupported entity type', async () => {
            const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            const success = await setEntityFunds(1, 'UnknownType', 5000);
            expect(run).not.toHaveBeenCalled();
            expect(success).toBe(false);
            expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Unsupported entity type'));
            errorSpy.mockRestore();
        });

         it('should return false for invalid amount', async () => {
            const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            expect(await setEntityFunds(1, 'Household', -100)).toBe(false);
            expect(await setEntityFunds(1, 'Household', 100.5)).toBe(false);
            expect(await setEntityFunds(1, 'Household', NaN)).toBe(false);
            expect(run).not.toHaveBeenCalled();
            expect(errorSpy).toHaveBeenCalledTimes(3);
            expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid new amount'));
            errorSpy.mockRestore();
        });

        it('should return false on database error', async () => {
            const dbError = new Error('DB Error');
            run.mockRejectedValue(dbError);
            const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            const success = await setEntityFunds(5, 'Household', 5000);
            expect(run).toHaveBeenCalled();
            expect(success).toBe(false);
            expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Error setting funds'), dbError);
            errorSpy.mockRestore();
        });
    });

    describe('processTransaction', () => {
        // Mock getEntityFunds and setEntityFunds for these tests
        // Note: processTransaction now uses the internal get/set functions, so we mock the DB directly.

        it('should successfully transfer funds between two households', async () => {
            // Payer (ID 1) has 1000, Payee (ID 2) has 500
            get.mockImplementation(async (sql, params) => {
                if (sql.includes('Households') && params[0] === 1) return { funds: 1000 };
                if (sql.includes('Households') && params[0] === 2) return { funds: 500 };
                return null;
            });
            // Mock successful updates
            run.mockResolvedValue({ changes: 1 });

            const success = await processTransaction(1, 'Household', 2, 'Household', 100, 'Test Payment'); // Payer ID, Payer Type, Payee ID, Payee Type, Amount

            expect(get).toHaveBeenCalledTimes(2); // Called for payer and payee
            expect(get).toHaveBeenCalledWith('SELECT funds FROM Households WHERE household_id = ?', [1]);
            expect(get).toHaveBeenCalledWith('SELECT funds FROM Households WHERE household_id = ?', [2]);

            expect(run).toHaveBeenCalledTimes(2); // Called for payer deduction and payee addition
            // Payer deduction
            expect(run).toHaveBeenCalledWith(
                'UPDATE Households SET funds = ?, updated_at = CURRENT_TIMESTAMP WHERE household_id = ?',
                [900, 1] // 1000 - 100
            );
            // Payee addition
            expect(run).toHaveBeenCalledWith(
                'UPDATE Households SET funds = ?, updated_at = CURRENT_TIMESTAMP WHERE household_id = ?',
                [600, 2] // 500 + 100
            );
            expect(success).toBe(true);
        });

        it('should fail if payer has insufficient funds', async () => {
            get.mockImplementation(async (sql, params) => {
                if (sql.includes('Households') && params[0] === 1) return { funds: 50 }; // Payer has only 50
                if (sql.includes('Households') && params[0] === 2) return { funds: 500 };
                return null;
            });
            run.mockResolvedValue({ changes: 1 }); // Mock run, though it shouldn't be called for update
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

            const success = await processTransaction(1, 'Household', 2, 'Household', 100, 'Test Payment');

            expect(get).toHaveBeenCalledTimes(2); // Still checks both funds
            expect(run).not.toHaveBeenCalled(); // No updates should occur
            expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('insufficient funds'));
            expect(success).toBe(false);
            warnSpy.mockRestore();
        });

        it('should fail if amount is invalid', async () => {
            const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            expect(await processTransaction(1, 'Household', 2, 'Household', 0)).toBe(false);
            expect(await processTransaction(1, 'Household', 2, 'Household', -100)).toBe(false);
            expect(await processTransaction(1, 'Household', 2, 'Household', 100.5)).toBe(false);
            expect(get).not.toHaveBeenCalled();
            expect(run).not.toHaveBeenCalled();
            expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid amount'));
            errorSpy.mockRestore();
        });

        it('should fail if payer or payee ID is invalid', async () => {
             const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
             expect(await processTransaction(null, 'Household', 2, 'Household', 100)).toBe(false); // Invalid payer ID
             expect(await processTransaction(1, 'Household', undefined, 'Household', 100)).toBe(false); // Invalid payee ID
             expect(await processTransaction(1, 'Household', 1, 'Household', 100)).toBe(false); // Payer equals payee (same type)
             expect(await processTransaction(1, 'InvalidType', 2, 'Household', 100)).toBe(false); // Invalid payer type
             expect(await processTransaction(1, 'Household', 2, 'InvalidType', 100)).toBe(false); // Invalid payee type
             expect(get).not.toHaveBeenCalled();
             expect(run).not.toHaveBeenCalled();
             expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid payer') || expect.stringContaining('Invalid entity type'));
             errorSpy.mockRestore();
        });

        it('should fail and attempt revert if payee update fails', async () => {
            get.mockImplementation(async (sql, params) => {
                if (sql.includes('Households') && params[0] === 1) return { funds: 1000 };
                if (sql.includes('Households') && params[0] === 2) return { funds: 500 };
                return null;
            });
            // Mock payer update success, payee update failure, revert success
            let callCount = 0;
            run.mockImplementation(async (sql, params) => {
                callCount++;
                if (callCount === 1) return { changes: 1 }; // Payer deduction succeeds
                if (callCount === 2) return { changes: 0 }; // Payee addition fails
                if (callCount === 3) return { changes: 1 }; // Payer revert succeeds
                return { changes: 0 };
            });
            const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

            const success = await processTransaction(1, 'Household', 2, 'Household', 100, 'Test Payment');

            expect(get).toHaveBeenCalledTimes(2);
            expect(run).toHaveBeenCalledTimes(3);
             // Payer deduction
            expect(run).toHaveBeenNthCalledWith(1,
                'UPDATE Households SET funds = ?, updated_at = CURRENT_TIMESTAMP WHERE household_id = ?',
                [900, 1]
            );
             // Payee addition (failed)
            expect(run).toHaveBeenNthCalledWith(2,
                'UPDATE Households SET funds = ?, updated_at = CURRENT_TIMESTAMP WHERE household_id = ?',
                [600, 2]
            );
             // Payer revert
            expect(run).toHaveBeenNthCalledWith(3,
                'UPDATE Households SET funds = ?, updated_at = CURRENT_TIMESTAMP WHERE household_id = ?',
                [1000, 1] // Reverted back to original 1000
            );
            expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to add funds to payee'));
            expect(success).toBe(false);
            errorSpy.mockRestore();
        });

         it('should log critical error if revert fails', async () => {
            get.mockImplementation(async (sql, params) => {
                if (sql.includes('Households') && params[0] === 1) return { funds: 1000 };
                if (sql.includes('Households') && params[0] === 2) return { funds: 500 };
                return null;
            });
            // Mock payer update success, payee update failure, revert failure
            run.mockImplementation(async (sql, params) => {
                if (sql.includes('WHERE household_id = ?') && params.includes(1) && params.includes(900)) return { changes: 1 }; // Payer deduction
                if (sql.includes('WHERE household_id = ?') && params.includes(2)) return { changes: 0 }; // Payee addition fails
                if (sql.includes('WHERE household_id = ?') && params.includes(1) && params.includes(1000)) return { changes: 0 }; // Payer revert fails
                return { changes: 0 };
            });
            const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

            const success = await processTransaction(1, 'Household', 2, 'Household', 100, 'Test Payment');

            expect(run).toHaveBeenCalledTimes(3);
            expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to add funds to payee'));
            expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('CRITICAL ERROR: Failed to revert payer funds'));
            expect(success).toBe(false);
            errorSpy.mockRestore();
        });

        // TODO: Add tests for transactions involving different entity types (Business, Guild) once supported
    });

    describe('calculateTransactionTax', () => {
        it('should calculate tax correctly', () => {
            expect(calculateTransactionTax(1000, 0.05)).toBe(50); // 5% of 1000
            expect(calculateTransactionTax(1234, 0.1)).toBe(123); // 10% of 1234, floored
        });
        it('should return 0 for zero amount or rate', () => {
            expect(calculateTransactionTax(0, 0.05)).toBe(0);
            expect(calculateTransactionTax(1000, 0)).toBe(0);
        });
        it('should return 0 for invalid input', () => {
            expect(calculateTransactionTax('abc', 0.05)).toBe(0);
            expect(calculateTransactionTax(1000, 'abc')).toBe(0);
            expect(calculateTransactionTax(1000, -0.05)).toBe(0);
        });
    });

});