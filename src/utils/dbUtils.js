/**
 * @module dbUtils
 * @description Utility functions for common database operations, simplifying interactions for engines and managers.
 */

/**
 * Executes a SQL query that does not return rows (INSERT, UPDATE, DELETE).
 * Provides basic error handling.
 *
 * @param {object} db - The initialized SQLite database instance.
 * @param {string} sql - The SQL query string.
 * @param {Array} [params=[]] - Parameters to bind to the query.
 * @returns {Promise<{success: boolean, lastID?: number, changes?: number, error?: Error}>} - Result object.
 */
async function runQuery(db, sql, params = []) {
    console.log(`Running DB Query: ${sql}`, params);
    try {
        // Assuming the db object provided by sql.js has a 'run' method
        // The exact method signature might vary based on how sql.js is wrapped in database.js
        // Placeholder for the actual run method call
        // const result = await db.run(sql, params);
        // Mock result for placeholder:
        const result = { lastID: Math.floor(Math.random() * 1000), changes: 1 }; // Placeholder
        return { success: true, lastID: result.lastID, changes: result.changes };
    } catch (error) {
        console.error(`DB Run Error: ${error.message}\nSQL: ${sql}\nParams: ${params}`);
        return { success: false, error: error };
    }
}

/**
 * Executes a SQL query that returns a single row.
 *
 * @param {object} db - The initialized SQLite database instance.
 * @param {string} sql - The SQL query string.
 * @param {Array} [params=[]] - Parameters to bind to the query.
 * @returns {Promise<{success: boolean, data?: object, error?: Error}>} - Result object.
 */
async function getQuery(db, sql, params = []) {
    console.log(`Getting DB Row: ${sql}`, params);
    try {
        // Assuming a 'get' method exists
        // const row = await db.get(sql, params);
        // Mock result for placeholder:
        const row = undefined; // Placeholder - adjust if testing specific scenarios
        return { success: true, data: row };
    } catch (error) {
        console.error(`DB Get Error: ${error.message}\nSQL: ${sql}\nParams: ${params}`);
        return { success: false, error: error };
    }
}

/**
 * Executes a SQL query that returns multiple rows.
 *
 * @param {object} db - The initialized SQLite database instance.
 * @param {string} sql - The SQL query string.
 * @param {Array} [params=[]] - Parameters to bind to the query.
 * @returns {Promise<{success: boolean, data?: Array<object>, error?: Error}>} - Result object.
 */
async function allQuery(db, sql, params = []) {
    console.log(`Getting DB Rows: ${sql}`, params);
    try {
        // Assuming an 'all' method exists
        // const rows = await db.all(sql, params);
        // Mock result for placeholder:
        const rows = []; // Placeholder
        return { success: true, data: rows };
    } catch (error) {
        console.error(`DB All Error: ${error.message}\nSQL: ${sql}\nParams: ${params}`);
        return { success: false, error: error };
    }
}

// Potential future helpers:
// async function getEntityAttribute(db, entityType, entityId, attributeName) { ... }
// async function updateEntityAttribute(db, entityType, entityId, attributeName, value) { ... }

export { runQuery, getQuery, allQuery };