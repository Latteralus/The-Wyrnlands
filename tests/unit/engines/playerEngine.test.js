// tests/unit/engines/playerEngine.test.js
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as dbModule from '@/data/database.js'; // Import the actual module
import {
    initializePlayer,
    getPlayerState,
    getPlayerAttribute,
    getSkill,
    updatePlayerAttributes,
    modifyNeed,
    addSkillXP,
    MAX_NEED,
    _getPlayerState, // Import for inspection
    _resetState, // Import reset function
    _setIsInitialized, // Import setter for testing
    _setPlayerStateIdForTest // Import new helper for testing
} from '@/engines/playerEngine.js';

// Mock the database module
vi.mock('@/data/database.js', () => ({
    getDb: vi.fn(),
}));
describe('Player Engine', () => {
    let mockDb;

    beforeEach(() => {
        // Reset player engine state first
        _resetState();
        // Reset mocks
        vi.clearAllMocks();

        // Setup default mock DB
        mockDb = {
            get: vi.fn().mockResolvedValue(undefined), // Default: Player not found
            all: vi.fn().mockResolvedValue([]),       // Default: No skills found
            run: vi.fn().mockResolvedValue({ changes: 0, lastID: 0 }), // Default: No changes/insert fails
            prepare: vi.fn().mockResolvedValue({
                run: vi.fn().mockResolvedValue({ changes: 1 }),
                finalize: vi.fn().mockResolvedValue(undefined),
            }),
        };
        dbModule.getDb.mockResolvedValue(mockDb); // Restore mock assignment

        // TODO: Reset player engine state if a reset function is implemented
        // _resetState(); // Reset is now called in beforeEach
    });

    // --- Initialization Tests ---

    it('should initialize with default values if DB is empty and save them', async () => {
        // Arrange: Mock DB get returns undefined (no player), run for INSERT Player returns successful insert ID
        mockDb.get.mockResolvedValue(undefined);
        mockDb.run.mockResolvedValueOnce({ changes: 1, lastID: 1 }); // Mock INSERT Player success WITH lastID
        // Mock prepare/run for saving default skills
        const mockSkillStmt = { run: vi.fn().mockResolvedValue({ changes: 1 }), finalize: vi.fn() };
        mockDb.prepare.mockResolvedValue(mockSkillStmt); // Default prepare mock for skills


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
        expect(state.currentMountId).toBeNull(); // Default mount is null
        // Check Player INSERT call includes null for mount ID
        expect(mockDb.run).toHaveBeenCalledWith(
            expect.stringContaining('INSERT INTO Player'),
            expect.arrayContaining([null]) // Check that mount ID parameter is included (as null here)
        );
        // Check that prepare was called for skills
        expect(mockSkillStmt.run).toHaveBeenCalledTimes(4); // Called for each default skill
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
        mockDb.get.mockResolvedValue(mockPlayerData);
        mockDb.all.mockResolvedValue(mockSkillData); // Mock skill loading

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
        expect(state.currentMountId).toBe('horse'); // Verify mount loaded
        expect(state.skills.farming.level).toBe(5);
        expect(state.skills.farming.xp).toBe(120);
        expect(state.skills.mining.level).toBe(3);
        expect(state.skills.carpentry).toBeUndefined(); // Should not have default carpentry
        expect(mockDb.run).not.toHaveBeenCalledWith(expect.stringContaining('INSERT INTO Player'), expect.any(Array)); // No insert should happen
    });

    // Renamed test correctly
    it('initializePlayer should handle DB error during load and fallback to in-memory', async () => {
         // Arrange: Mock getDb to throw an error
         dbModule.getDb.mockRejectedValue(new Error("DB connection failed"));
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
        mockDb.get.mockResolvedValue(mockPlayerData);
        mockDb.all.mockResolvedValue(mockSkillData); // Mock skill loading

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
        expect(mockDb.run).not.toHaveBeenCalledWith(expect.stringContaining('INSERT INTO Player'), expect.any(Array)); // No insert should happen
    });

    // TODO: Add test for initialization failure (DB error)

    // --- Attribute Tests ---

    it('getPlayerAttribute should return correct value', async () => {
        await initializePlayer({ name: 'Tester', health: 88, currentMountId: 'cart_horse' }); // Initialize with some overrides
        expect(getPlayerAttribute('name')).toBe('Tester');
        expect(getPlayerAttribute('health')).toBe(88);
        expect(getPlayerAttribute('nonExistent')).toBeUndefined();
        expect(getPlayerAttribute('currentMountId')).toBe('cart_horse');
    });

    it('updatePlayerAttributes should update in-memory state before DB call', async () => {
        // Arrange: Reset state (done in beforeEach) and manually set initialized and ID
        _setIsInitialized(true);
        _setPlayerStateIdForTest(999); // Use the helper to set ID on actual state
        // Mock DB to prevent errors during the async part, though we assert before it matters
        mockDb.run.mockResolvedValue({ changes: 1 });
 
        // Act
        await updatePlayerAttributes({ hunger: 80, x: 51 }); // Await the async function
 
        // Assert: Check state immediately after the synchronous part of the update
        const state = _getPlayerState(); // Use direct state access
        expect(state.hunger).toBe(80);
        expect(state.x).toBe(51);
    });

    // Ensure the main DB tests are not skipped
    it('updatePlayerAttributes should call DB run with correct parameters', async () => {
        // Arrange: Mock the INSERT during initializePlayer to return a valid ID
        mockDb.get.mockResolvedValue(undefined); // Ensure it tries to insert
        mockDb.run.mockResolvedValueOnce({ changes: 1, lastID: 1 }); // Mock INSERT Player success
        const mockStmt = { run: vi.fn().mockResolvedValue({ changes: 1 }), finalize: vi.fn() };
        mockDb.prepare.mockResolvedValue(mockStmt); // Mock skill save prepare

        await initializePlayer(); // Should now set playerState.id = 1

        // Mock DB success for the UPDATE call
        mockDb.run.mockResolvedValue({ changes: 1 });
        mockDb.run.mockClear(); // Clear insert call
 
        await updatePlayerAttributes({ name: 'NewName', thirst: 95.5, y: 52, currentMountId: 'horse' });
        // No need for extra Promise.resolve() here, await handles it.

        expect(mockDb.run).toHaveBeenCalledTimes(1);
        expect(mockDb.run).toHaveBeenCalledWith(
            expect.stringContaining('UPDATE Player SET name = ?, thirst = ?, current_tile_y = ?, current_mount_id = ?, updated_at = CURRENT_TIMESTAMP WHERE player_id = ?'),
            ['NewName', 95.5, 52, 'horse', 1] // Ensure player ID (1) and mount ID are correct
        );
    });
 
    it('updatePlayerAttributes should handle DB failure and revert state', async () => {
        await initializePlayer(); // Gets player ID 1
        const originalName = getPlayerAttribute('name');
        mockDb.run.mockResolvedValue({ changes: 0 }); // Simulate DB update failure (no rows changed)
        mockDb.run.mockClear(); // Clear insert call
 
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
        mockDb.get.mockResolvedValue(undefined); // Ensure it tries to insert
        mockDb.run.mockResolvedValueOnce({ changes: 1, lastID: 1 }); // Mock INSERT Player success
        const mockStmt = { run: vi.fn().mockResolvedValue({ changes: 1 }), finalize: vi.fn() };
        mockDb.prepare.mockResolvedValue(mockStmt); // Mock skill save prepare
        await initializePlayer(); // Initialize and get player ID 1
        mockDb.run.mockClear(); // Clear insert/skill save calls

        // Mock the run call for the update triggered by modifyNeed
        mockDb.run.mockResolvedValue({ changes: 1 });

        // Act
        modifyNeed('health', -20); // Should trigger updatePlayerAttributes({ health: 80 })

        // Assert
        // Need to wait for the async updatePlayerAttributes call triggered by modifyNeed
        // Vitest doesn't automatically wait for promises triggered indirectly like this.
        // A common pattern is to flush promises or use timers if applicable.
        // For simplicity here, we'll check if the mock was called.
        // In a real scenario, more robust async handling might be needed.
        await vi.waitFor(() => {
             expect(mockDb.run).toHaveBeenCalledWith(
                 expect.stringContaining('UPDATE Player SET health = ?'), // Check for health update
                 [80.0, 1] // Expected value and player ID
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
        mockDb.get.mockResolvedValue(undefined); // Ensure it tries to insert
        mockDb.run.mockResolvedValueOnce({ changes: 1, lastID: 1 }); // Mock INSERT Player success
        const mockSkillSaveStmt = { run: vi.fn().mockResolvedValue({ changes: 1 }), finalize: vi.fn() };
        mockDb.prepare.mockResolvedValue(mockSkillSaveStmt); // Mock skill save prepare
        await initializePlayer(); // Initialize and get player ID 1
        mockDb.run.mockClear(); // Clear insert call
        mockDb.prepare.mockClear(); // Clear initial skill save prepare call
        mockSkillSaveStmt.run.mockClear(); // Clear initial skill save run calls

        // Re-mock prepare specifically for the save triggered by addSkillXP
        const mockUpdateStmt = { run: vi.fn().mockResolvedValue({ changes: 1 }), finalize: vi.fn() };
        mockDb.prepare.mockResolvedValue(mockUpdateStmt);

        // Act
        addSkillXP('carpentry', 50); // Add XP, should trigger save

        // Assert
        // Wait for the async saveSkillsToDb call triggered by addSkillXP
        await vi.waitFor(() => {
            expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO Skills')); // Prepare for UPSERT
        });
        await vi.waitFor(() => {
             expect(mockUpdateStmt.run).toHaveBeenCalledWith(1, 'Player', 'carpentry', 1, 50); // Player ID, type, skill, level, xp
        });
        expect(getSkill('carpentry').xp).toBe(50); // Check in-memory state
    });

    it('addSkillXP should call saveSkillsToDb correctly after a level up', async () => {
        // Arrange
        mockDb.get.mockResolvedValue(undefined);
        mockDb.run.mockResolvedValueOnce({ changes: 1, lastID: 1 });
        const mockInitialSkillSaveStmt = { run: vi.fn().mockResolvedValue({ changes: 1 }), finalize: vi.fn() };
        mockDb.prepare.mockResolvedValue(mockInitialSkillSaveStmt);
        await initializePlayer();
        mockDb.run.mockClear();
        mockDb.prepare.mockClear();
        mockInitialSkillSaveStmt.run.mockClear();

        const mockUpdateStmt = { run: vi.fn().mockResolvedValue({ changes: 1 }), finalize: vi.fn() };
        mockDb.prepare.mockResolvedValue(mockUpdateStmt);

        // Act
        addSkillXP('mining', 150); // Causes level up to 2, remaining XP 50

        // Assert
        await vi.waitFor(() => {
            expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO Skills'));
        });
        await vi.waitFor(() => {
            // Should save the *new* level and remaining XP
            expect(mockUpdateStmt.run).toHaveBeenCalledWith(1, 'Player', 'mining', 2, 50);
        });
        expect(getSkill('mining').level).toBe(2); // Check in-memory state
        expect(getSkill('mining').xp).toBe(50);
    });

});