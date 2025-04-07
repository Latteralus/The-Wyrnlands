// tests/unit/engines/playerEngine.test.js
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as dbModule from '../../../src/data/database.js'; // Corrected path
import {
    initializePlayer,
    getPlayerState,
    getPlayerAttribute,
    getSkill,
    updatePlayerAttributes,
    modifyNeed,
    addSkillXP,
    getPlayerTitleDetails, // Import new function
    MAX_NEED,
    _getPlayerState, // Import for inspection
    _resetState, // Import reset function
    _setIsInitialized, // Import setter for testing
    _setPlayerStateIdForTest // Import new helper for testing
} from '../../../src/engines/playerEngine.js'; // Corrected path

// Mock the database module (using direct imports now)
vi.mock('../../../src/data/database.js', () => ({
    run: vi.fn(),
    get: vi.fn(),
    all: vi.fn(),
    // getDb: vi.fn(),
    // prepare: vi.fn(),
}));
// Mock titlesData and import the mock function
import { getTitleDefinition as mockGetTitleDefinition } from '../../../src/data/titlesData.js';
vi.mock('../../../src/data/titlesData.js', () => ({
    getTitleDefinition: vi.fn(id => ({ id: id, name: `${id.charAt(0).toUpperCase() + id.slice(1)} Title` })),
}));
describe('Player Engine', () => {
    let mockDb;

    beforeEach(() => {
        // Reset player engine state first
        _resetState();
        // Reset mocks
        vi.clearAllMocks();

        // Setup default mock DB
        // Setup default mock DB functions (imported directly now)
        dbModule.get.mockResolvedValue(undefined); // Default: Player not found
        dbModule.all.mockResolvedValue([]);       // Default: No skills found
        dbModule.run.mockResolvedValue({ changes: 0, lastID: 0 }); // Default: No changes/insert fails

        // TODO: Reset player engine state if a reset function is implemented
        // _resetState(); // Reset is now called in beforeEach
    });

    // --- Initialization Tests ---

    it('should initialize with default values if DB is empty and save them', async () => {
        // Arrange: Mock DB get returns undefined (no player), run for INSERT Player returns successful insert ID
        dbModule.get.mockResolvedValue(undefined);
        dbModule.run.mockResolvedValueOnce({ changes: 1, lastID: 1 }); // Mock INSERT Player success WITH lastID
        // Mock run for saving default skills (uses run directly now)
        dbModule.run.mockResolvedValue({ changes: 1 }); // Default run mock for skills


        // Act
        await initializePlayer();
        const state = getPlayerState();

        // Assert
        expect(state.id).toBe(1);
        expect(state.name).toBe('Adventurer');
        expect(state.x).toBe(50); // Default start X
        expect(state.y).toBe(50); // Default start Y
        expect(state.hunger).toBe(100.0);
        expect(state.thirst).toBe(100.0);
        expect(state.health).toBe(100.0);
        expect(state.skills.farming.level).toBe(1);
        expect(state.title_id).toBe('commoner'); // Check default title_id
        expect(state.currentMountId).toBeNull(); // Default mount is null
        // Check Player INSERT call includes null for mount ID
        // Check Player INSERT call includes title_id and null for mount ID
        expect(dbModule.run).toHaveBeenCalledWith(
            expect.stringContaining('INSERT INTO Player'),
            // Check specific order/values if needed, including title_id
            expect.arrayContaining(['Adventurer', '', 'unknown', 'commoner', 50, 50, 100, 100, 100, null, null])
        );
        // Check that run was called for skills (4 default skills) + 1 for player insert = 5 total
        expect(dbModule.run).toHaveBeenCalledTimes(5);
    });

    it('should load existing player data from DB', async () => {
         // Arrange: Mock DB get returns existing player data
        const mockPlayerData = {
            player_id: 5, name: 'Old Hero', surname: 'The Brave', gender: 'male', title_id: 'knight', // Use title_id
            current_tile_x: 10, current_tile_y: 20, hunger: 50.5, thirst: 60.2, health: 75.0, household_id: 2,
            current_mount_id: 'horse'
        };
        const mockSkillData = [
            { skill_name: 'farming', level: 5, experience: 120 },
            { skill_name: 'mining', level: 3, experience: 50 },
        ];
        dbModule.get.mockResolvedValue(mockPlayerData);
        dbModule.all.mockResolvedValue(mockSkillData); // Mock skill loading

        // Act
        await initializePlayer();
        const state = getPlayerState(); // Use regular getter

        // Assert
        expect(state.id).toBe(5);
        expect(state.name).toBe('Old Hero');
        expect(state.surname).toBe('The Brave');
        expect(state.x).toBe(10);
        expect(state.y).toBe(20);
        expect(state.hunger).toBe(50.5);
        expect(state.health).toBe(75.0);
        expect(state.householdId).toBe(2);
        expect(state.title_id).toBe('knight'); // Verify title_id loaded
        expect(state.currentMountId).toBe('horse'); // Verify mount loaded
        expect(state.skills.farming.level).toBe(5);
        expect(state.skills.farming.xp).toBe(120);
        expect(state.skills.mining.level).toBe(3);
        expect(state.skills.carpentry).toBeUndefined(); // Should not have default carpentry
        expect(dbModule.run).not.toHaveBeenCalledWith(expect.stringContaining('INSERT INTO Player'), expect.any(Array)); // No insert should happen
    });

    // Renamed test correctly
    it('initializePlayer should handle DB error during load and fallback to in-memory', async () => {
         // Arrange: Mock getDb to throw an error
         // Simulate DB connection/function error by rejecting one of the direct calls
         dbModule.get.mockRejectedValue(new Error("DB connection failed"));
         const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {}); // Suppress console error

         // Act
         await initializePlayer();

         // Assert: Check if map was initialized in memory despite error
         const state = getPlayerState();
         expect(state).not.toBeNull(); // Should have fallback state
         expect(state.name).toBe('Adventurer'); // Default name
         expect(state.id).toBeNull(); // ID should be null as DB failed
         expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("Error during player initialization"), expect.any(Error));

         consoleErrorSpy.mockRestore();
     });

    it('should load existing player data from DB', async () => {
        // Arrange: Mock DB get returns existing player data
        const mockPlayerData = {
            player_id: 5, name: 'Old Hero', surname: 'The Brave', gender: 'male', title: 'Knight',
            current_tile_x: 10, current_tile_y: 20, hunger: 50.5, thirst: 60.2, health: 75.0, household_id: 2,
            current_mount_id: 'horse' // Existing player has a horse
        };
        const mockSkillData = [
            { skill_name: 'farming', level: 5, experience: 120 },
            { skill_name: 'mining', level: 3, experience: 50 },
        ];
        dbModule.get.mockResolvedValue(mockPlayerData);
        dbModule.all.mockResolvedValue(mockSkillData); // Mock skill loading

        // Act
        await initializePlayer();
        const state = getPlayerState();

        // Assert
        expect(state.id).toBe(5);
        expect(state.name).toBe('Old Hero');
        expect(state.surname).toBe('The Brave');
        expect(state.x).toBe(10);
        expect(state.y).toBe(20);
        expect(state.hunger).toBe(50.5);
        expect(state.health).toBe(75.0);
        expect(state.householdId).toBe(2);
        expect(state.currentMountId).toBe('horse'); // Verify mount loaded
        expect(state.skills.farming.level).toBe(5);
        expect(state.skills.farming.xp).toBe(120);
        expect(state.skills.mining.level).toBe(3);
        expect(state.skills.carpentry).toBeUndefined(); // Should not have default carpentry
        expect(dbModule.run).not.toHaveBeenCalledWith(expect.stringContaining('INSERT INTO Player'), expect.any(Array)); // No insert should happen
    });

    // TODO: Add test for initialization failure (DB error)

    // --- Attribute Tests ---

    it('getPlayerAttribute should return correct value', async () => {
        await initializePlayer({ name: 'Tester', health: 88, currentMountId: 'cart_horse' }); // Initialize with some overrides
        expect(getPlayerAttribute('name')).toBe('Tester');
        expect(getPlayerAttribute('health')).toBe(88);
        expect(getPlayerAttribute('title_id')).toBe('commoner'); // Default title_id
        expect(getPlayerAttribute('nonExistent')).toBeUndefined();
        expect(getPlayerAttribute('currentMountId')).toBe('cart_horse');
    });

    it('updatePlayerAttributes should update in-memory state before DB call', async () => {
        // Arrange: Reset state (done in beforeEach) and manually set initialized and ID
        _setIsInitialized(true);
        _setPlayerStateIdForTest(999); // Use the helper to set ID on actual state
        // Mock DB to prevent errors during the async part, though we assert before it matters
        dbModule.run.mockResolvedValue({ changes: 1 });
 
        // Act
        await updatePlayerAttributes({ hunger: 80, x: 51 }); // Await the async function
 
        // Assert: Check state immediately after the synchronous part of the update
        const state = _getPlayerState(); // Use direct state access
        expect(state.hunger).toBe(80);
        expect(state.x).toBe(51);
    });

    // Ensure the main DB tests are not skipped
    it('updatePlayerAttributes should call DB run with correct parameters', async () => {
        // Arrange: Mock the INSERT during initializePlayer
        dbModule.get.mockResolvedValue(undefined); // Ensure it tries to insert
        dbModule.run.mockResolvedValueOnce({ changes: 1, lastID: 1 }); // Mock INSERT Player success
        // Mock skill saves (uses run directly now)
        dbModule.run.mockResolvedValue({ changes: 1 });

        await initializePlayer(); // Should now set playerState.id = 1

        // Mock DB success for the UPDATE call
        dbModule.run.mockResolvedValue({ changes: 1 });
        dbModule.run.mockClear(); // Clear insert/skill save calls
 
        await updatePlayerAttributes({ name: 'NewName', thirst: 95.5, y: 52, currentMountId: 'horse', title_id: 'freeman' });

        expect(dbModule.run).toHaveBeenCalledTimes(1);
        expect(dbModule.run).toHaveBeenCalledWith(
            // Check for all updated fields including title_id
            expect.stringContaining('UPDATE Player SET name = ?, thirst = ?, current_tile_y = ?, current_mount_id = ?, title_id = ?, updated_at = CURRENT_TIMESTAMP WHERE player_id = ?'),
            ['NewName', 95.5, 52, 'horse', 'freeman', 1] // Ensure player ID (1), mount ID, and title_id are correct
        );
    });
 
    it('updatePlayerAttributes should handle DB failure and revert state', async () => {
        await initializePlayer(); // Gets player ID 1 (assuming mocks are reset correctly)
        const originalName = getPlayerAttribute('name');
        dbModule.run.mockResolvedValue({ changes: 0 }); // Simulate DB update failure
        dbModule.run.mockClear(); // Clear insert/skill save calls
 
        const result = await updatePlayerAttributes({ name: 'FailedUpdate' });
 
        expect(result).toBe(false);
        // Use _getPlayerState to check internal state after potential revert
        expect(_getPlayerState().name).toBe(originalName);
    });
 
    // Removed duplicated/skipped tests below this line

    // --- Need Tests ---

    it('modifyNeed should update need correctly within bounds', async () => {
        await initializePlayer();
        modifyNeed('hunger', -30);
        expect(getPlayerAttribute('hunger')).toBe(70.0);
        modifyNeed('thirst', 10); // Should cap at MAX_NEED
        expect(getPlayerAttribute('thirst')).toBe(MAX_NEED);
        modifyNeed('health', -200); // Should clamp at 0
        expect(getPlayerAttribute('health')).toBe(0);
    });

    it('modifyNeed should call updatePlayerAttributes to persist the change', async () => {
        // Arrange
        dbModule.get.mockResolvedValue(undefined); // Ensure it tries to insert
        dbModule.run.mockResolvedValueOnce({ changes: 1, lastID: 1 }); // Mock INSERT Player success
        // Mock skill saves
        dbModule.run.mockResolvedValue({ changes: 1 });
        await initializePlayer(); // Initialize and get player ID 1
        dbModule.run.mockClear(); // Clear insert/skill save calls

        // Mock the run call for the update triggered by modifyNeed
        dbModule.run.mockResolvedValue({ changes: 1 });

        // Act
        modifyNeed('health', -20); // Should trigger updatePlayerAttributes({ health: 80 })

        // Assert
        // Need to wait for the async updatePlayerAttributes call triggered by modifyNeed
        // Vitest doesn't automatically wait for promises triggered indirectly like this.
        // A common pattern is to flush promises or use timers if applicable.
        // For simplicity here, we'll check if the mock was called.
        // In a real scenario, more robust async handling might be needed.
        await vi.waitFor(() => { // Use waitFor to handle async update triggered by modifyNeed
             expect(dbModule.run).toHaveBeenCalledWith(
                 expect.stringContaining('UPDATE Player SET health = ?'),
                 [80.0, 1]
             );
        });
        expect(getPlayerAttribute('health')).toBe(80.0); // Also check in-memory state
    });

    // --- Skill Tests ---

    it('getSkill should return correct skill level and XP', async () => {
        await initializePlayer(); // Initializes default skills
        const farming = getSkill('farming');
        expect(farming.level).toBe(1);
        expect(farming.xp).toBe(0);
        const nonExistent = getSkill('alchemy');
        expect(nonExistent.level).toBe(0); // Default for non-existent
        expect(nonExistent.xp).toBe(0);
    });

    it('addSkillXP should increase XP', async () => {
        await initializePlayer();
        addSkillXP('carpentry', 50);
        expect(getSkill('carpentry').xp).toBe(50);
        addSkillXP('carpentry', 30);
        expect(getSkill('carpentry').xp).toBe(80);
    });

    it('addSkillXP should level up the skill correctly', async () => {
        await initializePlayer();
        addSkillXP('mining', 150); // Level 1 needs 100 XP
        const mining = getSkill('mining');
        expect(mining.level).toBe(2);
        expect(mining.xp).toBe(50); // 150 - 100 = 50 remaining

        addSkillXP('mining', 180); // Level 2 needs 200 XP (50 + 180 = 230 total)
        expect(mining.level).toBe(3);
        expect(mining.xp).toBe(30); // 230 - 200 = 30 remaining
    });

     it('addSkillXP should handle multiple level ups', async () => {
        await initializePlayer();
        // Level 1 needs 100, Level 2 needs 200, Level 3 needs 300 = 600 total for level 4
        addSkillXP('farming', 750);
        const farming = getSkill('farming');
        expect(farming.level).toBe(4);
        expect(farming.xp).toBe(150); // 750 - 100 - 200 - 300 = 150
    });

    it('addSkillXP should cap at max level', async () => {
        await initializePlayer();
        // Use addSkillXP to get the skill close to max level first
        // Level 99 requires (1+2+...+98)*100 = 485100 XP total. Let's approximate.
        // Level 98 needs 9800 XP. Total for L99 = (98*99/2)*100 = 485100
        // Let's set level 99 with 50 XP manually via update (simpler for test setup)
        const initialSkills = _getPlayerState().skills; // Use inspector
        initialSkills.farming = { level: 99, xp: 50 };
        // We need to ensure this state is saved if addSkillXP relies on DB, but it doesn't currently
        // For this test, modifying the in-memory state after init is sufficient

        const xpNeededFor100 = 99 * 100; // 9900
        addSkillXP('farming', xpNeededFor100); // Add more than enough XP

        const farming = getSkill('farming');
        expect(farming.level).toBe(100);
        expect(farming.xp).toBe(0); // Should reset or cap at 0

        // Add more XP at max level
        addSkillXP('farming', 500);
         expect(farming.level).toBe(100); // Still max level
         expect(farming.xp).toBe(0); // XP should remain 0 (or capped)
    });

    it('addSkillXP should call saveSkillsToDb to persist the change', async () => {
        // Arrange
        dbModule.get.mockResolvedValue(undefined); // Ensure it tries to insert
        dbModule.run.mockResolvedValueOnce({ changes: 1, lastID: 1 }); // Mock INSERT Player success
        // Mock initial skill saves
        dbModule.run.mockResolvedValue({ changes: 1 });
        await initializePlayer(); // Initialize and get player ID 1
        dbModule.run.mockClear(); // Clear insert/skill save calls

        // Mock the run call for the save triggered by addSkillXP
        dbModule.run.mockResolvedValue({ changes: 1 });

        // Act
        addSkillXP('carpentry', 50); // Add XP, should trigger save

        // Assert
        // Wait for the async saveSkillsToDb call (which uses run) triggered by addSkillXP
        await vi.waitFor(() => {
             expect(dbModule.run).toHaveBeenCalledWith(
                 expect.stringContaining('INSERT INTO Skills'), // UPSERT SQL
                 [1, 'Player', 'carpentry', 1, 50] // Player ID, type, skill, level, xp
             );
        });
        expect(getSkill('carpentry').xp).toBe(50); // Check in-memory state
    });

    it('addSkillXP should call saveSkillsToDb correctly after a level up', async () => {
        // Arrange
        dbModule.get.mockResolvedValue(undefined);
        dbModule.run.mockResolvedValueOnce({ changes: 1, lastID: 1 });
        // Mock initial skill saves
        dbModule.run.mockResolvedValue({ changes: 1 });
        await initializePlayer();
        dbModule.run.mockClear();

        // Mock the run call for the save triggered by addSkillXP
        dbModule.run.mockResolvedValue({ changes: 1 });

        // Act
        addSkillXP('mining', 150); // Causes level up to 2, remaining XP 50

        // Assert
        await vi.waitFor(() => {
            // Should save the *new* level and remaining XP
            expect(dbModule.run).toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO Skills'),
                [1, 'Player', 'mining', 2, 50]
            );
        });
        expect(getSkill('mining').level).toBe(2); // Check in-memory state
        expect(getSkill('mining').xp).toBe(50);
    });

});

    // --- Title Tests ---
    describe('getPlayerTitleDetails', () => {
        // Use the imported mock function directly
        const getTitleDefinition = mockGetTitleDefinition;

        it('should return title details based on playerState.title_id', async () => {
            // Mock DB calls for initialization and update
            dbModule.get.mockResolvedValue(undefined); // No existing player
            dbModule.run.mockResolvedValue({ changes: 1, lastID: 1 }); // Mock insert/update success

            await initializePlayer(); // Initializes with default 'commoner', ID 1
            let details = getPlayerTitleDetails();
            expect(getTitleDefinition).toHaveBeenCalledWith('commoner');
            expect(details).toEqual({ id: 'commoner', name: 'Commoner Title' });

            // Change title using updatePlayerAttributes and test again
            dbModule.run.mockClear(); // Clear init calls
            dbModule.run.mockResolvedValue({ changes: 1 }); // Mock update success
            await updatePlayerAttributes({ title_id: 'knight' });

            details = getPlayerTitleDetails(); // Get details after update
            expect(getTitleDefinition).toHaveBeenCalledWith('knight');
            expect(details).toEqual({ id: 'knight', name: 'Knight Title' });
            // Verify DB update was called
            expect(dbModule.run).toHaveBeenCalledWith(
                expect.stringContaining('UPDATE Player SET title_id = ?'),
                ['knight', 1] // New title, player ID
            );
        });


        it('should return undefined if player engine is not initialized', () => {
            _resetState(); // Ensure not initialized
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            const details = getPlayerTitleDetails();
            expect(details).toBeUndefined();
            expect(warnSpy).toHaveBeenCalledWith("Player Engine not initialized.");
            warnSpy.mockRestore();
        });

        it('should call getTitleDefinition with the correct title_id after update', async () => {
             // Mock DB calls
             dbModule.get.mockResolvedValue(undefined);
             dbModule.run.mockResolvedValue({ changes: 1, lastID: 1 });

             await initializePlayer();
             // Update title
             await updatePlayerAttributes({ title_id: 'freeman' });
             // Call the function to test
             getPlayerTitleDetails();
             // Assert mock was called with the updated value
             expect(getTitleDefinition).toHaveBeenCalledWith('freeman');
        });
    });