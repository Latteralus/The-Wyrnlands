// tests/unit/utils/economyUtils.test.js
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    COPPER_PER_SILVER,
    SILVER_PER_GOLD,
    COPPER_PER_GOLD,
    formatCurrency,
    calculateWage,
    processTransaction,
    calculateTransactionTax,
    getEntityType
} from '@/utils/economyUtils.js'; // Use path alias

// --- Mock Dependencies & Helpers ---

// Mock functions to simulate getting/setting entity funds for processTransaction tests
const mockEntityFundsStore = {}; // Simple in-memory store for test funds

const mockGetEntityFunds = vi.fn(async (entityId, entityType) => {
    // console.log(`Mock getEntityFunds called for ${entityId} (${entityType})`);
    return mockEntityFundsStore[entityId] !== undefined ? mockEntityFundsStore[entityId] : null;
});

const mockSetEntityFunds = vi.fn(async (entityId, entityType, newAmount) => {
    // console.log(`Mock setEntityFunds called for ${entityId} (${entityType}) with ${newAmount}`);
    // Simulate potential failure for specific test cases if needed
    // Check if a one-time implementation is set using Vitest's mock API
    const mockImplementation = mockSetEntityFunds.getMockImplementation();
     if (mockImplementation && mockSetEntityFunds.mock.calls.length === 0) { // Rough check if it's the first call with a specific mock
         // This logic might need refinement depending on exact test case needs
         // For now, assume default behavior unless explicitly overridden in the test
     }
    mockEntityFundsStore[entityId] = newAmount;
    return true; // Default success
});

// Mock playerEngine separately if needed for other tests (like calculateWage if it used player state)
// const mockPlayerEngine = { getPlayerAttribute: vi.fn(), updatePlayerAttributes: vi.fn() };
// vi.mock('@/engines/playerEngine.js', () => mockPlayerEngine);

// --- Test Suite ---
describe('Economy Utilities', () => {

    beforeEach(() => {
        vi.clearAllMocks();
        // Reset mock store and function mocks used in processTransaction tests
        Object.keys(mockEntityFundsStore).forEach(key => delete mockEntityFundsStore[key]);
        mockGetEntityFunds.mockClear();
        mockSetEntityFunds.mockClear();
        // Reset any specific implementations for setEntityFunds
        mockSetEntityFunds.mockImplementation(async (id, type, amount) => {
             mockEntityFundsStore[id] = amount;
             return true;
        });
        // Reset player engine mocks if they were used/mocked at the top level
        // mockPlayerEngine.getPlayerAttribute.mockReset();
        // mockPlayerEngine.updatePlayerAttributes.mockReset();
    });

    // --- formatCurrency Tests ---
    describe('formatCurrency', () => {
        it('should format zero correctly', () => {
            expect(formatCurrency(0)).toBe('0 C');
        });
        it('should format copper only', () => {
            expect(formatCurrency(55)).toBe('55 C');
        });
        it('should format silver and copper', () => {
            expect(formatCurrency(234)).toBe('2 S, 34 C');
            expect(formatCurrency(199)).toBe('1 S, 99 C');
        });
        it('should format silver only', () => {
            expect(formatCurrency(500)).toBe('5 S, 0 C');
        });
        it('should format gold, silver, and copper', () => {
            expect(formatCurrency(12345)).toBe('1 G, 23 S, 45 C');
        });
        it('should format gold and copper only', () => {
            expect(formatCurrency(10050)).toBe('1 G, 0 S, 50 C');
        });
         it('should format gold and silver only', () => {
            expect(formatCurrency(15000)).toBe('1 G, 50 S, 0 C');
        });
        it('should format gold only', () => {
            expect(formatCurrency(30000)).toBe('3 G, 0 S, 0 C');
        });
        it('should handle negative values', () => {
            expect(formatCurrency(-12345)).toBe('-1 G, 23 S, 45 C');
            expect(formatCurrency(-50)).toBe('-50 C');
        });
        it('should handle invalid input', () => {
            expect(formatCurrency(null)).toBe('0 C');
            expect(formatCurrency(undefined)).toBe('0 C');
            expect(formatCurrency("abc")).toBe('0 C');
            expect(formatCurrency(123.45)).toBe('0 C'); // Non-integer
        });
    });

    // --- calculateWage Tests ---
    describe('calculateWage', () => {
        it('should calculate wage with default values', () => {
            expect(calculateWage()).toBe(10); // Base wage
        });
        it('should calculate wage with skill bonus', () => {
            expect(calculateWage(3)).toBe(14); // 10 + (3-1)*2 = 14
        });
        it('should calculate wage with difficulty bonus', () => {
            expect(calculateWage(1, 2)).toBe(11); // 10 + (2-1)*1 = 11
        });
        it('should calculate wage with reputation modifier', () => {
            expect(calculateWage(1, 1, 5)).toBe(15); // 10 + 5 = 15
            expect(calculateWage(1, 1, -3)).toBe(7); // 10 - 3 = 7
        });
        it('should calculate wage with combined factors', () => {
            expect(calculateWage(5, 3, 2)).toBe(22); // 10 + (5-1)*2 + (3-1)*1 + 2 = 10 + 8 + 2 + 2 = 22
        });
         it('should return minimum wage of 1', () => {
            expect(calculateWage(1, 1, -20)).toBe(1); // 10 - 20 = -10 -> clamped to 1
        });
    });

    // --- calculateTransactionTax Tests ---
    describe('calculateTransactionTax', () => {
        it('should calculate tax correctly', () => {
            expect(calculateTransactionTax(1000, 0.05)).toBe(50); // 5% of 1000
            expect(calculateTransactionTax(123, 0.1)).toBe(12); // 10% of 123, floored
        });
        it('should return 0 for zero amount or rate', () => {
            expect(calculateTransactionTax(0, 0.05)).toBe(0);
            expect(calculateTransactionTax(1000, 0)).toBe(0);
        });
        it('should return 0 for invalid inputs', () => {
            expect(calculateTransactionTax("abc", 0.05)).toBe(0);
            expect(calculateTransactionTax(1000, "abc")).toBe(0);
            expect(calculateTransactionTax(1000, -0.1)).toBe(0);
        });
    });

     // --- getEntityType Tests ---
    describe('getEntityType', () => {
        it('should identify Player', () => {
            expect(getEntityType('player_123')).toBe('Player');
        });
        it('should identify NPC', () => {
            expect(getEntityType('npc_abc')).toBe('NPC');
        });
        it('should identify Business', () => {
            expect(getEntityType('biz_xyz')).toBe('Business');
        });
        it('should identify Guild', () => {
            expect(getEntityType('guild_789')).toBe('Guild');
        });
        it('should return Unknown for unrecognized prefixes', () => {
            expect(getEntityType('house_1')).toBe('Unknown');
            expect(getEntityType('item_sword')).toBe('Unknown');
        });
        it('should return Unknown for invalid input', () => {
            expect(getEntityType(null)).toBe('Unknown');
            expect(getEntityType(123)).toBe('Unknown');
            expect(getEntityType('')).toBe('Unknown');
        });
    });

    // --- processTransaction Tests ---
    // These tests rely on the mocked getEntityFunds and setEntityFunds
    describe('processTransaction', () => {
        const payerPlayer = 'player_1';
        const payeeNpc = 'npc_1';
        const payeeBiz = 'biz_1';
        const amount = 100;

        beforeEach(() => {
            // Setup initial funds in the mock store for each test
            mockEntityFundsStore[payerPlayer] = 500;
            mockEntityFundsStore[payeeNpc] = 200;
            mockEntityFundsStore[payeeBiz] = 10000;
            // Clear mocks specifically for this suite's context
            mockGetEntityFunds.mockClear();
            mockSetEntityFunds.mockClear();
            // Ensure default implementation for setEntityFunds is active
             mockSetEntityFunds.mockImplementation(async (id, type, amount) => {
                 mockEntityFundsStore[id] = amount;
                 return true;
            });
        });

        it('should successfully transfer funds between Player and NPC', async () => {
            const result = await processTransaction(payerPlayer, payeeNpc, amount, mockGetEntityFunds, mockSetEntityFunds, 'Payment for goods');

            expect(result).toBe(true);
            // Verify mock functions were called correctly
            expect(mockSetEntityFunds).toHaveBeenCalledWith(payerPlayer, 'Player', 400);
            expect(mockSetEntityFunds).toHaveBeenCalledWith(payeeNpc, 'NPC', 300); // 200 + 100
            // Verify funds in mock store
            expect(mockEntityFundsStore[payerPlayer]).toBe(400);
            expect(mockEntityFundsStore[payeeNpc]).toBe(300);
        });

        it('should successfully transfer funds between NPC and Business', async () => {
            const npcPaysBizAmount = 50;
            const result = await processTransaction(payeeNpc, payeeBiz, npcPaysBizAmount, mockGetEntityFunds, mockSetEntityFunds, 'Supplies purchase');

            expect(result).toBe(true);
            // Verify mock functions were called correctly
            expect(mockSetEntityFunds).toHaveBeenCalledWith(payeeNpc, 'NPC', 150); // 200 - 50
            expect(mockSetEntityFunds).toHaveBeenCalledWith(payeeBiz, 'Business', 10050); // 10000 + 50
            // Verify funds in mock store
            expect(mockEntityFundsStore[payeeNpc]).toBe(150);
            expect(mockEntityFundsStore[payeeBiz]).toBe(10050);
        });

        it('should fail if payer has insufficient funds', async () => {
            const result = await processTransaction(payerPlayer, payeeNpc, 600, mockGetEntityFunds, mockSetEntityFunds, 'Too expensive'); // Player only has 500

            expect(result).toBe(false);
            // Verify setEntityFunds was NOT called
            expect(mockSetEntityFunds).not.toHaveBeenCalled();
            // Verify funds unchanged in store
            expect(mockEntityFundsStore[payerPlayer]).toBe(500);
            expect(mockEntityFundsStore[payeeNpc]).toBe(200);
        });

        it('should fail for invalid amount (zero, negative, non-integer)', async () => {
            expect(await processTransaction(payerPlayer, payeeNpc, 0, mockGetEntityFunds, mockSetEntityFunds)).toBe(false);
            expect(await processTransaction(payerPlayer, payeeNpc, -50, mockGetEntityFunds, mockSetEntityFunds)).toBe(false);
            expect(await processTransaction(payerPlayer, payeeNpc, 50.5, mockGetEntityFunds, mockSetEntityFunds)).toBe(false);
            // Verify setEntityFunds was NOT called
            expect(mockSetEntityFunds).not.toHaveBeenCalled();
            // Verify funds unchanged in store
            expect(mockEntityFundsStore[payerPlayer]).toBe(500);
            expect(mockEntityFundsStore[payeeNpc]).toBe(200);
        });

        it('should fail for invalid payer or payee ID', async () => {
            expect(await processTransaction(null, payeeNpc, amount, mockGetEntityFunds, mockSetEntityFunds)).toBe(false);
            expect(await processTransaction(payerPlayer, undefined, amount, mockGetEntityFunds, mockSetEntityFunds)).toBe(false);
            expect(await processTransaction(payerPlayer, payerPlayer, amount, mockGetEntityFunds, mockSetEntityFunds)).toBe(false); // Cannot pay self
            expect(await processTransaction('unknown_payer', payeeNpc, amount, mockGetEntityFunds, mockSetEntityFunds)).toBe(false);
            expect(await processTransaction(payerPlayer, 'unknown_payee', amount, mockGetEntityFunds, mockSetEntityFunds)).toBe(false);
        });

        it('should fail if getEntityFunds returns null for payer', async () => {
            mockGetEntityFunds.mockImplementation(async (id, type) => (id === payerPlayer ? null : 1000)); // Simulate payer not found
            const result = await processTransaction(payerPlayer, payeeNpc, amount, mockGetEntityFunds, mockSetEntityFunds);
            expect(result).toBe(false);
            expect(mockSetEntityFunds).not.toHaveBeenCalled(); // Should fail before setting funds
        });

         it('should fail if getEntityFunds returns null for payee', async () => {
            mockGetEntityFunds.mockImplementation(async (id, type) => (id === payeeNpc ? null : 500)); // Simulate payee not found
            const result = await processTransaction(payerPlayer, payeeNpc, amount, mockGetEntityFunds, mockSetEntityFunds);
            expect(result).toBe(false);
            expect(mockSetEntityFunds).not.toHaveBeenCalled(); // Should fail before setting funds
        });

        it('should fail and attempt payer revert if setEntityFunds fails for payee', async () => {
            // Mock setEntityFunds to fail only for the payee
            // Ensure getEntityFunds returns valid initial amounts for this test
            mockGetEntityFunds.mockImplementation(async (id, type) => {
                if (id === payerPlayer) return mockEntityFundsStore[payerPlayer]; // 500
                if (id === payeeNpc) return mockEntityFundsStore[payeeNpc]; // 200
                return null;
            });
            // Mock setEntityFunds to fail only for the payee
            mockSetEntityFunds.mockImplementation(async (id, type, newAmount) => {
                if (id === payeeNpc) {
                    console.log(`Simulating setEntityFunds failure for payee ${id}`);
                    return false; // Payee update fails
                }
                if (id === payerPlayer) {
                    // Simulate payer update succeeding and store change for revert check
                    console.log(`Simulating setEntityFunds success for payer ${id}, new amount ${newAmount}`);
                    mockEntityFundsStore[id] = newAmount;
                    return true;
                }
                 // Default success for other calls (like revert) - needed for revert call
                 console.log(`Simulating setEntityFunds success for other ${id}, new amount ${newAmount}`);
                 mockEntityFundsStore[id] = newAmount;
                 return true;
            });


            const result = await processTransaction(payerPlayer, payeeNpc, amount, mockGetEntityFunds, mockSetEntityFunds);

            expect(result).toBe(false);
            // Check that setEntityFunds was called 3 times:
            // 1. Payer deduction (success)
            // 2. Payee addition (failure)
            // 3. Payer revert (attempt)
            expect(mockSetEntityFunds).toHaveBeenCalledTimes(3);
            expect(mockSetEntityFunds).toHaveBeenCalledWith(payerPlayer, 'Player', 400); // Initial deduction
            expect(mockSetEntityFunds).toHaveBeenCalledWith(payeeNpc, 'NPC', 300); // Failed addition attempt
            expect(mockSetEntityFunds).toHaveBeenCalledWith(payerPlayer, 'Player', 500); // Revert attempt
            // Check final state in store (should be reverted)
            expect(mockEntityFundsStore[payerPlayer]).toBe(500);
            expect(mockEntityFundsStore[payeeNpc]).toBe(200); // Unchanged as payee update failed
        });

         it('should fail if setEntityFunds fails for payer', async () => {
            // Mock setEntityFunds to fail only for the payer
             // Ensure getEntityFunds returns valid initial amounts for this test
            mockGetEntityFunds.mockImplementation(async (id, type) => {
                if (id === payerPlayer) return mockEntityFundsStore[payerPlayer]; // 500
                if (id === payeeNpc) return mockEntityFundsStore[payeeNpc]; // 200
                return null;
            });
            // Mock setEntityFunds to fail only for the payer
            mockSetEntityFunds.mockImplementation(async (id, type, newAmount) => {
                if (id === payerPlayer) {
                     console.log(`Simulating setEntityFunds failure for payer ${id}`);
                     return false; // Payer update fails
                }
                // Payee call should not happen, but default to success if it did
                mockEntityFundsStore[id] = newAmount;
                return true;
            });

            const result = await processTransaction(payerPlayer, payeeNpc, amount, mockGetEntityFunds, mockSetEntityFunds);

            expect(result).toBe(false);
            expect(mockSetEntityFunds).toHaveBeenCalledTimes(1); // Only called for payer
            expect(mockSetEntityFunds).toHaveBeenCalledWith(payerPlayer, 'Player', 400);
            // Verify funds unchanged in store
            expect(mockEntityFundsStore[payerPlayer]).toBe(500);
            expect(mockEntityFundsStore[payeeNpc]).toBe(200);
        });

    });

});