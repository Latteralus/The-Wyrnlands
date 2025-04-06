// src/data/database.js
// Manages the sql.js database instance and interactions.
// Refactored for Node.js/Vitest compatibility.

// Node.js specific imports removed for browser compatibility
// import fs from 'fs';
// import path from 'path';
// Import removed - rely on initSqlJs being globally available from <script> tag in index.html
// import initSqlJs from 'sql.js';

// Reference to the sql.js database instance
let db = null;
let SQL = null; // Will hold the loaded sql.js library

// Flag to track initialization status
let isInitialized = false;
let initializationPromise = null;

/**
 * Initializes the sql.js database.
 * Fetches the schema SQL file and executes it.
 * Must be called before any other database operations.
 * @returns {Promise<Database>} A promise that resolves with the db instance when ready.
 */
async function initializeDatabase() {
    // Prevent multiple initializations
    if (initializationPromise) {
        return initializationPromise;
    }
    if (isInitialized) {
        console.log("Database already initialized.");
        return Promise.resolve(db);
    }

    console.log("Initializing database...");

    initializationPromise = new Promise(async (resolve, reject) => {
        try {
            // Load sql.js library (assuming initSqlJs is global)
            console.log("Locating WASM file at /lib/sql-wasm.wasm");
            // Check if initSqlJs is available globally
            if (typeof initSqlJs !== 'function') {
                throw new Error("initSqlJs is not available globally. Ensure sql-wasm.js is included correctly in index.html.");
            }
            SQL = await initSqlJs({
                locateFile: file => `/lib/${file}` // Points to the /lib directory relative to server root
            });

            // Create a new database instance (in memory for now)
            db = new SQL.Database();
            console.log("sql.js loaded and database instance created.");

            // Fetch the schema SQL file using browser's fetch API
            console.log("Fetching schema file from /src/data/schema.sql...");
            const schemaResponse = await fetch('/src/data/schema.sql'); // Path relative to server root
            if (!schemaResponse.ok) {
                throw new Error(`Failed to fetch schema.sql: ${schemaResponse.status} ${schemaResponse.statusText}`);
            }
            const schemaSql = await schemaResponse.text();
            console.log("Schema file fetched successfully.");

            // Execute the schema SQL to create tables
            db.exec(schemaSql);
            console.log("Database schema applied successfully.");

            isInitialized = true;
            initializationPromise = null; // Reset promise after completion
            resolve(db); // Resolve with the database instance

        } catch (error) {
            console.error("Database initialization failed:", error);
            initializationPromise = null; // Reset promise on error
            reject(error);
        }
    });

    return initializationPromise;
}

/**
 * Executes a SQL query that doesn't return results (e.g., INSERT, UPDATE, DELETE).
 * Ensures database is initialized before executing.
 * @param {string} sql The SQL query string.
 * @param {Array|Object} [params=[]] Optional parameters for the query.
 * @returns {Promise<{changes: number, lastID: number | undefined}>} An object containing the number of rows modified and the last inserted row ID (if applicable).
 */
async function run(sql, params = []) {
    if (!isInitialized) await initializeDatabase();
    try {
        // Execute the statement
        db.run(sql, params);
        // Get the number of affected rows and the last inserted ID
        const changes = db.getRowsModified();
        let lastID;
        // Attempt to get last inserted ID (might not exist for all statements)
        try {
            const result = db.exec("SELECT last_insert_rowid()");
            if (result.length > 0 && result[0].values.length > 0) {
                lastID = result[0].values[0][0];
            }
        } catch (idError) {
            // Ignore error if last_insert_rowid() is not applicable
            // console.warn("Could not retrieve last_insert_rowid()", idError);
        }
        return { changes, lastID }; // Return changes and lastID
    } catch (error) {
        console.error(`Error running SQL: ${sql}`, params, error);
        throw error; // Re-throw to allow caller handling
    }
}

/**
 * Executes a SQL query that returns a single row.
 * Ensures database is initialized before executing.
 * @param {string} sql The SQL query string.
 * @param {Array|Object} [params=[]] Optional parameters for the query.
 * @returns {Promise<Object|null>} The result row object or null if no row found.
 */
async function get(sql, params = []) {
    if (!isInitialized) await initializeDatabase();
    try {
        const stmt = db.prepare(sql);
        // Use bind directly if params is an array, or named parameters if it's an object
        stmt.bind(params);
        const result = stmt.getAsObject(); // Read the first row
        stmt.free(); // Free the statement
        // Check if the result object is empty (no row found)
        return Object.keys(result).length > 0 ? result : null;
    } catch (error) {
        console.error(`Error getting SQL: ${sql}`, params, error);
        throw error;
    }
}

/**
 * Executes a SQL query that returns multiple rows.
 * Ensures database is initialized before executing.
 * @param {string} sql The SQL query string.
 * @param {Array|Object} [params=[]] Optional parameters for the query.
 * @returns {Promise<Array<Object>>} An array of result row objects.
 */
async function all(sql, params = []) {
    if (!isInitialized) await initializeDatabase();
    const results = [];
    try {
        const stmt = db.prepare(sql);
        stmt.bind(params);
        while (stmt.step()) { // Iterate over rows
            results.push(stmt.getAsObject());
        }
        stmt.free();
        return results;
    } catch (error) {
        console.error(`Error getting all SQL: ${sql}`, params, error);
        throw error;
    }
}

/**
 * Exports the database contents as a Uint8Array.
 * Ensures database is initialized before exporting.
 * @returns {Promise<Uint8Array>} A promise resolving with the database data.
 */
async function exportDatabase() {
    if (!isInitialized) await initializeDatabase();
    try {
        return db.export();
    } catch (error) {
        console.error("Error exporting database:", error);
        throw error;
    }
}

/**
 * Imports database data from a Uint8Array, replacing the current database.
 * Ensures sql.js is loaded before importing.
 * @param {Uint8Array} data The database data to load.
 * @returns {Promise<void>}
 */
async function importDatabase(data) {
    // Ensure SQL library is loaded
    // Ensure SQL library is loaded (logic should be identical to initializeDatabase)
    // Ensure SQL library is loaded (browser version)
    if (!SQL) {
         console.log("Loading SQL.js library for import...");
         // Check if initSqlJs is available globally
         if (typeof initSqlJs !== 'function') {
             throw new Error("initSqlJs is not available globally for import. Ensure sql-wasm.js is included correctly in index.html.");
         }
         SQL = await initSqlJs({
             locateFile: file => `/lib/${file}`
         });
         console.log("SQL.js library loaded for import.");
    }
    try {
        // Close existing db if open
        if (db) {
            db.close();
            console.log("Closed existing database instance before import.");
        }
        // Load the new database from the array
        db = new SQL.Database(data);
        isInitialized = true; // Mark as initialized after successful load
        console.log("Database imported successfully.");
    } catch (error) {
        console.error("Error importing database:", error);
        isInitialized = false; // Reset flag on error
        db = null; // Clear potentially corrupted db instance
        throw error;
    }
}

/**
 * Gets the raw sql.js database instance. Use with caution.
 * Ensures database is initialized first.
 * @returns {Promise<Database>} The raw sql.js database instance.
 */
async function getRawDb() {
    if (!isInitialized) await initializeDatabase();
    return db;
}

// Export the database management functions
export {
    initializeDatabase,
    run,
    get,
    all,
    exportDatabase,
    importDatabase,
    getRawDb,
    isInitialized as isDbInitialized // Export the status flag
};

// Note: Automatic initialization removed, should be controlled by application/test entry point.