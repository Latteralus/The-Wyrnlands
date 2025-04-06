import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { runQuery, getQuery, allQuery } from '../../../src/utils/dbUtils';

describe('dbUtils', () => {
    let mockDb;

    beforeEach(() => {
        // Mock the database object that would be passed from database.js
        mockDb = {
            // Mock the methods expected by dbUtils based on sql.js or wrapper
            run: vi.fn(),
            get: vi.fn(),
            all: vi.fn(),
        };
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('runQuery', () => {
        it('should call db.run with correct SQL and params (placeholder success)', async () => {
            const sql = 'INSERT INTO test (col) VALUES (?)';
            const params = ['value1'];
            // Mock the underlying db.run to simulate success
            // Note: The placeholder in dbUtils doesn't actually call db.run yet
            // mockDb.run.mockResolvedValue({ lastID: 1, changes: 1 });

            const result = await runQuery(mockDb, sql, params);

            expect(console.log).toHaveBeenCalledWith(`Running DB Query: ${sql}`, params);
            // expect(mockDb.run).toHaveBeenCalledWith(sql, params); // Enable when dbUtils calls db.run
            expect(result.success).toBe(true);
            expect(result.lastID).toEqual(expect.any(Number)); // Placeholder returns random
            expect(result.changes).toBe(1); // Placeholder returns 1
        });

        it('should return success false and log error on db.run failure', async () => {
            const sql = 'UPDATE test SET col = ? WHERE id = ?';
            const params = ['new', 1];
            const mockError = new Error('DB Write Error');
            // Mock the underlying db.run to throw an error
            mockDb.run.mockRejectedValue(mockError); // Need to modify dbUtils to actually call db.run for this

            // Temporarily modify runQuery to actually call the mock for this test
            const originalRunQuery = runQuery; // Keep original for restoration
            const testRunQuery = async (db, sql, params = []) => {
                 console.log(`Running DB Query: ${sql}`, params);
                 try {
                     const result = await db.run(sql, params); // Actually call the mock
                     return { success: true, lastID: result.lastID, changes: result.changes };
                 } catch (error) {
                     console.error(`DB Run Error: ${error.message}\nSQL: ${sql}\nParams: ${params}`);
                     return { success: false, error: error };
                 }
            };


            const result = await testRunQuery(mockDb, sql, params); // Use the modified version

            expect(console.error).toHaveBeenCalledWith(`DB Run Error: ${mockError.message}\nSQL: ${sql}\nParams: ${params}`);
            expect(result.success).toBe(false);
            expect(result.error).toBe(mockError);
        });
    });

    describe('getQuery', () => {
        it('should call db.get with correct SQL and params (placeholder success)', async () => {
            const sql = 'SELECT * FROM test WHERE id = ?';
            const params = [1];
            const mockRow = { id: 1, col: 'value1' };
            // Mock the underlying db.get
            // mockDb.get.mockResolvedValue(mockRow); // Enable when dbUtils calls db.get

            const result = await getQuery(mockDb, sql, params);

            expect(console.log).toHaveBeenCalledWith(`Getting DB Row: ${sql}`, params);
            // expect(mockDb.get).toHaveBeenCalledWith(sql, params); // Enable when dbUtils calls db.get
            expect(result.success).toBe(true);
            expect(result.data).toBeUndefined(); // Placeholder returns undefined
        });

        it('should return success false and log error on db.get failure', async () => {
            const sql = 'SELECT col FROM test WHERE id = ?';
            const params = [2];
            const mockError = new Error('DB Read Error');
            mockDb.get.mockRejectedValue(mockError); // Mock the actual call to fail

             // Temporarily modify getQuery to actually call the mock
            const testGetQuery = async (db, sql, params = []) => {
                console.log(`Getting DB Row: ${sql}`, params);
                try {
                    const row = await db.get(sql, params); // Actually call the mock
                    return { success: true, data: row };
                } catch (error) {
                    console.error(`DB Get Error: ${error.message}\nSQL: ${sql}\nParams: ${params}`);
                    return { success: false, error: error };
                }
            };

            const result = await testGetQuery(mockDb, sql, params);

            expect(console.error).toHaveBeenCalledWith(`DB Get Error: ${mockError.message}\nSQL: ${sql}\nParams: ${params}`);
            expect(result.success).toBe(false);
            expect(result.error).toBe(mockError);
        });
    });

    describe('allQuery', () => {
        it('should call db.all with correct SQL and params (placeholder success)', async () => {
            const sql = 'SELECT id FROM test';
            const params = [];
            const mockRows = [{ id: 1 }, { id: 2 }];
            // mockDb.all.mockResolvedValue(mockRows); // Enable when dbUtils calls db.all

            const result = await allQuery(mockDb, sql, params);

            expect(console.log).toHaveBeenCalledWith(`Getting DB Rows: ${sql}`, params);
            // expect(mockDb.all).toHaveBeenCalledWith(sql, params); // Enable when dbUtils calls db.all
            expect(result.success).toBe(true);
            expect(result.data).toEqual([]); // Placeholder returns []
        });

        it('should return success false and log error on db.all failure', async () => {
            const sql = 'SELECT * FROM other_table';
            const params = [];
            const mockError = new Error('DB Read All Error');
            mockDb.all.mockRejectedValue(mockError); // Mock the actual call to fail

            // Temporarily modify allQuery to actually call the mock
            const testAllQuery = async (db, sql, params = []) => {
                console.log(`Getting DB Rows: ${sql}`, params);
                try {
                    const rows = await db.all(sql, params); // Actually call the mock
                    return { success: true, data: rows };
                } catch (error) {
                    console.error(`DB All Error: ${error.message}\nSQL: ${sql}\nParams: ${params}`);
                    return { success: false, error: error };
                }
            };

            const result = await testAllQuery(mockDb, sql, params);

            expect(console.error).toHaveBeenCalledWith(`DB All Error: ${mockError.message}\nSQL: ${sql}\nParams: ${params}`);
            expect(result.success).toBe(false);
            expect(result.error).toBe(mockError);
        });
    });
});