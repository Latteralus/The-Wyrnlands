// tests/unit/data/database.test.js
// Unit test for database initialization using Vitest.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { initializeDatabase, all, getRawDb, isDbInitialized } from '../../../src/data/database.js'; // Adjust path if needed

describe('Database Module', () => {
    let dbInstance;

    // Initialize the database once before all tests in this suite
    beforeAll(async () => {
        try {
            // Ensure clean state if tests run multiple times in watch mode
            if (isDbInitialized) {
                console.warn("Database was already initialized before test suite. Attempting re-initialization.");
                // In a real scenario, might need more robust cleanup/reset logic
            }
            dbInstance = await initializeDatabase();
            expect(dbInstance).toBeDefined(); // Basic check that initialization returned something
            console.log("Database initialized successfully for test suite.");
        } catch (error) {
            console.error("FATAL: Database initialization failed in beforeAll:", error);
            // Throw error to prevent tests from running with uninitialized DB
            throw new Error(`Database initialization failed: ${error.message}`);
        }
    });

    // Optional: Close DB after tests if needed (sql.js in-memory usually doesn't require explicit close unless reloading)
    // afterAll(() => {
    //     if (dbInstance) {
    //         // dbInstance.close(); // Close method exists on the sql.js DB object
    //         // console.log("Database closed after test suite.");
    //     }
    // });

    it('should initialize the database and create the expected tables', async () => {
        // Query sqlite_master to get table names
        const tablesResult = await all("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;");
        const tableNames = tablesResult.map(row => row.name);

        console.log("Tables found:", tableNames);

        // Expected tables based on schema.sql (excluding sqlite sequence table)
        const expectedTables = [
            'Buildings',
            'Households',
            'Inventory',
            'MapTiles',
            'NPCs',
            'Player',
            'Skills'
        ].sort(); // Sort for consistent comparison

        // Filter out sqlite internal tables
        const actualTables = tableNames.filter(name => !name.startsWith('sqlite_')).sort();

        // Vitest assertion
        expect(actualTables).toEqual(expectedTables);
    });

    // Add more tests here later, e.g.:
    // it('should allow inserting and retrieving data from Player table', async () => { ... });
    // it('should enforce foreign key constraints', async () => { ... });

});