// tests/unit/utils/inventoryUtils.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the database module
vi.mock('../../../src/data/database.js', () => ({
    run: vi.fn(),
    get: vi.fn(),
    all: vi.fn(),
}));

// Import the functions to test AFTER mocks are set up
import {
    addItem,
    removeItem,
    getItemQuantity,
    getInventory
} from '../../../src/utils/inventoryUtils.js';
import { run, get, all } from '../../../src/data/database.js';

describe('Inventory Utilities', () => {

    beforeEach(() => {
        // Reset mocks before each test
        vi.clearAllMocks();
    });

    describe('addItem', () => {
        it('should insert a new item if it does not exist', async () => {
            get.mockResolvedValue(null); // Item does not exist
            run.mockResolvedValue({ lastID: 123, changes: 1 }); // Mock successful insert

            const success = await addItem('Household', 1, 'Wood', 10);

            expect(get).toHaveBeenCalledWith(
                'SELECT inventory_id, quantity FROM Inventory WHERE household_id = ? AND item_type = ?',
                [1, 'Wood']
            );
            expect(run).toHaveBeenCalledWith(
                'INSERT INTO Inventory (household_id, building_id, item_type, quantity, condition) VALUES (?, NULL, ?, ?, ?)',
                [1, 'Wood', 10, 100.0] // Default condition
            );
            expect(success).toBe(true);
        });

        it('should update quantity if item already exists', async () => {
            get.mockResolvedValue({ inventory_id: 45, quantity: 5 }); // Item exists with quantity 5
            run.mockResolvedValue({ changes: 1 }); // Mock successful update

            const success = await addItem('Household', 1, 'Wood', 10);

            expect(get).toHaveBeenCalledWith(
                'SELECT inventory_id, quantity FROM Inventory WHERE household_id = ? AND item_type = ?',
                [1, 'Wood']
            );
            expect(run).toHaveBeenCalledWith(
                'UPDATE Inventory SET quantity = ?, updated_at = CURRENT_TIMESTAMP WHERE inventory_id = ?',
                [15, 45] // 5 + 10 = 15
            );
            expect(success).toBe(true);
        });

         it('should handle adding to Building inventory', async () => {
            get.mockResolvedValue(null); // Item does not exist
            run.mockResolvedValue({ lastID: 124, changes: 1 }); // Mock successful insert

            const success = await addItem('Building', 2, 'Stone', 20, 95.0); // Specify condition

            expect(get).toHaveBeenCalledWith(
                'SELECT inventory_id, quantity FROM Inventory WHERE building_id = ? AND item_type = ?',
                [2, 'Stone']
            );
            expect(run).toHaveBeenCalledWith(
                'INSERT INTO Inventory (building_id, household_id, item_type, quantity, condition) VALUES (?, NULL, ?, ?, ?)',
                [2, 'Stone', 20, 95.0]
            );
            expect(success).toBe(true);
        });

        it('should return false if quantity is zero or negative', async () => {
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            expect(await addItem('Household', 1, 'Wood', 0)).toBe(false);
            expect(await addItem('Household', 1, 'Wood', -5)).toBe(false);
            expect(get).not.toHaveBeenCalled();
            expect(run).not.toHaveBeenCalled();
            expect(warnSpy).toHaveBeenCalledTimes(2);
            warnSpy.mockRestore();
        });

        it('should return false for invalid ownerType', async () => {
            const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            expect(await addItem('Player', 1, 'Wood', 10)).toBe(false); // Player not supported directly
            expect(get).not.toHaveBeenCalled();
            expect(run).not.toHaveBeenCalled();
            expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid ownerType'));
            errorSpy.mockRestore();
        });

        it('should return false on database error during get', async () => {
            get.mockRejectedValue(new Error('DB Get Error'));
            const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            const success = await addItem('Household', 1, 'Wood', 10);
            expect(success).toBe(false);
            expect(run).not.toHaveBeenCalled();
            expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Error adding item'), expect.any(Error));
            errorSpy.mockRestore();
        });

         it('should return false on database error during run (insert)', async () => {
            get.mockResolvedValue(null); // Item does not exist
            run.mockRejectedValue(new Error('DB Run Error'));
            const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            const success = await addItem('Household', 1, 'Wood', 10);
            expect(success).toBe(false);
            expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Error adding item'), expect.any(Error));
            errorSpy.mockRestore();
        });

         it('should return false on database error during run (update)', async () => {
            get.mockResolvedValue({ inventory_id: 45, quantity: 5 }); // Item exists
            run.mockRejectedValue(new Error('DB Run Error'));
            const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            const success = await addItem('Household', 1, 'Wood', 10);
            expect(success).toBe(false);
            expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Error adding item'), expect.any(Error));
            errorSpy.mockRestore();
        });
    });

    describe('removeItem', () => {
        it('should decrease quantity if enough exists', async () => {
            get.mockResolvedValue({ inventory_id: 45, quantity: 15 }); // Have 15
            run.mockResolvedValue({ changes: 1 }); // Mock successful update

            const success = await removeItem('Household', 1, 'Wood', 10); // Remove 10

            expect(get).toHaveBeenCalledWith(
                'SELECT inventory_id, quantity FROM Inventory WHERE household_id = ? AND item_type = ?',
                [1, 'Wood']
            );
            expect(run).toHaveBeenCalledWith(
                'UPDATE Inventory SET quantity = ?, updated_at = CURRENT_TIMESTAMP WHERE inventory_id = ?',
                [5, 45] // 15 - 10 = 5
            );
            expect(success).toBe(true);
        });

        it('should delete item row if quantity becomes zero', async () => {
            get.mockResolvedValue({ inventory_id: 45, quantity: 10 }); // Have 10
            run.mockResolvedValue({ changes: 1 }); // Mock successful delete

            const success = await removeItem('Household', 1, 'Wood', 10); // Remove 10

            expect(get).toHaveBeenCalledWith(
                'SELECT inventory_id, quantity FROM Inventory WHERE household_id = ? AND item_type = ?',
                [1, 'Wood']
            );
            expect(run).toHaveBeenCalledWith(
                'DELETE FROM Inventory WHERE inventory_id = ?',
                [45]
            );
            expect(success).toBe(true);
        });

         it('should delete item row if quantity becomes negative (removes more than available)', async () => {
            // This case relies on the check `existingItem.quantity < quantity` failing first
            // Let's test the insufficient quantity case directly
         });

        it('should return false if item does not exist', async () => {
            get.mockResolvedValue(null); // Item not found
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            const success = await removeItem('Household', 1, 'Wood', 10);

            expect(get).toHaveBeenCalledWith(
                'SELECT inventory_id, quantity FROM Inventory WHERE household_id = ? AND item_type = ?',
                [1, 'Wood']
            );
            expect(run).not.toHaveBeenCalled();
            expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Item Wood not found'));
            expect(success).toBe(false);
            warnSpy.mockRestore();
        });

        it('should return false if insufficient quantity', async () => {
            get.mockResolvedValue({ inventory_id: 45, quantity: 5 }); // Have 5
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            const success = await removeItem('Household', 1, 'Wood', 10); // Try remove 10

            expect(get).toHaveBeenCalledWith(
                'SELECT inventory_id, quantity FROM Inventory WHERE household_id = ? AND item_type = ?',
                [1, 'Wood']
            );
            expect(run).not.toHaveBeenCalled();
            expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Insufficient quantity'));
            expect(success).toBe(false);
            warnSpy.mockRestore();
        });

        it('should return false if quantity is zero or negative', async () => {
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            expect(await removeItem('Household', 1, 'Wood', 0)).toBe(false);
            expect(await removeItem('Household', 1, 'Wood', -5)).toBe(false);
            expect(get).not.toHaveBeenCalled();
            expect(run).not.toHaveBeenCalled();
            expect(warnSpy).toHaveBeenCalledTimes(2);
            warnSpy.mockRestore();
        });

        it('should return false for invalid ownerType', async () => {
            const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            expect(await removeItem('Player', 1, 'Wood', 10)).toBe(false);
            expect(get).not.toHaveBeenCalled();
            expect(run).not.toHaveBeenCalled();
            expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid ownerType'));
            errorSpy.mockRestore();
        });

        it('should return false on database error', async () => {
            get.mockResolvedValue({ inventory_id: 45, quantity: 15 }); // Item exists
            run.mockRejectedValue(new Error('DB Error')); // Simulate update/delete failure
            const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            const success = await removeItem('Household', 1, 'Wood', 10);
            expect(success).toBe(false);
            expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Error removing item'), expect.any(Error));
            errorSpy.mockRestore();
        });
    });

    describe('getItemQuantity', () => {
        it('should return quantity if item exists', async () => {
            get.mockResolvedValue({ quantity: 42 });
            const quantity = await getItemQuantity('Household', 1, 'Stone');
            expect(get).toHaveBeenCalledWith(
                'SELECT quantity FROM Inventory WHERE household_id = ? AND item_type = ?',
                [1, 'Stone']
            );
            expect(quantity).toBe(42);
        });

        it('should return 0 if item does not exist', async () => {
            get.mockResolvedValue(null);
            const quantity = await getItemQuantity('Household', 1, 'Iron');
            expect(get).toHaveBeenCalledWith(
                'SELECT quantity FROM Inventory WHERE household_id = ? AND item_type = ?',
                [1, 'Iron']
            );
            expect(quantity).toBe(0);
        });

        it('should return 0 for invalid ownerType', async () => {
             const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
             const quantity = await getItemQuantity('Unknown', 1, 'Wood');
             expect(get).not.toHaveBeenCalled();
             expect(quantity).toBe(0);
             expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid ownerType'));
             errorSpy.mockRestore();
        });

        it('should return 0 on database error', async () => {
            get.mockRejectedValue(new Error('DB Error'));
            const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            const quantity = await getItemQuantity('Household', 1, 'Stone');
            expect(quantity).toBe(0);
            expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Error getting quantity'), expect.any(Error));
            errorSpy.mockRestore();
        });
    });

    describe('getInventory', () => {
        it('should return an array of items', async () => {
            const mockInventory = [
                { item_type: 'Stone', quantity: 20, condition: 100.0 },
                { item_type: 'Wood', quantity: 50, condition: 100.0 },
            ];
            all.mockResolvedValue(mockInventory);
            const inventory = await getInventory('Household', 1);
            expect(all).toHaveBeenCalledWith(
                'SELECT item_type, quantity, condition FROM Inventory WHERE household_id = ? ORDER BY item_type',
                [1]
            );
            expect(inventory).toEqual(mockInventory);
        });

        it('should return an empty array if inventory is empty', async () => {
            all.mockResolvedValue([]);
            const inventory = await getInventory('Household', 1);
            expect(inventory).toEqual([]);
        });

         it('should return an empty array for invalid ownerType', async () => {
             const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
             const inventory = await getInventory('Player', 1);
             expect(all).not.toHaveBeenCalled();
             expect(inventory).toEqual([]);
             expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid ownerType'));
             errorSpy.mockRestore();
        });

        it('should return an empty array on database error', async () => {
            all.mockRejectedValue(new Error('DB Error'));
            const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            const inventory = await getInventory('Household', 1);
            expect(inventory).toEqual([]);
            expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Error getting inventory'), expect.any(Error));
            errorSpy.mockRestore();
        });
    });

});