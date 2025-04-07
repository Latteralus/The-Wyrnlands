// tests/unit/data/database.test.js
// Unit test for database initialization using Vitest.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'; // Added vi
import initSqlJs from 'sql.js'; // Import sql.js
import fs from 'fs'; // Import fs
import path from 'path'; // Import path
import { initializeDatabase, all, getRawDb, isDbInitialized } from '../../../src/data/database.js';

describe('Database Module', () => {
    let dbInstance;

    // Initialize the database once before all tests in this suite
    beforeAll(async () => {
        try {
            // Manually initialize sql.js for the test environment
            // This simulates what happens when sql-wasm.js is loaded in the browser
            // Ensure the wasm file path is correct relative to the node_modules directory
            const SQL = await initSqlJs({ locateFile: file => `node_modules/sql.js/dist/${file}` });
            // Make initSqlJs globally available ONLY for the database initialization call
            // We use vi.stubGlobal for temporary assignment
            vi.stubGlobal('initSqlJs', () => Promise.resolve(SQL));

            // Ensure schema file exists (Vitest runs from project root)
            const schemaPath = path.resolve(__dirname, '../../../src/data/schema.sql');
            if (!fs.existsSync(schemaPath)) {
                throw new Error(`Schema file not found at ${schemaPath}`);
            }

            // Initialize the database using the actual implementation
            dbInstance = await initializeDatabase();
            expect(dbInstance).toBeDefined();
            console.log("Database initialized successfully for test suite.");

            // Clean up the global stub after initialization
            vi.unstubAllGlobals();

        } catch (error) {
            console.error("FATAL: Database initialization failed in beforeAll:", error);
            // Clean up stub even if init fails
            vi.unstubAllGlobals();
            throw new Error(`Database initialization failed: ${error.message}`);
        }
    }, 30000); // Increase timeout for wasm loading if needed

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