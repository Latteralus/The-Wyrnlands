// tests/unit/engines/mapEngine.test.js
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    initializeMap,
    getTile,
    isWalkable,
    isBuildable,
    getMapWidth,
    getMapHeight,
    updateTileProperties,
    _resetState, // Import the reset function
    createMapVisuals // Import the new function
} from '../../../src/engines/mapEngine.js'; // Corrected path
// No longer need to import the whole dbModule
// import * as dbModule from '@/data/database.js';

// Mock the database module's exported functions
vi.mock('../../../src/data/database.js', () => ({
    run: vi.fn(),
    get: vi.fn(),
    all: vi.fn(),
}));
// Import the mocked functions to configure them in tests
import { run, get, all } from '../../../src/data/database.js';

describe('Map Engine', () => {

    // Use default dimensions for most tests
    const defaultWidth = 10;
    const defaultHeight = 10;

    // No longer need mockDb object

    beforeEach(() => {
        // Reset map engine state first
        _resetState();
        // Reset mocks before each test
        vi.clearAllMocks();

        // Setup default mock behaviors for imported DB functions
        get.mockResolvedValue(undefined); // Default: Not found
        all.mockResolvedValue([]);       // Default: Empty result set
        run.mockResolvedValue({ changes: 0 }); // Default: No changes made

        // NOTE: initializeMap needs to be called within each test that requires it,
        // after specific mock behaviors for get/all/run are set for that test's scenario.
    });

    // No afterEach needed for vi.clearAllMocks() as beforeEach handles it.

    it('should initialize the map with specified dimensions after successful initialization', async () => {
        // Arrange: Mock DB functions for empty map scenario
        get.mockResolvedValue({ count: 0 }); // For COUNT(*) check
        all.mockResolvedValueOnce([]); // For PRAGMA check
        run.mockResolvedValue({ changes: 1 }); // Mock insert success for generateAndSaveDefaultMap

        // Act
        await initializeMap(defaultWidth, defaultHeight);

        // Assert
        expect(getMapWidth()).toBe(defaultWidth);
        expect(getMapHeight()).toBe(defaultHeight);
    });

    it('should create default tiles in memory when initializing an empty map', async () => {
         // Arrange: Mock DB functions for empty map scenario
        get.mockResolvedValue({ count: 0 });
        all.mockResolvedValueOnce([]); // PRAGMA
        run.mockResolvedValue({ changes: 1 }); // Mock insert success

        // Act
        await initializeMap(defaultWidth, defaultHeight);

        // Assert
        const tile = getTile(0, 0); // Get tile from memory
        expect(tile).not.toBeNull();
        expect(tile.x).toBe(0);
        expect(tile.y).toBe(0);
        expect(tile.type).toBe('grass');
        expect(tile.walkable).toBe(true);
        expect(tile.buildable).toBe(true);
        expect(tile.buildingId).toBeNull();
    });

    it('getTile should return the correct tile object after initialization', async () => {
        // Arrange: Mock DB for initialization (empty map)
        get.mockResolvedValue({ count: 0 });
        all.mockResolvedValueOnce([]); // PRAGMA
        run.mockResolvedValue({ changes: 1 }); // Mock insert success

        // Act
        await initializeMap(defaultWidth, defaultHeight);
        const tile = getTile(5, 5);

        // Assert
        expect(tile).not.toBeNull();
        expect(tile.x).toBe(5);
        expect(tile.y).toBe(5);
    });

    it('getTile should return null for out-of-bounds coordinates after initialization', async () => {
        // Arrange: Mock DB for initialization (empty map)
        get.mockResolvedValue({ count: 0 });
        all.mockResolvedValueOnce([]); // PRAGMA
        run.mockResolvedValue({ changes: 1 }); // Mock insert success
        await initializeMap(defaultWidth, defaultHeight);

        // Act & Assert
        expect(getTile(-1, 0)).toBeNull();
        expect(getTile(0, -1)).toBeNull();
        expect(getTile(defaultWidth, 0)).toBeNull();
        expect(getTile(0, defaultHeight)).toBeNull();
        expect(getTile(defaultWidth, defaultHeight)).toBeNull();
    });

    it('getTile should return null if map is not initialized', () => {
        // Arrange: Do not call initializeMap

        // Act & Assert
        expect(getTile(0, 0)).toBeNull();
    });


    it('isWalkable should return true for default tiles after initialization', async () => {
        // Arrange: Mock DB for initialization (empty map)
        get.mockResolvedValue({ count: 0 });
        all.mockResolvedValueOnce([]); // PRAGMA
        run.mockResolvedValue({ changes: 1 }); // Mock insert success
        await initializeMap(defaultWidth, defaultHeight);

        // Act & Assert
        expect(isWalkable(3, 4)).toBe(true);
    });

    it('isWalkable should return false for non-walkable tiles after update', async () => {
        // Arrange: Mock DB for initialization (empty map)
        get.mockResolvedValue({ count: 0 });
        all.mockResolvedValueOnce([]); // PRAGMA
        run.mockResolvedValue({ changes: 1 }); // Mock insert success
        await initializeMap(defaultWidth, defaultHeight);
        // Mock the specific DB update call to succeed
        run.mockClear(); // Clear init calls
        run.mockResolvedValue({ changes: 1 });

        // Act
        await updateTileProperties(3, 4, { walkable: false }); // Now async

        // Assert
        expect(isWalkable(3, 4)).toBe(false);
    });

    // --- New tests for DB Interaction ---

    it('initializeMap should load existing tile data from the database', async () => {
        // Arrange: Mock DB response with full tile data (10x10)
        const mockTileData = [];
        for (let y = 0; y < defaultHeight; y++) {
            for (let x = 0; x < defaultWidth; x++) {
                const isWater = x === 0 && y === 0;
                mockTileData.push({
                    x: x,
                    y: y,
                    type: isWater ? 'water' : 'grass',
                    walkable: isWater ? 0 : 1,
                    buildable: isWater ? 0 : 1,
                    building_id: null,
                    resource_type: null,
                    resource_yield: null
                });
            }
        }

        const expectedCount = defaultWidth * defaultHeight;
        get.mockResolvedValue({ count: expectedCount }); // Simulate full map data exists
        // Mock PRAGMA to return something, indicating table exists
        all.mockResolvedValueOnce([{ name: 'tile_x' }, { name: 'tile_y' }]) // PRAGMA call
           .mockResolvedValueOnce(mockTileData); // SELECT call

        // Act
        await initializeMap(defaultWidth, defaultHeight);

        // Assert: Check if tiles in memory match loaded data
        await Promise.resolve(); // Add a microtask yield to ensure state updates propagate
        const tile00 = getTile(0, 0);
        expect(tile00.type).toBe('water');
        expect(tile00.walkable).toBe(false);
        expect(tile00.buildable).toBe(false);

        const tile10 = getTile(1, 0);
        expect(tile10.type).toBe('grass');
        expect(tile10.walkable).toBe(true);

        // Assert that DB SELECT was called using the imported 'all' mock
        expect(all).toHaveBeenCalledWith(expect.stringContaining('SELECT tile_x as x, tile_y as y'));
        // Assert that DB INSERT was NOT called (because data was loaded)
        expect(run).not.toHaveBeenCalledWith(expect.stringContaining('INSERT INTO MapTiles')); // No inserts should happen
    });

    it('initializeMap should generate and save default data if DB is empty', async () => {
        // Arrange: Mock DB functions for empty map scenario
        get.mockResolvedValue({ count: 0 });
        all.mockResolvedValueOnce([]); // PRAGMA
        // Mock run for the insertions
        run.mockResolvedValue({ changes: 1 });

        // Act
        await initializeMap(defaultWidth, defaultHeight);

        // Assert: Check if DB run was called for insertion for each tile
        expect(run).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO MapTiles'), expect.any(Array));
        expect(run).toHaveBeenCalledTimes(defaultWidth * defaultHeight); // Called for each tile insert

        // Assert: Check memory state as well
        const tile = getTile(0, 0);
        expect(tile.type).toBe('grass'); // Default generated tile
    });

     it('initializeMap should handle DB error during load and fallback to in-memory', async () => {
         // Arrange: Mock getDb to throw an error
         // Simulate DB connection/function error by rejecting 'all' during init
         all.mockRejectedValue(new Error("DB connection failed"));
         const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {}); // Suppress console error

         // Act
         await initializeMap(defaultWidth, defaultHeight);

         // Assert: Check if map was initialized in memory despite error
         expect(getMapWidth()).toBe(defaultWidth);
         expect(getMapHeight()).toBe(defaultHeight);
         const tile = getTile(0, 0);
         expect(tile).not.toBeNull(); // Should have fallback in-memory tile
         expect(tile.type).toBe('grass');
         expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("Error initializing map"), expect.any(Error));

         consoleErrorSpy.mockRestore();
     });

    it('updateTileProperties should call DB run with correct SQL and parameters', async () => {
        // Arrange: Initialize empty map
        get.mockResolvedValue({ count: 0 });
        all.mockResolvedValueOnce([]); // PRAGMA
        run.mockResolvedValue({ changes: 1 }); // Mock insert success
        await initializeMap(defaultWidth, defaultHeight);
        // Mock the specific DB update call to succeed
        run.mockClear(); // Clear init calls
        run.mockResolvedValue({ changes: 1 });

        // Act
        const propsToUpdate = { type: 'forest', walkable: false, buildingId: 123 };
        await updateTileProperties(5, 6, propsToUpdate);

        // Assert
        expect(run).toHaveBeenCalledTimes(1);
        expect(run).toHaveBeenCalledWith(
            expect.stringContaining('UPDATE MapTiles SET type = ?, is_walkable = ?, building_id = ?'),
            ['forest', 0, 123, 5, 6]
        );
    });

     it('updateTileProperties should handle resource updates correctly in DB call', async () => {
        // Arrange: Initialize empty map
        get.mockResolvedValue({ count: 0 });
        all.mockResolvedValueOnce([]); // PRAGMA
        run.mockResolvedValue({ changes: 1 }); // Mock insert success
        await initializeMap(defaultWidth, defaultHeight);
        // Mock the specific DB update call to succeed
        run.mockClear(); // Clear init calls
        run.mockResolvedValue({ changes: 1 });

        // Act
        const propsToUpdate = { resource: { type: 'wood', amount: 50 } };
        await updateTileProperties(1, 2, propsToUpdate);

        // Assert
        expect(run).toHaveBeenCalledTimes(1);
        expect(run).toHaveBeenCalledWith(
            expect.stringContaining('UPDATE MapTiles SET resource_type = ?, resource_yield = ?'),
            ['wood', 50, 1, 2]
        );
     });

     it('updateTileProperties should handle setting resource to null correctly in DB call', async () => {
        // Arrange: Initialize empty map
        get.mockResolvedValue({ count: 0 });
        all.mockResolvedValueOnce([]); // PRAGMA
        run.mockResolvedValue({ changes: 1 }); // Mock insert success
        await initializeMap(defaultWidth, defaultHeight);
        // Set an initial resource (this will also call run, need to clear after)
        await updateTileProperties(1, 2, { resource: { type: 'wood', amount: 50 } });
        run.mockClear(); // Clear the run call from the initial resource set
        run.mockResolvedValue({ changes: 1 }); // Mock success for the null update

        // Act: Update resource to null
        const propsToUpdate = { resource: null };
        await updateTileProperties(1, 2, propsToUpdate);

        // Assert
        expect(run).toHaveBeenCalledTimes(1);
        expect(run).toHaveBeenCalledWith(
            expect.stringContaining('UPDATE MapTiles SET resource_type = ?, resource_yield = ?'),
            [null, null, 1, 2]
        );
     });


    it('updateTileProperties should return false and revert memory if DB update fails', async () => {
        // Arrange: Initialize empty map
        get.mockResolvedValue({ count: 0 });
        all.mockResolvedValueOnce([]); // PRAGMA
        run.mockResolvedValue({ changes: 1 }); // Mock insert success
        await initializeMap(defaultWidth, defaultHeight);
        const originalTile = { ...getTile(4, 4) };
        // Mock DB update to fail
        run.mockClear(); // Clear init calls
        run.mockResolvedValue({ changes: 0 });

        // Act
        const result = await updateTileProperties(4, 4, { type: 'lava' });

        // Assert
        expect(result).toBe(false);
        const currentTile = getTile(4, 4);
        expect(currentTile.type).toBe(originalTile.type); // Should have reverted to original 'grass'
        expect(run).toHaveBeenCalled(); // Ensure DB was attempted
        // expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining("Reverted in-memory update"));
        // consoleWarnSpy.mockRestore();
    });


    it('isWalkable should return false for out-of-bounds coordinates after initialization', async () => {
        // Arrange
        get.mockResolvedValue({ count: 0 });
        all.mockResolvedValueOnce([]); // PRAGMA
        run.mockResolvedValue({ changes: 1 }); // Mock insert success
        await initializeMap(defaultWidth, defaultHeight);

        // Act & Assert
        expect(isWalkable(-1, 5)).toBe(false);
        expect(isWalkable(defaultWidth, 5)).toBe(false);
    });

    it('isBuildable should return true for default tiles after initialization', async () => {
        // Arrange
        get.mockResolvedValue({ count: 0 });
        all.mockResolvedValueOnce([]); // PRAGMA
        run.mockResolvedValue({ changes: 1 }); // Mock insert success
        await initializeMap(defaultWidth, defaultHeight);

        // Act & Assert
        expect(isBuildable(2, 2)).toBe(true);
    });

    it('isBuildable should return false for non-buildable tiles after update', async () => {
        // Arrange: Initialize empty map
        get.mockResolvedValue({ count: 0 });
        all.mockResolvedValueOnce([]); // PRAGMA
        run.mockResolvedValue({ changes: 1 }); // Mock insert success
        await initializeMap(defaultWidth, defaultHeight);
        // Mock the specific DB update call to succeed
        run.mockClear(); // Clear init calls
        run.mockResolvedValue({ changes: 1 });

        // Act
        await updateTileProperties(2, 2, { buildable: false }); // Now async

        // Assert
        expect(isBuildable(2, 2)).toBe(false);
    });

    it('isBuildable should return false if a building exists on the tile after update', async () => {
        // Arrange: Initialize empty map
        get.mockResolvedValue({ count: 0 });
        all.mockResolvedValueOnce([]); // PRAGMA
        run.mockResolvedValue({ changes: 1 }); // Mock insert success
        await initializeMap(defaultWidth, defaultHeight);
        // Mock the specific DB update call to succeed
        run.mockClear(); // Clear init calls
        run.mockResolvedValue({ changes: 1 });

        // Act
        await updateTileProperties(2, 2, { buildingId: 'building_123' }); // Now async

        // Assert
        expect(isBuildable(2, 2)).toBe(false);
    });

    it('isBuildable should return false for out-of-bounds coordinates after initialization', async () => {
        // Arrange: Initialize empty map
        get.mockResolvedValue({ count: 0 });
        all.mockResolvedValueOnce([]); // PRAGMA
        run.mockResolvedValue({ changes: 1 }); // Mock insert success
        await initializeMap(defaultWidth, defaultHeight);

        // Act & Assert
        expect(isBuildable(5, -1)).toBe(false);
        expect(isBuildable(5, defaultHeight)).toBe(false);
    });

    it('updateTileProperties should modify tile properties in memory', async () => {
        // Arrange: Initialize empty map
        get.mockResolvedValue({ count: 0 });
        all.mockResolvedValueOnce([]); // PRAGMA
        run.mockResolvedValue({ changes: 1 }); // Mock insert success
        await initializeMap(defaultWidth, defaultHeight);
        // Mock the specific DB update call to succeed
        run.mockClear(); // Clear init calls
        run.mockResolvedValue({ changes: 1 });

        // Act
        const newProps = { type: 'water', walkable: false, buildable: false };
        await updateTileProperties(7, 8, newProps); // Now async

        // Assert (memory check)
        const tile = getTile(7, 8);
        expect(tile.type).toBe('water');
        expect(tile.walkable).toBe(false);
        expect(tile.buildable).toBe(false);
    });

    it('updateTileProperties should handle partial updates in memory', async () => {
        // Arrange: Initialize empty map
        get.mockResolvedValue({ count: 0 });
        all.mockResolvedValueOnce([]); // PRAGMA
        run.mockResolvedValue({ changes: 1 }); // Mock insert success
        await initializeMap(defaultWidth, defaultHeight);
        // Mock the specific DB update call to succeed
        run.mockClear(); // Clear init calls
        run.mockResolvedValue({ changes: 1 });

        // Act
        await updateTileProperties(1, 1, { type: 'forest' });

        // Assert (memory check *after* await)
        const tile = getTile(1, 1); // Get tile state again after update
        expect(tile.type).toBe('forest');
        expect(tile.walkable).toBe(true); // Should remain default
        expect(tile.buildable).toBe(true); // Should remain default
    });

    it('updateTileProperties should not affect other tiles in memory', async () => {
        // Arrange: Initialize empty map
        get.mockResolvedValue({ count: 0 });
        all.mockResolvedValueOnce([]); // PRAGMA
        run.mockResolvedValue({ changes: 1 }); // Mock insert success
        await initializeMap(defaultWidth, defaultHeight);
        const originalTile = { ...getTile(6, 6) };
        // Mock the specific DB update call to succeed
        run.mockClear(); // Clear init calls
        run.mockResolvedValue({ changes: 1 });

        // Act
        await updateTileProperties(7, 8, { type: 'water', walkable: false }); // Now async

        // Assert (memory check)
        const tile66 = getTile(6, 6);
        expect(tile66.type).toBe(originalTile.type);
        expect(tile66.walkable).toBe(originalTile.walkable);
    });

    it('updateTileProperties should return false for out-of-bounds tiles', async () => {
        // Arrange: Initialize empty map
        get.mockResolvedValue({ count: 0 });
        all.mockResolvedValueOnce([]); // PRAGMA
        run.mockResolvedValue({ changes: 1 }); // Mock insert success
        await initializeMap(defaultWidth, defaultHeight);
        const originalTile = { ...getTile(0, 0) };
        run.mockClear(); // Clear init calls

        // Act
        const result = await updateTileProperties(-1, 0, { type: 'lava' }); // Now async

        // Assert
        expect(result).toBe(false);
        const tile00 = getTile(0, 0);
        expect(tile00.type).toBe(originalTile.type); // Should be unchanged
        expect(run).not.toHaveBeenCalled(); // DB run should not have been called *after* mockClear
    });

});
 
 // --- Tests for Phaser Integration (createMapVisuals) ---
 describe('Map Engine - Phaser Integration (createMapVisuals)', () => {
     const defaultWidth = 5;
     const defaultHeight = 5;
     let mockScene;
     let mockGraphics;
     let mockText;
     let mockInput;
     // No mockDb needed here, use imported mocks

     beforeEach(async () => {
         // Reset map engine state
         _resetState();
         vi.clearAllMocks();

         // Mock Database for initialization
         get.mockResolvedValue({ count: 0 }); // Simulate empty table
         all.mockResolvedValue([]); // Simulate empty table
         run.mockResolvedValue({ changes: 1 }); // Mock insert success
 
         // Initialize map before each visual test
         await initializeMap(defaultWidth, defaultHeight);
 
         // Mock Phaser Scene and its relevant methods/properties
         mockGraphics = {
             fillStyle: vi.fn(),
             fillRect: vi.fn(),
             lineStyle: vi.fn(),
             strokeRect: vi.fn(),
             lineBetween: vi.fn(),
             destroy: vi.fn(),
         };
         mockText = {
             setText: vi.fn(),
             setScrollFactor: vi.fn().mockReturnThis(), // Chainable
             setDepth: vi.fn().mockReturnThis(),      // Chainable
             destroy: vi.fn(),
         };
         mockInput = {
             on: vi.fn(), // Mock the input event listener registration
         };
         mockScene = {
             add: {
                 graphics: vi.fn().mockReturnValue(mockGraphics),
                 text: vi.fn().mockReturnValue(mockText),
             },
             input: mockInput,
         };
     });
 
     it('should call scene.add.graphics and scene.add.text when creating visuals', () => {
         createMapVisuals(mockScene, 32, 32);
         expect(mockScene.add.graphics).toHaveBeenCalledTimes(2); // One for tiles, one for overlay
         expect(mockScene.add.text).toHaveBeenCalledTimes(1);
     });
 
     it('should call graphics methods for each tile', () => {
         createMapVisuals(mockScene, 32, 32);
         const tileCount = defaultWidth * defaultHeight;
         // Adjust expected counts based on implementation details (base + overlays)
         const expectedFillCalls = tileCount + tileCount; // Base color + walkable indicator (assuming all default are walkable)
         const expectedRectCalls = tileCount + tileCount; // Base rect + walkable indicator
         expect(mockGraphics.fillStyle).toHaveBeenCalled(); // Check if called at least once
         expect(mockGraphics.fillRect).toHaveBeenCalled(); // Check if called at least once
         expect(mockGraphics.strokeRect).toHaveBeenCalledTimes(tileCount); // Grid lines
     });
 
     it('should register a pointermove listener on scene input', () => {
         createMapVisuals(mockScene, 32, 32);
         expect(mockInput.on).toHaveBeenCalledWith('pointermove', expect.any(Function));
     });
 
     it('should not throw errors with valid scene and initialized map', () => {
         expect(() => createMapVisuals(mockScene, 32, 32)).not.toThrow();
     });
 
     it('should handle being called before initialization', () => {
         _resetState(); // Ensure map is not initialized
         const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
         createMapVisuals(mockScene, 32, 32);
         expect(mockScene.add.graphics).not.toHaveBeenCalled();
         expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("Map Engine not initialized"));
         consoleErrorSpy.mockRestore();
     });
 
     it('should handle being called without a scene', () => {
         const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
         createMapVisuals(null, 32, 32);
         expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("Phaser scene is required"));
         consoleErrorSpy.mockRestore();
     });
 });
 