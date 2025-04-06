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
} from '@/engines/mapEngine.js'; // Using path alias
import * as dbModule from '@/data/database.js'; // Import the actual module

// Mock the database module
vi.mock('@/data/database.js', () => ({
   getDb: vi.fn(), // Mock the getDb function
   // Mock other exports if mapEngine starts using them directly
}));

describe('Map Engine', () => {

    // Use default dimensions for most tests
    const defaultWidth = 10;
    const defaultHeight = 10;

    let mockDb; // To hold the mock DB object for configuration per test

    beforeEach(() => {
        // Reset map engine state first
        _resetState();
        // Reset mocks before each test
        vi.clearAllMocks();

        // Setup a default mock DB object. Tests can override methods as needed.
        mockDb = {
            get: vi.fn().mockResolvedValue(undefined), // Default: table/row doesn't exist
            all: vi.fn().mockResolvedValue([]),       // Default: returns empty array
            run: vi.fn().mockResolvedValue({ changes: 0 }), // Default: no changes made
            prepare: vi.fn().mockResolvedValue({      // Default: returns mock statement
                run: vi.fn().mockResolvedValue({ changes: 1 }),
                finalize: vi.fn().mockResolvedValue(undefined),
            }),
            // Add mocks for beginTransaction, commit, rollback if needed, though run covers them for now
        };

        // Configure the mocked getDb to return our mockDb object
        dbModule.getDb.mockResolvedValue(mockDb);

        // NOTE: We no longer call initializeMap here by default.
        // Each test that requires an initialized map will call it
        // after setting up specific mock DB responses for that test's scenario.
    });

    // No afterEach needed for vi.clearAllMocks() as beforeEach handles it.

    it('should initialize the map with specified dimensions after successful initialization', async () => {
        // Arrange: Mock DB to simulate empty table, triggering generation
        mockDb.get.mockResolvedValue({ count: 0 }); // Simulate empty table check
        mockDb.all.mockResolvedValueOnce([]); // For PRAGMA check if used
                 // .mockResolvedValueOnce([]); // For SELECT check if used

        // Act
        await initializeMap(defaultWidth, defaultHeight);

        // Assert
        expect(getMapWidth()).toBe(defaultWidth);
        expect(getMapHeight()).toBe(defaultHeight);
    });

    it('should create default tiles in memory when initializing an empty map', async () => {
         // Arrange: Mock DB to simulate empty table
        mockDb.get.mockResolvedValue({ count: 0 });
        mockDb.all.mockResolvedValueOnce([]); // PRAGMA

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
        // Arrange: Mock DB for initialization
        mockDb.get.mockResolvedValue({ count: 0 });
        mockDb.all.mockResolvedValueOnce([]); // PRAGMA

        // Act
        await initializeMap(defaultWidth, defaultHeight);
        const tile = getTile(5, 5);

        // Assert
        expect(tile).not.toBeNull();
        expect(tile.x).toBe(5);
        expect(tile.y).toBe(5);
    });

    it('getTile should return null for out-of-bounds coordinates after initialization', async () => {
        // Arrange: Mock DB for initialization
        mockDb.get.mockResolvedValue({ count: 0 });
        mockDb.all.mockResolvedValueOnce([]); // PRAGMA
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
        // Arrange
        mockDb.get.mockResolvedValue({ count: 0 });
        mockDb.all.mockResolvedValueOnce([]); // PRAGMA
        await initializeMap(defaultWidth, defaultHeight);

        // Act & Assert
        expect(isWalkable(3, 4)).toBe(true);
    });

    it('isWalkable should return false for non-walkable tiles after update', async () => {
        // Arrange
        mockDb.get.mockResolvedValue({ count: 0 }); // Start empty
        mockDb.all.mockResolvedValueOnce([]); // PRAGMA
        await initializeMap(defaultWidth, defaultHeight);
        // Mock the DB update call to succeed
        mockDb.run.mockResolvedValue({ changes: 1 });

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
        mockDb.get.mockResolvedValue({ count: expectedCount }); // Simulate full map data exists
        // Mock PRAGMA to return something, indicating table exists
        mockDb.all.mockResolvedValueOnce([{ name: 'tile_x' }, { name: 'tile_y' }])
                 .mockResolvedValueOnce(mockTileData); // Mock SELECT to return the full mock data

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

        // Assert that DB SELECT was called
        expect(mockDb.all).toHaveBeenCalledWith(expect.stringContaining('SELECT tile_x as x, tile_y as y'));
        // Assert that DB INSERT was NOT called (because data was loaded)
        expect(mockDb.prepare).not.toHaveBeenCalled();
    });

    it('initializeMap should generate and save default data if DB is empty', async () => {
        // Arrange: Mock DB to simulate empty table
        mockDb.get.mockResolvedValue({ count: 0 });
        mockDb.all.mockResolvedValueOnce([]); // PRAGMA

        // Mock the prepare statement for insertion
        const mockStatement = {
            run: vi.fn().mockResolvedValue({ changes: 1 }),
            finalize: vi.fn().mockResolvedValue(undefined),
        };
        mockDb.prepare.mockResolvedValue(mockStatement);

        // Act
        await initializeMap(defaultWidth, defaultHeight);

        // Assert: Check if DB prepare and run were called for insertion
        expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO MapTiles'));
        // Check if statement.run was called for each tile
        expect(mockStatement.run).toHaveBeenCalledTimes(defaultWidth * defaultHeight);
        // Check if transaction commit was called (implicitly via db.run)
        expect(mockDb.run).toHaveBeenCalledWith('COMMIT');

        // Assert: Check memory state as well
        const tile = getTile(0, 0);
        expect(tile.type).toBe('grass'); // Default generated tile
    });

     it('initializeMap should handle DB error during load and fallback to in-memory', async () => {
         // Arrange: Mock getDb to throw an error
         dbModule.getDb.mockRejectedValue(new Error("DB connection failed"));
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
        // Arrange
        mockDb.get.mockResolvedValue({ count: 0 }); // Init empty
        mockDb.all.mockResolvedValueOnce([]); // PRAGMA
        await initializeMap(defaultWidth, defaultHeight);
        mockDb.run.mockResolvedValue({ changes: 1 }); // Mock DB update success
        mockDb.run.mockClear(); // Clear calls from initializeMap

        // Act
        const propsToUpdate = { type: 'forest', walkable: false, buildingId: 123 };
        await updateTileProperties(5, 6, propsToUpdate);

        // Assert
        expect(mockDb.run).toHaveBeenCalledTimes(1); // Should now only count the UPDATE call
        expect(mockDb.run).toHaveBeenCalledWith(
            expect.stringContaining('UPDATE MapTiles SET type = ?, is_walkable = ?, building_id = ? WHERE tile_x = ? AND tile_y = ?'),
            ['forest', 0, 123, 5, 6] // Values in correct order
        );
    });

     it('updateTileProperties should handle resource updates correctly in DB call', async () => {
        // Arrange
        mockDb.get.mockResolvedValue({ count: 0 }); // Init empty
        mockDb.all.mockResolvedValueOnce([]); // PRAGMA
        await initializeMap(defaultWidth, defaultHeight);
        mockDb.run.mockResolvedValue({ changes: 1 }); // Mock DB update success
        mockDb.run.mockClear(); // Clear calls from initializeMap

        // Act
        const propsToUpdate = { resource: { type: 'wood', amount: 50 } };
        await updateTileProperties(1, 2, propsToUpdate);

        // Assert
        expect(mockDb.run).toHaveBeenCalledTimes(1); // Should now only count the UPDATE call
        expect(mockDb.run).toHaveBeenCalledWith(
            expect.stringContaining('UPDATE MapTiles SET resource_type = ?, resource_yield = ? WHERE tile_x = ? AND tile_y = ?'),
            ['wood', 50, 1, 2]
        );
     });

     it('updateTileProperties should handle setting resource to null correctly in DB call', async () => {
        // Arrange
        mockDb.get.mockResolvedValue({ count: 0 }); // Init empty
        mockDb.all.mockResolvedValueOnce([]); // PRAGMA
        await initializeMap(defaultWidth, defaultHeight);
        // Set an initial resource in memory first
        await updateTileProperties(1, 2, { resource: { type: 'wood', amount: 50 } });
        // Reset mock run call count and setup for the actual test call
        mockDb.run.mockClear();
        mockDb.run.mockResolvedValue({ changes: 1 });

        // Act: Update resource to null
        const propsToUpdate = { resource: null };
        await updateTileProperties(1, 2, propsToUpdate);

        // Assert
        expect(mockDb.run).toHaveBeenCalledTimes(1);
        expect(mockDb.run).toHaveBeenCalledWith(
            expect.stringContaining('UPDATE MapTiles SET resource_type = ?, resource_yield = ? WHERE tile_x = ? AND tile_y = ?'),
            [null, null, 1, 2] // Expect nulls to be passed for resource columns
        );
     });


    it('updateTileProperties should return false and revert memory if DB update fails', async () => {
        // Arrange
        mockDb.get.mockResolvedValue({ count: 0 }); // Init empty
        mockDb.all.mockResolvedValueOnce([]); // PRAGMA
        await initializeMap(defaultWidth, defaultHeight);
        const originalTile = { ...getTile(4, 4) }; // Get original state
        // Mock DB update to fail (e.g., return 0 changes or throw error)
        mockDb.run.mockResolvedValue({ changes: 0 });
        // const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        // Act
        const result = await updateTileProperties(4, 4, { type: 'lava' });

        // Assert
        expect(result).toBe(false);
        const currentTile = getTile(4, 4);
        expect(currentTile.type).toBe(originalTile.type); // Should have reverted to original 'grass'
        expect(mockDb.run).toHaveBeenCalled(); // Ensure DB was attempted
        // expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining("Reverted in-memory update"));
        // consoleWarnSpy.mockRestore();
    });


    it('isWalkable should return false for out-of-bounds coordinates after initialization', async () => {
        // Arrange
        mockDb.get.mockResolvedValue({ count: 0 });
        mockDb.all.mockResolvedValueOnce([]); // PRAGMA
        await initializeMap(defaultWidth, defaultHeight);

        // Act & Assert
        expect(isWalkable(-1, 5)).toBe(false);
        expect(isWalkable(defaultWidth, 5)).toBe(false);
    });

    it('isBuildable should return true for default tiles after initialization', async () => {
        // Arrange
        mockDb.get.mockResolvedValue({ count: 0 });
        mockDb.all.mockResolvedValueOnce([]); // PRAGMA
        await initializeMap(defaultWidth, defaultHeight);

        // Act & Assert
        expect(isBuildable(2, 2)).toBe(true);
    });

    it('isBuildable should return false for non-buildable tiles after update', async () => {
        // Arrange
        mockDb.get.mockResolvedValue({ count: 0 });
        mockDb.all.mockResolvedValueOnce([]); // PRAGMA
        await initializeMap(defaultWidth, defaultHeight);
        mockDb.run.mockResolvedValue({ changes: 1 }); // Mock DB update success

        // Act
        await updateTileProperties(2, 2, { buildable: false }); // Now async

        // Assert
        expect(isBuildable(2, 2)).toBe(false);
    });

    it('isBuildable should return false if a building exists on the tile after update', async () => {
        // Arrange
        mockDb.get.mockResolvedValue({ count: 0 });
        mockDb.all.mockResolvedValueOnce([]); // PRAGMA
        await initializeMap(defaultWidth, defaultHeight);
        mockDb.run.mockResolvedValue({ changes: 1 }); // Mock DB update success

        // Act
        await updateTileProperties(2, 2, { buildingId: 'building_123' }); // Now async

        // Assert
        expect(isBuildable(2, 2)).toBe(false);
    });

    it('isBuildable should return false for out-of-bounds coordinates after initialization', async () => {
        // Arrange
        mockDb.get.mockResolvedValue({ count: 0 });
        mockDb.all.mockResolvedValueOnce([]); // PRAGMA
        await initializeMap(defaultWidth, defaultHeight);

        // Act & Assert
        expect(isBuildable(5, -1)).toBe(false);
        expect(isBuildable(5, defaultHeight)).toBe(false);
    });

    it('updateTileProperties should modify tile properties in memory', async () => {
        // Arrange
        mockDb.get.mockResolvedValue({ count: 0 });
        mockDb.all.mockResolvedValueOnce([]); // PRAGMA
        await initializeMap(defaultWidth, defaultHeight);
        mockDb.run.mockResolvedValue({ changes: 1 }); // Mock DB update success

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
        // Arrange
        mockDb.get.mockResolvedValue({ count: 0 });
        mockDb.all.mockResolvedValueOnce([]); // PRAGMA
        await initializeMap(defaultWidth, defaultHeight);
        mockDb.run.mockResolvedValue({ changes: 1 }); // Mock DB update success

        // Act
        await updateTileProperties(1, 1, { type: 'forest' }); // Now async

        // Assert (memory check)
        const tile = getTile(1, 1);
        expect(tile.type).toBe('forest');
        expect(tile.walkable).toBe(true); // Should remain default
        expect(tile.buildable).toBe(true); // Should remain default
    });

    it('updateTileProperties should not affect other tiles in memory', async () => {
        // Arrange
        mockDb.get.mockResolvedValue({ count: 0 });
        mockDb.all.mockResolvedValueOnce([]); // PRAGMA
        await initializeMap(defaultWidth, defaultHeight);
        const originalTile = { ...getTile(6, 6) }; // Shallow copy before update
        mockDb.run.mockResolvedValue({ changes: 1 }); // Mock DB update success

        // Act
        await updateTileProperties(7, 8, { type: 'water', walkable: false }); // Now async

        // Assert (memory check)
        const tile66 = getTile(6, 6);
        expect(tile66.type).toBe(originalTile.type);
        expect(tile66.walkable).toBe(originalTile.walkable);
    });

    it('updateTileProperties should return false for out-of-bounds tiles', async () => {
        // Arrange
        mockDb.get.mockResolvedValue({ count: 0 });
        mockDb.all.mockResolvedValueOnce([]); // PRAGMA
        await initializeMap(defaultWidth, defaultHeight);
        const originalTile = { ...getTile(0, 0) };
        mockDb.run.mockClear(); // Clear calls from initializeMap

        // Act
        const result = await updateTileProperties(-1, 0, { type: 'lava' }); // Now async

        // Assert
        expect(result).toBe(false);
        const tile00 = getTile(0, 0);
        expect(tile00.type).toBe(originalTile.type); // Should be unchanged
        expect(mockDb.run).not.toHaveBeenCalled(); // DB run should not have been called *after* mockClear
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
     let mockDb;
 
     beforeEach(async () => {
         // Reset map engine state
         _resetState();
         vi.clearAllMocks();
 
         // Mock Database for initialization
         mockDb = {
             get: vi.fn().mockResolvedValue({ count: 0 }), // Simulate empty table
             all: vi.fn().mockResolvedValue([]), // Simulate empty table
             run: vi.fn().mockResolvedValue({ changes: 1 }),
             prepare: vi.fn().mockResolvedValue({
                 run: vi.fn().mockResolvedValue({ changes: 1 }),
                 finalize: vi.fn().mockResolvedValue(undefined),
             }),
         };
         dbModule.getDb.mockResolvedValue(mockDb);
 
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
 