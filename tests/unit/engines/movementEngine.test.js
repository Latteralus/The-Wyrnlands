// tests/unit/engines/movementEngine.test.js
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Hoist mock definitions
const { mockMapEngine, mockPlayerEngine, mockUiManager, mockMountData } = vi.hoisted(() => { // Add mockMountData
    return {
        mockMapEngine: {
            isWalkable: vi.fn(),
            getTile: vi.fn(),
        },
        mockPlayerEngine: {
            getPlayerAttribute: vi.fn(),
            updatePlayerAttributes: vi.fn(),
            modifyNeed: vi.fn(),
        },
        mockUiManager: {
            handleBuildingInteraction: vi.fn(),
        },
        mockMountData: { // Mock for mount data access
            getMountData: vi.fn(),
        }
    };
});

// Mock dependencies using hoisted variables
vi.mock('@/engines/mapEngine.js', () => mockMapEngine);
vi.mock('@/engines/playerEngine.js', () => mockPlayerEngine);
vi.mock('@/managers/uiManager.js', () => mockUiManager);
vi.mock('@/data/mountData.js', () => mockMountData); // Mock mount data module

// Import the function to test AFTER mocks are set up
import { initializeMovementEngine, moveToTile } from '@/engines/movementEngine.js';

describe('Movement Engine', () => {

    let mockScene;
    let mockPlayerSprite;
    let mockInput;
 
    beforeEach(() => {
        // Reset mocks before each test
        vi.clearAllMocks();
 
        // Setup default mock behaviors
        // Assume player is at (0, 0) by default for these tests
        mockPlayerEngine.getPlayerAttribute.mockImplementation((attr) => {
            if (attr === 'x') return 0;
            if (attr === 'y') return 0;
            return undefined;
        });
        // Assume target tiles are walkable by default unless specified otherwise
        mockMapEngine.isWalkable.mockReturnValue(true);
        // Assume tiles are empty by default unless specified otherwise
        mockMapEngine.getTile.mockReturnValue(null); // Default: no tile data / empty tile
 
        // Mock Phaser scene components
        mockInput = {
            on: vi.fn(),
        };
        mockScene = {
            input: mockInput,
        };
        mockPlayerSprite = {
            setPosition: vi.fn(),
        };
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should move player to target tile if it is walkable', () => {
        const targetX = 5;
        const targetY = 5;
        mockMapEngine.isWalkable.mockReturnValueOnce(true); // Explicitly set for this test

        const result = moveToTile(targetX, targetY);

        expect(result).toBe(true);
        expect(mockMapEngine.isWalkable).toHaveBeenCalledOnce();
        expect(mockMapEngine.isWalkable).toHaveBeenCalledWith(targetX, targetY);
        expect(mockPlayerEngine.updatePlayerAttributes).toHaveBeenCalledOnce();
        expect(mockPlayerEngine.updatePlayerAttributes).toHaveBeenCalledWith({ x: targetX, y: targetY });
        // Visual update check (assuming init was called)
        // Need to call initializeMovementEngine first for playerSprite to be set
        initializeMovementEngine(mockScene, mockPlayerSprite, 32, 32); // Use default tile size
        moveToTile(targetX, targetY); // Call again after init
        expect(mockPlayerSprite.setPosition).toHaveBeenCalledWith(targetX * 32 + 16, targetY * 32 + 16); // Center pixel coords
    });

    it('should NOT move player to target tile if it is not walkable', () => {
        const targetX = 2;
        const targetY = 3;
        mockMapEngine.isWalkable.mockReturnValueOnce(false); // Target is not walkable

        const result = moveToTile(targetX, targetY);

        expect(result).toBe(false);
        expect(mockMapEngine.isWalkable).toHaveBeenCalledOnce();
        expect(mockMapEngine.isWalkable).toHaveBeenCalledWith(targetX, targetY);
        expect(mockPlayerEngine.updatePlayerAttributes).not.toHaveBeenCalled();
        expect(mockPlayerSprite.setPosition).not.toHaveBeenCalled(); // Visuals shouldn't update
    });

    it('should handle cases where player coordinates are missing (error state)', () => {
        // Override mock for this specific test case
         mockPlayerEngine.getPlayerAttribute.mockImplementation((attr) => {
            return undefined; // Simulate missing coordinates
        });

        const result = moveToTile(1, 1);

        expect(result).toBe(false);
        expect(mockMapEngine.isWalkable).not.toHaveBeenCalled(); // Shouldn't check walkability if coords missing
        expect(mockPlayerEngine.updatePlayerAttributes).not.toHaveBeenCalled();
        expect(mockPlayerSprite.setPosition).not.toHaveBeenCalled(); // Visuals shouldn't update
    });

    // TODO: Add tests for pathfinding once implemented
it('should call modifyNeed with default fatigue cost when not mounted', () => {
    const targetX = 1;
    const targetY = 1;
    mockMapEngine.isWalkable.mockReturnValueOnce(true);
    // Ensure player is not mounted
    mockPlayerEngine.getPlayerAttribute.mockImplementation((attr) => {
        if (attr === 'x') return 0;
        if (attr === 'y') return 0;
        if (attr === 'currentMountId') return null; // Not mounted
        return undefined;
    });

        moveToTile(targetX, targetY);

        expect(mockPlayerEngine.modifyNeed).toHaveBeenCalledTimes(1);
        expect(mockPlayerEngine.modifyNeed).toHaveBeenCalledWith('fatigue', -0.5); // Default cost
        expect(mockMountData.getMountData).not.toHaveBeenCalled(); // Mount data should not be fetched
    });

    it('should call modifyNeed with modified fatigue cost when mounted', () => {
        const targetX = 1;
        const targetY = 1;
        const mountId = 'horse';
        const mockHorseData = { name: 'Horse', speedModifier: 1.8, fatigueModifier: 0.7 };
        mockMapEngine.isWalkable.mockReturnValueOnce(true);
        // Ensure player IS mounted
        mockPlayerEngine.getPlayerAttribute.mockImplementation((attr) => {
            if (attr === 'x') return 0;
            if (attr === 'y') return 0;
            if (attr === 'currentMountId') return mountId; // Mounted on horse
            return undefined;
        });
        // Mock mount data retrieval
        mockMountData.getMountData.mockReturnValueOnce(mockHorseData);

        moveToTile(targetX, targetY);

        expect(mockMountData.getMountData).toHaveBeenCalledWith(mountId);
        expect(mockPlayerEngine.modifyNeed).toHaveBeenCalledTimes(1);
        // Calculate expected cost: base_cost * modifier = 0.5 * 0.7 = 0.35
        expect(mockPlayerEngine.modifyNeed).toHaveBeenCalledWith('fatigue', -0.35);
    });

    it('should use default fatigue cost if mount data is not found', () => {
        const targetX = 1;
        const targetY = 1;
        const mountId = 'invalid_mount';
        mockMapEngine.isWalkable.mockReturnValueOnce(true);
        // Player is mounted on something invalid
        mockPlayerEngine.getPlayerAttribute.mockImplementation((attr) => {
            if (attr === 'x') return 0;
            if (attr === 'y') return 0;
            if (attr === 'currentMountId') return mountId;
            return undefined;
        });
        // Mock mount data retrieval returning null
        mockMountData.getMountData.mockReturnValueOnce(null);

        moveToTile(targetX, targetY);

        expect(mockMountData.getMountData).toHaveBeenCalledWith(mountId);
        expect(mockPlayerEngine.modifyNeed).toHaveBeenCalledTimes(1);
        expect(mockPlayerEngine.modifyNeed).toHaveBeenCalledWith('fatigue', -0.5); // Fallback to default cost
    });

 
    // --- Initialization and Input Tests ---
 
    it('initializeMovementEngine should register a pointerdown listener', () => {
        initializeMovementEngine(mockScene, mockPlayerSprite, 32, 32);
        expect(mockInput.on).toHaveBeenCalledOnce();
        expect(mockInput.on).toHaveBeenCalledWith('pointerdown', expect.any(Function));
    });
 
    it('pointerdown listener should calculate tile coords and call moveToTile', () => {
        initializeMovementEngine(mockScene, mockPlayerSprite, 32, 32);
        // Ensure getTile returns null or a tile without buildingId for this test
        mockMapEngine.getTile.mockReturnValueOnce({ x: 3, y: 4, buildingId: null }); // Simulate empty tile
        // Get the callback function registered by the listener
        const pointerDownCallback = mockInput.on.mock.calls[0][1];
 
        // Simulate a pointer down event
        const mockPointer = {
            worldX: 100, // Example pixel coordinate
            worldY: 150, // Example pixel coordinate
        };
        pointerDownCallback(mockPointer);
 
        // Assert: Check if moveToTile was called with calculated tile coordinates
        const expectedTileX = Math.floor(100 / 32); // 3
        const expectedTileY = Math.floor(150 / 32); // 4
        // moveToTile is mocked indirectly via the hoisted mocks, so we check the underlying engine calls
        expect(mockMapEngine.isWalkable).toHaveBeenCalledWith(expectedTileX, expectedTileY);
        expect(mockPlayerEngine.updatePlayerAttributes).toHaveBeenCalledWith({ x: expectedTileX, y: expectedTileY });
    });
 
    it('pointerdown listener should call handleBuildingInteraction if tile has building', () => {
        initializeMovementEngine(mockScene, mockPlayerSprite, 32, 32);
        const buildingTileX = 2;
        const buildingTileY = 2;
        const buildingId = 'building_123';
        // Ensure getTile returns a tile *with* a buildingId for this test
        mockMapEngine.getTile.mockReturnValueOnce({ x: buildingTileX, y: buildingTileY, buildingId: buildingId });
 
        // Get the callback function
        const pointerDownCallback = mockInput.on.mock.calls[0][1];
 
        // Simulate a pointer down event on the building tile
        const mockPointer = {
            worldX: buildingTileX * 32 + 16, // Click center of tile (2, 2)
            worldY: buildingTileY * 32 + 16,
        };
        pointerDownCallback(mockPointer);
 
        // Assert: Check interaction handler was called, and movement was NOT
        expect(mockMapEngine.getTile).toHaveBeenCalledWith(buildingTileX, buildingTileY);
        expect(mockUiManager.handleBuildingInteraction).toHaveBeenCalledOnce();
        expect(mockUiManager.handleBuildingInteraction).toHaveBeenCalledWith(buildingId, buildingTileX, buildingTileY);
        // Ensure movement logic was skipped
        expect(mockMapEngine.isWalkable).not.toHaveBeenCalled();
        expect(mockPlayerEngine.updatePlayerAttributes).not.toHaveBeenCalled();
    });
 
    it('initializeMovementEngine should handle missing scene or playerVisual', () => {
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        initializeMovementEngine(null, mockPlayerSprite, 32, 32);
        expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("Scene and playerVisual are required"));
        initializeMovementEngine(mockScene, null, 32, 32);
        expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("Scene and playerVisual are required"));
        consoleErrorSpy.mockRestore();
    });
});