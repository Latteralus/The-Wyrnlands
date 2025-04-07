// tests/unit/engines/movementEngine.test.js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock dependencies
vi.mock('../../../src/engines/mapEngine.js', () => ({
    getTile: vi.fn(),
}));
vi.mock('../../../src/engines/playerEngine.js', () => ({
    getPlayerState: vi.fn(),
    updatePlayerAttributes: vi.fn(),
}));
vi.mock('../../../src/engines/npcEngine.js', () => ({
    getNpcState: vi.fn(),
    updateNpcAttributes: vi.fn(),
}));
// Mock Phaser scene/sprite interactions minimally for unit tests
const mockScene = {
    input: {
        on: vi.fn(),
        off: vi.fn(),
    },
    tweens: {
        add: vi.fn(),
    }
};
const mockSprite = {
    x: 0,
    y: 0,
};

// Import the module AFTER mocks are set up
import * as MovementEngine from '../../../src/engines/movementEngine.js';
import { getTile } from '../../../src/engines/mapEngine.js';
import { getPlayerState, updatePlayerAttributes } from '../../../src/engines/playerEngine.js';
import { getNpcState, updateNpcAttributes } from '../../../src/engines/npcEngine.js';

describe('Movement Engine', () => {
    const TILE_WIDTH = 32;
    const TILE_HEIGHT = 32;
    const mockPlayerState = { id: null, x: 10, y: 10 }; // Player ID is null
    const mockNpcState = { id: 5, x: 20, y: 20 };

    beforeEach(() => {
        // Reset mocks before each test
        vi.clearAllMocks();

        // Mock default states
        getPlayerState.mockReturnValue(mockPlayerState);
        getNpcState.mockImplementation((id) => id === 5 ? mockNpcState : null); // Mock for NPC ID 5

        // Mock successful DB updates by default
        updatePlayerAttributes.mockResolvedValue(true);
        updateNpcAttributes.mockResolvedValue(true);

        // Initialize the engine for tests that need it
        MovementEngine.initializeMovement(mockScene, mockSprite, TILE_WIDTH, TILE_HEIGHT);
    });

    afterEach(() => {
        // Clean up listeners if necessary, though initializeMovement handles it
    });

    describe('Initialization', () => {
        it('should initialize and set up pointerdown listener', () => {
            // Reset mocks specifically for this test if needed
            vi.clearAllMocks();
            MovementEngine.initializeMovement(mockScene, mockSprite, TILE_WIDTH, TILE_HEIGHT);
            expect(mockScene.input.on).toHaveBeenCalledWith('pointerdown', expect.any(Function));
            // We can't easily check the internal isInitialized flag without exporting it for tests
        });

        it('should log error if scene or sprite is missing', () => {
            const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            MovementEngine.initializeMovement(null, mockSprite, TILE_WIDTH, TILE_HEIGHT);
            expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("requires a Phaser scene and player sprite"));
            MovementEngine.initializeMovement(mockScene, null, TILE_WIDTH, TILE_HEIGHT);
            expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("requires a Phaser scene and player sprite"));
            errorSpy.mockRestore();
        });
    });

    describe('movePlayerTo', () => {
        it('should move player to a valid walkable tile', async () => {
            const targetX = 11;
            const targetY = 10;
            getTile.mockReturnValue({ x: targetX, y: targetY, walkable: true, buildable: true });

            const result = await MovementEngine.movePlayerTo(targetX, targetY);

            expect(getTile).toHaveBeenCalledWith(targetX, targetY);
            expect(updatePlayerAttributes).toHaveBeenCalledTimes(1);
            expect(updatePlayerAttributes).toHaveBeenCalledWith({ x: targetX, y: targetY });
            expect(mockScene.tweens.add).toHaveBeenCalled(); // Check if visual update was triggered
            expect(result).toBe(true);
            // Check the correct update function was called
            expect(updatePlayerAttributes).toHaveBeenCalled();
            expect(updateNpcAttributes).not.toHaveBeenCalled();
        });

        it('should NOT move player to an unwalkable tile', async () => {
            const targetX = 12;
            const targetY = 10;
            getTile.mockReturnValue({ x: targetX, y: targetY, walkable: false, buildable: true });

            const result = await MovementEngine.movePlayerTo(targetX, targetY);

            expect(getTile).toHaveBeenCalledWith(targetX, targetY);
            expect(updatePlayerAttributes).not.toHaveBeenCalled();
            expect(mockScene.tweens.add).not.toHaveBeenCalled();
            expect(result).toBe(false);
        });

        it('should NOT move player to an invalid tile (out of bounds/null)', async () => {
            const targetX = -1;
            const targetY = 10;
            getTile.mockReturnValue(null); // Simulate out of bounds

            const result = await MovementEngine.movePlayerTo(targetX, targetY);

            expect(getTile).toHaveBeenCalledWith(targetX, targetY);
            expect(updatePlayerAttributes).not.toHaveBeenCalled();
            expect(mockScene.tweens.add).not.toHaveBeenCalled();
            expect(result).toBe(false);
            expect(updatePlayerAttributes).not.toHaveBeenCalled();
            expect(updatePlayerAttributes).not.toHaveBeenCalled();
        });

        it('should NOT move player if already at the target tile', async () => {
            const targetX = 10; // Same as initial mock state
            const targetY = 10;
            getTile.mockReturnValue({ x: targetX, y: targetY, walkable: true, buildable: true }); // Tile is valid

            const result = await MovementEngine.movePlayerTo(targetX, targetY);

            // getTile might still be called to check, but no update should occur
            expect(getTile).toHaveBeenCalledWith(targetX, targetY);
            expect(updatePlayerAttributes).not.toHaveBeenCalled();
            expect(mockScene.tweens.add).not.toHaveBeenCalled();
            expect(result).toBe(false); // No actual movement occurred
            expect(updatePlayerAttributes).not.toHaveBeenCalled();
        });

        it('should return false and not tween if database update fails', async () => {
            const targetX = 11;
            const targetY = 10;
            getTile.mockReturnValue({ x: targetX, y: targetY, walkable: true, buildable: true });
            updatePlayerAttributes.mockResolvedValue(false); // Simulate DB update failure

            const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            const result = await MovementEngine.movePlayerTo(targetX, targetY);

            expect(getTile).toHaveBeenCalledWith(targetX, targetY);
            expect(updatePlayerAttributes).toHaveBeenCalledWith({ x: targetX, y: targetY });
            expect(mockScene.tweens.add).not.toHaveBeenCalled();
            // Adjust expectation for prefixed error message
            expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Player: Movement failed: Could not update entity attributes"));
            expect(result).toBe(false);
            // updatePlayerAttributes *was* called, but returned false. Remove the not.toHaveBeenCalled assertion.
            errorSpy.mockRestore();
        });

        it('should return false if player state is not available', async () => {
            getPlayerState.mockReturnValue(null); // Simulate player engine not ready
            const targetX = 11;
            const targetY = 10;

            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            const result = await MovementEngine.movePlayerTo(targetX, targetY);
// Adjust expectation for prefixed warning message
expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Player: Entity state not available."));
// Remove the redundant/incorrect second assertion for the warning message
            expect(getTile).not.toHaveBeenCalled();
            expect(updatePlayerAttributes).not.toHaveBeenCalled();
            expect(result).toBe(false);
            warnSpy.mockRestore();
            expect(updatePlayerAttributes).not.toHaveBeenCalled();
        });

        // TODO: Add tests for movement cost/stamina if that feature is implemented
    });

    describe('moveNpcTo', () => {
        const npcId = 5;
        const targetX = 21;
        const targetY = 20;
        const mockNpcSprite = { x: 0, y: 0 }; // Simple mock sprite for NPC

        beforeEach(() => {
            // Register the mock sprite for the NPC
            MovementEngine.registerNpcSprite(npcId, mockNpcSprite);
        });

        it('should move NPC to a valid walkable tile', async () => {
            getTile.mockReturnValue({ x: targetX, y: targetY, walkable: true });
            updateNpcAttributes.mockResolvedValue(true);

            const result = await MovementEngine.moveNpcTo(npcId, targetX, targetY);

            expect(getNpcState).toHaveBeenCalledWith(npcId);
            expect(getTile).toHaveBeenCalledWith(targetX, targetY);
            expect(updateNpcAttributes).toHaveBeenCalledTimes(1);
            expect(updateNpcAttributes).toHaveBeenCalledWith(npcId, { x: targetX, y: targetY });
            expect(mockScene.tweens.add).toHaveBeenCalledWith(expect.objectContaining({ targets: mockNpcSprite }));
            expect(result).toBe(true);
            expect(updatePlayerAttributes).not.toHaveBeenCalled(); // Ensure player wasn't updated
        });

        it('should NOT move NPC to an unwalkable tile', async () => {
            getTile.mockReturnValue({ x: targetX, y: targetY, walkable: false });
            const result = await MovementEngine.moveNpcTo(npcId, targetX, targetY);
            expect(getTile).toHaveBeenCalledWith(targetX, targetY);
            expect(updateNpcAttributes).not.toHaveBeenCalled();
            expect(mockScene.tweens.add).not.toHaveBeenCalled();
            expect(result).toBe(false);
        });

        it('should NOT move NPC if already at the target tile', async () => {
            const currentX = mockNpcState.x;
            const currentY = mockNpcState.y;
            getTile.mockReturnValue({ x: currentX, y: currentY, walkable: true }); // Tile is valid
            const result = await MovementEngine.moveNpcTo(npcId, currentX, currentY);
            expect(getTile).toHaveBeenCalledWith(currentX, currentY);
            expect(updateNpcAttributes).not.toHaveBeenCalled();
            expect(result).toBe(false);
        });

        it('should return false and not tween if database update fails for NPC', async () => {
            getTile.mockReturnValue({ x: targetX, y: targetY, walkable: true });
            updateNpcAttributes.mockResolvedValue(false); // Simulate DB update failure
            const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

            const result = await MovementEngine.moveNpcTo(npcId, targetX, targetY);

            expect(updateNpcAttributes).toHaveBeenCalledWith(npcId, { x: targetX, y: targetY });
            expect(mockScene.tweens.add).not.toHaveBeenCalled();
            expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Could not update entity attributes"));
            expect(result).toBe(false);
            errorSpy.mockRestore();
        });

        it('should return false if NPC state is not available', async () => {
            getNpcState.mockReturnValue(null); // Simulate NPC not found
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            const result = await MovementEngine.moveNpcTo(npcId, targetX, targetY);
            expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Entity state not available"));
            expect(result).toBe(false);
            warnSpy.mockRestore();
        });

         it('should attempt logical move but warn if NPC sprite is not registered', async () => {
            MovementEngine.unregisterNpcSprite(npcId); // Ensure sprite is not registered
            getTile.mockReturnValue({ x: targetX, y: targetY, walkable: true });
            updateNpcAttributes.mockResolvedValue(true);
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

            const result = await MovementEngine.moveNpcTo(npcId, targetX, targetY);

            expect(result).toBe(true); // Logical move should still succeed
            expect(updateNpcAttributes).toHaveBeenCalledWith(npcId, { x: targetX, y: targetY });
            expect(mockScene.tweens.add).not.toHaveBeenCalled(); // No visual tween
            expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("No sprite registered"));
            warnSpy.mockRestore();
        });
    });

    describe('NPC Sprite Management', () => {
        it('should register and unregister NPC sprites', () => {
            const npcId = 10;
            const sprite = { id: 'npc10-sprite' };
            MovementEngine.registerNpcSprite(npcId, sprite);
            // Cannot directly check internal npcSprites map without exposing it
            // We can infer by testing moveNpcTo with this ID later if needed

            MovementEngine.unregisterNpcSprite(npcId);
            // Again, cannot directly verify removal without exposing state
        });
    });

    // TODO: Add tests for handleMapClick if needed
});