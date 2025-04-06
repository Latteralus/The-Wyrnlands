// tests/unit/engines/buildingEngine.test.js
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Hoist mock definitions
const { mockMapEngine, mockPlayerEngine } = vi.hoisted(() => { // Add mockPlayerEngine
    return {
        mockMapEngine: {
            getTile: vi.fn(),
            isBuildable: vi.fn(),
            updateTileProperties: vi.fn(),
        },
        mockPlayerEngine: { // Define mock for playerEngine
            getPlayerAttribute: vi.fn(),
        }
    };
});

// Mock dependencies using hoisted variables
vi.mock('@/engines/mapEngine.js', () => mockMapEngine);
vi.mock('@/engines/playerEngine.js', () => mockPlayerEngine); // Mock playerEngine

// Import functions to test AFTER mocks are set up
import {
    initializeBuildingEngine,
    placeBuilding,
    removeBuilding,
    getBuildingById,
    getBuildingInteractions, // Import new function
    Building, // Import class for type checking if needed
    _addBuildingForTest // Import test helper
} from '@/engines/buildingEngine.js';

describe('Building Engine', () => {

    beforeEach(async () => {
        // Reset mocks
        vi.clearAllMocks();
        // Initialize building engine (clears internal state)
        await initializeBuildingEngine();
        // Default mock behaviors
        mockMapEngine.isBuildable.mockReturnValue(true); // Assume tiles are buildable by default
        mockMapEngine.getTile.mockImplementation((x, y) => ({ // Mock getTile to return basic tile info
             x, y, buildingId: null, buildable: true, walkable: true
        }));
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should initialize correctly', () => {
        // Check if internal state is reset (difficult to test directly without exposing state)
        // We rely on beforeEach calling initializeBuildingEngine
        expect(getBuildingById('building_1')).toBeNull(); // Should be no buildings after init
    });

    describe('placeBuilding', () => {
        const buildingData = {
            x: 2, y: 3, width: 2, height: 1, type: 'house',
            ownerId: 'player1', sqFt: 500, roomCount: 3, taxRate: 10
        };

        it('should place a building successfully if tiles are buildable', () => {
            mockMapEngine.isBuildable.mockReturnValue(true); // Ensure all tiles are buildable

            const building = placeBuilding(
                buildingData.x, buildingData.y, buildingData.width, buildingData.height,
                buildingData.type, buildingData.ownerId, buildingData.sqFt,
                buildingData.roomCount, buildingData.taxRate
            );

            expect(building).toBeInstanceOf(Building);
            expect(building.id).toBeDefined();
            expect(building.x).toBe(buildingData.x);
            expect(building.y).toBe(buildingData.y);
            expect(building.width).toBe(buildingData.width);
            expect(building.height).toBe(buildingData.height);
            expect(building.ownerId).toBe(buildingData.ownerId);

            // Verify map updates
            expect(mockMapEngine.isBuildable).toHaveBeenCalledTimes(buildingData.width * buildingData.height);
            expect(mockMapEngine.isBuildable).toHaveBeenCalledWith(2, 3);
            expect(mockMapEngine.isBuildable).toHaveBeenCalledWith(3, 3);
            expect(mockMapEngine.updateTileProperties).toHaveBeenCalledTimes(buildingData.width * buildingData.height);
            expect(mockMapEngine.updateTileProperties).toHaveBeenCalledWith(2, 3, { buildingId: building.id, buildable: false, walkable: false });
            expect(mockMapEngine.updateTileProperties).toHaveBeenCalledWith(3, 3, { buildingId: building.id, buildable: false, walkable: false });

            // Verify building is stored
            expect(getBuildingById(building.id)).toEqual(building);
        });

        it('should fail placement if any tile is not buildable', () => {
            // Make the second tile not buildable
            mockMapEngine.isBuildable.mockImplementation((x, y) => {
                return !(x === 3 && y === 3);
            });

            const building = placeBuilding(
                buildingData.x, buildingData.y, buildingData.width, buildingData.height,
                buildingData.type, buildingData.ownerId, buildingData.sqFt,
                buildingData.roomCount, buildingData.taxRate
            );

            expect(building).toBeNull();
            // isBuildable should have been called until it found the non-buildable one
            expect(mockMapEngine.isBuildable).toHaveBeenCalledWith(2, 3); // Called for first tile
            expect(mockMapEngine.isBuildable).toHaveBeenCalledWith(3, 3); // Called for second tile (failed here)
            expect(mockMapEngine.updateTileProperties).not.toHaveBeenCalled(); // No map updates should occur
            expect(Object.keys(getBuildingById).length === 0); // Check internal state if possible, otherwise check via getBuildingById
        });

         it('should generate unique IDs for buildings', () => {
            const building1 = placeBuilding(1, 1, 1, 1, 'hut', 'p1', 100, 1, 5);
            const building2 = placeBuilding(5, 5, 1, 1, 'shed', 'p2', 50, 1, 2);
            expect(building1).not.toBeNull();
            expect(building2).not.toBeNull();
            expect(building1.id).not.toEqual(building2.id);
            expect(building1.id).toContain('building_');
            expect(building2.id).toContain('building_');
        });

    });

    describe('removeBuilding', () => {
         const buildingData = {
            x: 4, y: 4, width: 1, height: 1, type: 'shop',
            ownerId: 'npc1', sqFt: 300, roomCount: 2, taxRate: 8
        };
        let placedBuilding;

        beforeEach(() => {
            // Place a building to remove in tests
            mockMapEngine.isBuildable.mockReturnValue(true);
            placedBuilding = placeBuilding(
                buildingData.x, buildingData.y, buildingData.width, buildingData.height,
                buildingData.type, buildingData.ownerId, buildingData.sqFt,
                buildingData.roomCount, buildingData.taxRate
            );
            // Clear mocks called during placement
            vi.clearAllMocks();
             // Reset default mock behaviors needed for removal
            mockMapEngine.getTile.mockImplementation((x, y) => ({
                x, y, buildingId: placedBuilding.id, buildable: false, walkable: false
            }));
        });

        it('should remove an existing building successfully', () => {
            expect(getBuildingById(placedBuilding.id)).not.toBeNull(); // Verify it exists first

            const result = removeBuilding(placedBuilding.id);

            expect(result).toBe(true);
            // Verify map tiles are updated
            expect(mockMapEngine.updateTileProperties).toHaveBeenCalledOnce();
            expect(mockMapEngine.updateTileProperties).toHaveBeenCalledWith(
                buildingData.x, buildingData.y,
                { buildingId: null, buildable: true, walkable: true }
            );
            // Verify building is removed from internal store
            expect(getBuildingById(placedBuilding.id)).toBeNull();
        });

        it('should return false if building ID does not exist', () => {
            const result = removeBuilding('non_existent_id');
            expect(result).toBe(false);
            expect(mockMapEngine.updateTileProperties).not.toHaveBeenCalled();
        });

         it('should handle removing multi-tile buildings correctly', () => {
            // Place a 2x1 building
            mockMapEngine.isBuildable.mockReturnValue(true);
            const multiTileBuilding = placeBuilding(6, 6, 2, 1, 'house', 'p3', 600, 4, 12);
            vi.clearAllMocks(); // Clear placement mocks
             mockMapEngine.getTile.mockImplementation((x, y) => ({ // Update mock for removal check
                x, y, buildingId: multiTileBuilding.id, buildable: false, walkable: false
            }));


            const result = removeBuilding(multiTileBuilding.id);
            expect(result).toBe(true);
            expect(mockMapEngine.updateTileProperties).toHaveBeenCalledTimes(2);
            expect(mockMapEngine.updateTileProperties).toHaveBeenCalledWith(6, 6, { buildingId: null, buildable: true, walkable: true });
            expect(mockMapEngine.updateTileProperties).toHaveBeenCalledWith(7, 6, { buildingId: null, buildable: true, walkable: true });
            expect(getBuildingById(multiTileBuilding.id)).toBeNull();
        });
    });

    describe('getBuildingById', () => {
         it('should return the correct building object if ID exists', () => {
            const building = placeBuilding(8, 8, 1, 1, 'well', 'town', 10, 0, 0);
            expect(building).not.toBeNull();

            const fetchedBuilding = getBuildingById(building.id);
            expect(fetchedBuilding).toEqual(building);
        });

        it('should return null if building ID does not exist', () => {
            const fetchedBuilding = getBuildingById('non_existent_id');
            expect(fetchedBuilding).toBeNull();
        });
    });

});
 
     describe('getBuildingInteractions', () => {
         const testPlayerId = 'player_123';
         const otherOwnerId = 'npc_456';
 
         beforeEach(() => {
             // Default: Player does NOT own the building being tested unless overridden
             mockPlayerEngine.getPlayerAttribute.mockImplementation((attr) => {
                 if (attr === 'id') return testPlayerId;
                 return undefined;
             });
         });
 
         it('should return Inspect, Enter, Knock for a non-owned house', async () => {
             const testBuilding = new Building('bldg_house_1', 'house', 1, 1, 1, 1, otherOwnerId, 200, 2, 5);
             _addBuildingForTest(testBuilding);
 
             const interactions = await getBuildingInteractions(testBuilding.id, 1, 1);
 
             expect(interactions).toBeInstanceOf(Array);
             expect(interactions.length).toBe(3);
             expect(interactions[0].label).toContain('Inspect house');
             expect(interactions[1].label).toBe('Enter House');
             expect(interactions[2].label).toBe('Knock on Door');
             expect(typeof interactions[0].action).toBe('function');
             expect(typeof interactions[1].action).toBe('function');
             expect(typeof interactions[2].action).toBe('function');
         });
 
         it('should return Inspect, Enter, Rest, Manage for an owned house', async () => {
             // Override mock for this test: Player owns the building
             mockPlayerEngine.getPlayerAttribute.mockImplementation((attr) => {
                 if (attr === 'id') return testPlayerId; // Player ID
                 return undefined;
             });
             const testBuilding = new Building('bldg_house_owned', 'house', 2, 2, 1, 1, testPlayerId, 300, 3, 6); // Owner is testPlayerId
             _addBuildingForTest(testBuilding);
 
             const interactions = await getBuildingInteractions(testBuilding.id, 2, 2);
 
             expect(interactions.length).toBe(4);
             expect(interactions[0].label).toContain('Inspect house');
             expect(interactions[1].label).toBe('Enter House');
             expect(interactions[2].label).toBe('Rest');
             expect(interactions[3].label).toBe('Manage Household');
         });
 
         it('should return Inspect, Work Farm, Manage Farm for an owned farm', async () => {
             // Player owns the farm
             mockPlayerEngine.getPlayerAttribute.mockImplementation((attr) => {
                 if (attr === 'id') return testPlayerId;
                 return undefined;
             });
             const testBuilding = new Building('bldg_farm_1', 'farm', 3, 3, 2, 2, testPlayerId, 1000, 1, 2);
             _addBuildingForTest(testBuilding);
 
             const interactions = await getBuildingInteractions(testBuilding.id, 3, 3);
 
             expect(interactions.length).toBe(3);
             expect(interactions[0].label).toContain('Inspect farm');
             expect(interactions[1].label).toBe('Work Farm');
             expect(interactions[2].label).toBe('Manage Farm');
         });
 
         it('should return Inspect, Work Farm for a non-owned farm', async () => {
             // Player does NOT own the farm
             const testBuilding = new Building('bldg_farm_2', 'farm', 4, 4, 2, 2, otherOwnerId, 1200, 1, 3);
             _addBuildingForTest(testBuilding);
 
             const interactions = await getBuildingInteractions(testBuilding.id, 4, 4);
 
             expect(interactions.length).toBe(2);
             expect(interactions[0].label).toContain('Inspect farm');
             expect(interactions[1].label).toBe('Work Farm');
         });
 
         it('should return generic interactions for an unknown building type', async () => {
             const testBuilding = new Building('bldg_unknown_1', 'observatory', 5, 5, 1, 1, testPlayerId, 150, 1, 1);
             _addBuildingForTest(testBuilding);
 
             const interactions = await getBuildingInteractions(testBuilding.id, 5, 5);
 
             expect(interactions.length).toBe(2); // Inspect + Generic Enter
             expect(interactions[0].label).toContain('Inspect observatory');
             expect(interactions[1].label).toBe('Enter observatory');
         });
 
         it('should return an empty array if building ID does not exist', async () => {
             const interactions = await getBuildingInteractions('non_existent_id', 1, 1);
             expect(interactions).toBeInstanceOf(Array);
             expect(interactions.length).toBe(0);
         });
     });