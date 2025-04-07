// tests/unit/engines/npcEngine.test.js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// --- Mock Dependencies ---
vi.mock('../../../src/data/database.js', () => ({
    run: vi.fn(),
    get: vi.fn(),
    all: vi.fn(),
}));
vi.mock('../../../src/data/titlesData.js', () => ({
    getTitleDefinition: vi.fn(id => ({ id: id, name: `${id.charAt(0).toUpperCase() + id.slice(1)} Title` })), // Mock title definitions
}));
vi.mock('../../../src/engines/survivalEngine.js', () => ({
    applySurvivalEffects: vi.fn(),
}));
vi.mock('../../../src/engines/movementEngine.js', () => ({
    moveNpcTo: vi.fn(),
}));
vi.mock('../../../src/engines/jobEngine.js', () => ({
    processWorkShift: vi.fn(),
}));
// DO NOT mock the module under test itself (npcEngine)
// We will spy on specific functions if needed within tests.
// Mock skillEngine if needed for skill saving in createNPC later
// vi.mock('../../../src/engines/skillEngine.js');

// --- Import Module Under Test & Mocks ---
import * as NpcEngine from '../../../src/engines/npcEngine.js';
import { run, get, all } from '../../../src/data/database.js'; // DB mocks
import { getTitleDefinition } from '../../../src/data/titlesData.js'; // titlesData mock
import { applySurvivalEffects } from '../../../src/engines/survivalEngine.js'; // survivalEngine mock
import { moveNpcTo } from '../../../src/engines/movementEngine.js'; // movementEngine mock
import { processWorkShift } from '../../../src/engines/jobEngine.js'; // jobEngine mock

// Helper to reset internal state for tests
function resetNpcEngineState() {
     NpcEngine._resetStateForTest?.(); // Use internal reset if exposed
     // Or manually reset if not exposed (less ideal)
     // NpcEngine.activeNpcs = {};
     // NpcEngine.isInitialized = false;
}

// Expose internal state for testing (add this to npcEngine.js if needed)
/*
function _resetStateForTest() {
    activeNpcs = {};
    isInitialized = false;
}
export { ..., _resetStateForTest };
*/
// For now, assume we can access/reset state or mock appropriately.

describe('NPC Engine', () => {
    const mockNpcData = [
        { npc_id: 1, name: 'Alice', age: 30, household_id: 1, current_tile_x: 10, current_tile_y: 10, current_activity: 'Idle', schedule: JSON.stringify({ workStartHour: 8, workEndHour: 17, workLocation: { x: 15, y: 15 }, homeLocation: { x: 10, y: 10 } }), hunger: 90, thirst: 80, health: 100, title_id: 'citizen' },
        { npc_id: 2, name: 'Bob', age: 45, household_id: 2, current_tile_x: 20, current_tile_y: 20, current_activity: 'Working', schedule: JSON.stringify({ workStartHour: 9, workEndHour: 18, workLocation: { x: 20, y: 20 }, homeLocation: { x: 5, y: 5 } }), hunger: 70, thirst: 60, health: 95, title_id: 'freeman' },
    ];

    beforeEach(() => {
        vi.clearAllMocks();
        // Reset internal state if possible, otherwise tests might interfere
        // resetNpcEngineState();
        // Mock DB load for initialization
        all.mockResolvedValue(mockNpcData);
        // Mock successful DB writes by default
        run.mockResolvedValue({ changes: 1, lastID: 3 }); // Assume next ID is 3
    });

    describe('initializeNPCEngine', () => {
        it('should load NPCs from database and set initialized flag', async () => {
            await NpcEngine.initializeNPCEngine();
            expect(all).toHaveBeenCalledWith('SELECT * FROM NPCs');
            const npc1State = NpcEngine.getNpcState(1);
            const npc2State = NpcEngine.getNpcState(2);
            expect(npc1State).toBeDefined();
            expect(npc2State).toBeDefined();
            expect(npc1State?.name).toBe('Alice');
            expect(npc2State?.name).toBe('Bob');
            expect(npc1State?.currentState).toBe('Idle');
            expect(npc2State?.currentState).toBe('Working');
            expect(npc1State?.schedule?.workStartHour).toBe(8);
            expect(npc2State?.schedule?.homeLocation?.x).toBe(5);
            // Cannot easily test isInitialized without exposing it
        });

        it('should handle database error during initialization', async () => {
            all.mockRejectedValue(new Error('DB Load Fail'));
            const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            await NpcEngine.initializeNPCEngine();
            expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Error initializing NPC Engine'), expect.any(Error));
            // isInitialized should be false (cannot test directly)
            expect(NpcEngine.getNpcState(1)).toBeNull(); // Should return null if not initialized
            errorSpy.mockRestore();
        });
    });

    describe('createNPC', () => {
        const newNpcDetails = { name: 'Charlie', age: 22, householdId: 1, x: 5, y: 5, title_id: 'commoner' };

        it('should insert NPC into database and add to activeNpcs', async () => {
            await NpcEngine.initializeNPCEngine(); // Initialize first
            const newId = await NpcEngine.createNPC(newNpcDetails);

            expect(run).toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO NPCs'),
                [ 'Charlie', 22, 1, 5, 5, 'commoner', 100.0, 100.0, 100.0, 'idle' ] // Matched order and defaults
            );
            expect(newId).toBe(3); // From mock run lastID
            const newState = NpcEngine.getNpcState(3);
            expect(newState).toBeDefined();
            expect(newState?.name).toBe('Charlie');
            expect(newState?.age).toBe(22);
            expect(newState?.title_id).toBe('commoner');
            expect(newState?.hunger).toBe(100.0); // Check defaults
        });

        it('should return null if DB insert fails', async () => {
            await NpcEngine.initializeNPCEngine();
            run.mockResolvedValue({ changes: 0 }); // Simulate insert failure (no lastID)
            const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            const newId = await NpcEngine.createNPC(newNpcDetails);
            expect(newId).toBeNull();
            expect(NpcEngine.getNpcState(3)).toBeNull(); // Should not be added to memory
            expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Error creating NPC'), expect.any(Error));
            errorSpy.mockRestore();
        });

        // TODO: Add test for saving initial skills once implemented
    });

    describe('getNpcState / getNpcAttribute', () => {
        it('should return state or attribute for active NPC', async () => {
            await NpcEngine.initializeNPCEngine();
            expect(NpcEngine.getNpcState(1)).toBeDefined();
            expect(NpcEngine.getNpcAttribute(1, 'name')).toBe('Alice');
            expect(NpcEngine.getNpcAttribute(2, 'age')).toBe(45);
        });

        it('should return null/undefined for inactive/unknown NPC', async () => {
            await NpcEngine.initializeNPCEngine();
            expect(NpcEngine.getNpcState(99)).toBeNull();
            expect(NpcEngine.getNpcAttribute(99, 'name')).toBeUndefined();
        });

         it('should return null/undefined if not initialized', () => {
            NpcEngine._resetStateForTest(); // Ensure state is reset
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            expect(NpcEngine.getNpcState(1)).toBeNull();
            expect(NpcEngine.getNpcAttribute(1, 'name')).toBeUndefined();
            // Check warn message was called (it should be called by both functions)
            expect(warnSpy).toHaveBeenCalledWith("NPC Engine not initialized.");
            warnSpy.mockRestore();
         });
    });

    describe('updateNpcAttributes', () => {
        it('should update attributes in memory and database', async () => {
            await NpcEngine.initializeNPCEngine();
            const updates = { hunger: 50.5, currentState: 'Eating', x: 11 };
            run.mockResolvedValue({ changes: 1 }); // Mock successful DB update

            const success = await NpcEngine.updateNpcAttributes(1, updates);

            expect(success).toBe(true);
            const npcState = NpcEngine.getNpcState(1);
            expect(npcState?.hunger).toBe(50.5);
            expect(npcState?.currentState).toBe('Eating');
            expect(npcState?.x).toBe(11);
            expect(run).toHaveBeenCalledWith(
                expect.stringContaining('UPDATE NPCs SET hunger = ?, current_activity = ?, current_tile_x = ?'),
                [50.5, 'Eating', 11, 1] // Value1, Value2, Value3, ID
            );
        });

        it('should handle schedule update (stringify)', async () => {
             await NpcEngine.initializeNPCEngine();
             const newSchedule = { workStartHour: 10, workEndHour: 19 };
             run.mockResolvedValue({ changes: 1 });
             const success = await NpcEngine.updateNpcAttributes(1, { schedule: newSchedule });
             expect(success).toBe(true);
             expect(NpcEngine.getNpcState(1)?.schedule).toEqual(newSchedule); // Check in-memory object
             expect(run).toHaveBeenCalledWith(
                 expect.stringContaining('UPDATE NPCs SET schedule = ?'),
                 [JSON.stringify(newSchedule), 1] // Check stringified value sent to DB
             );
        });

        it('should return false and revert memory if DB update fails', async () => {
            await NpcEngine.initializeNPCEngine();
            const originalState = { ...NpcEngine.getNpcState(1) }; // Copy original state
            run.mockResolvedValue({ changes: 0 }); // Simulate DB update failure
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

            const success = await NpcEngine.updateNpcAttributes(1, { hunger: 10 });

            expect(success).toBe(false);
            expect(NpcEngine.getNpcState(1)?.hunger).toBe(originalState.hunger); // Check if reverted
            expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Reverted in-memory NPC update'));
            warnSpy.mockRestore();
        });

        it('should return false if NPC not found', async () => {
             await NpcEngine.initializeNPCEngine();
             const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
             const success = await NpcEngine.updateNpcAttributes(99, { hunger: 10 });
             expect(success).toBe(false);
             expect(run).not.toHaveBeenCalled();
             expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Cannot update attributes for non-existent'));
             warnSpy.mockRestore();
        });
    });

    describe('setNpcState', () => {
         it('should call updateNpcAttributes with currentState', async () => {
             await NpcEngine.initializeNPCEngine();
             run.mockResolvedValue({ changes: 1 });
             run.mockClear(); // Clear previous calls
             run.mockResolvedValue({ changes: 1 }); // Mock DB success

             const success = await NpcEngine.setNpcState(1, NpcEngine.NPC_STATES.SLEEPING);

             expect(success).toBe(true);
             // Check that the DB was updated correctly via run
             expect(run).toHaveBeenCalledWith(
                 expect.stringContaining("UPDATE NPCs SET current_activity = ?"),
                 [NpcEngine.NPC_STATES.SLEEPING, 1]
             );
             // No need to spy on updateNpcAttributes anymore
          });
    });

    describe('getNpcTitleDetails', () => {
        it('should return title details for a valid NPC', async () => {
            await NpcEngine.initializeNPCEngine(); // Loads NPC 1 with title_id 'citizen'
            const details = await NpcEngine.getNpcTitleDetails(1);
            // Check mock response from titlesData mock
            expect(getTitleDefinition).toHaveBeenCalledWith('citizen');
            expect(details).toEqual({ id: 'citizen', name: 'Citizen Title' });
        });

        it('should return undefined if NPC or title_id not found', async () => {
             await NpcEngine.initializeNPCEngine();
             const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
             const details = await NpcEngine.getNpcTitleDetails(99); // Unknown NPC
             expect(details).toBeUndefined();
             expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Could not find title_id attribute'));
             warnSpy.mockRestore();
        });
    });

    describe('getActiveNpcIds', () => {
        it('should return IDs of loaded NPCs', async () => {
            await NpcEngine.initializeNPCEngine();
            const ids = NpcEngine.getActiveNpcIds();
            expect(ids).toEqual([1, 2]);
        });
         it('should return empty array if not initialized', () => {
            NpcEngine._resetStateForTest(); // Reset state for this specific test
            expect(NpcEngine.getActiveNpcIds()).toEqual([]);
         });
    });

    describe('processNpcTick', () => {
        const mockTime = { hour: 10, timeString: 'Day 1, 10:00:00' }; // Work time for NPC 1
        const mockSleepTime = { hour: 23, timeString: 'Day 1, 23:00:00' };
        const mockEngines = {}; // Pass empty objects if not used yet
        const mockUtils = {};

        beforeEach(async () => {
            // Ensure engine is initialized with mock data
            all.mockResolvedValue(mockNpcData);
            await NpcEngine.initializeNPCEngine();
            // Mock survival outcome (no death, needs changed)
            applySurvivalEffects.mockReturnValue({ needsChanged: true, healthChanged: false, healthDamage: 0, isDead: false });
            // Mock successful DB updates
            run.mockResolvedValue({ changes: 1 });
        });

        it('should apply survival effects and persist changes', async () => {
            const npcState = NpcEngine.getNpcState(1);
            run.mockClear(); // Clear previous calls
            run.mockResolvedValue({ changes: 1 }); // Mock success

            await NpcEngine.processNpcTick(mockEngines, mockUtils, 1, mockTime);

            expect(applySurvivalEffects).toHaveBeenCalledWith(npcState);
            // Check if run was called to persist survival changes
            expect(run).toHaveBeenCalledWith(
                expect.stringContaining("UPDATE NPCs SET hunger = ?, thirst = ?"),
                expect.arrayContaining([expect.any(Number), expect.any(Number), 1])
            );
        });

        it('should handle NPC death outcome from survival effects', async () => {
            applySurvivalEffects.mockReturnValue({ needsChanged: false, healthChanged: true, healthDamage: 10, isDead: true });
            run.mockClear();
            run.mockResolvedValue({ changes: 1 }); // Mock success for health update
            const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

            await NpcEngine.processNpcTick(mockEngines, mockUtils, 1, mockTime);

            expect(applySurvivalEffects).toHaveBeenCalled();
            // Check if run was called to persist the health change
            expect(run).toHaveBeenCalledWith(
                 expect.stringContaining("UPDATE NPCs SET health = ?"),
                 expect.arrayContaining([expect.any(Number), 1])
            );
            // Check if NPC was removed from active list
            expect(NpcEngine.getNpcState(1)).toBeNull();
            // TODO: Check if DB delete/update was called for death (once implemented)
            logSpy.mockRestore();
        });

        it('should set state to WORKING during work hours if at work location', async () => {
            // Mock NPC 2 who starts at their work location (20, 20)
            const npcState = NpcEngine.getNpcState(2);
            npcState.currentState = 'Idle'; // Start as Idle
            // No need to spy on setNpcState, check run mock instead
            // const workSpy = vi.spyOn(NpcEngine, 'processWorkShift'); // Incorrect spy target
            run.mockClear();
            run.mockResolvedValue({ changes: 1 });

            await NpcEngine.processNpcTick(mockEngines, mockUtils, 2, { hour: 10 }); // Work time for NPC 2 (9-18)

            // Check that state was updated to WORKING via run
            expect(run).toHaveBeenCalledWith(
                expect.stringContaining("UPDATE NPCs SET current_activity = ?, targetX = ?, targetY = ?"),
                [NpcEngine.NPC_STATES.WORKING, null, null, 2] // State WORKING, target cleared, NPC ID
            );

            // Check if processWorkShift (the imported mock) was called
            // This happens *after* the state check in the same tick
            expect(processWorkShift).toHaveBeenCalledWith('NPC', 2);
        });

         it('should set state to TRAVELING to work during work hours if not at work location', async () => {
            // Use NPC 1 who starts at home (10, 10), work is (15, 15)
            const npcState = NpcEngine.getNpcState(1);
            npcState.currentState = 'Idle';
            run.mockClear();
            run.mockResolvedValue({ changes: 1 });

            await NpcEngine.processNpcTick(mockEngines, mockUtils, 1, { hour: 10 });

            // Expect run to be called twice: 1 for survival persistence, 1 for state/target update
            expect(run).toHaveBeenCalledTimes(2);
            // Check the state/target update call specifically (it will be the second call)
            expect(run).toHaveBeenNthCalledWith(2,
                expect.stringContaining("UPDATE NPCs SET current_activity = ?, targetX = ?, targetY = ?"),
                [NpcEngine.NPC_STATES.TRAVELING, 15, 15, 1]
            );
         });

         it('should set state to SLEEPING during sleep hours if at home location', async () => {
             // Use NPC 1 who starts at home (10, 10)
             const npcState = NpcEngine.getNpcState(1); // Get state to confirm preconditions
             expect(npcState.x).toBe(10); // Should be at home
             expect(npcState.y).toBe(10);
             npcState.currentState = 'Idle'; // Ensure starting state is Idle
             run.mockClear();
             run.mockResolvedValue({ changes: 1 });
 
             await NpcEngine.processNpcTick(mockEngines, mockUtils, 1, { hour: 23 }); // Sleep time
 
             // Expect run to be called twice: 1 for survival persistence, 1 for state/target update
             expect(run).toHaveBeenCalledTimes(2);
             // Check the state/target update call specifically (it will be the second call)
             expect(run).toHaveBeenNthCalledWith(2,
                 expect.stringContaining("UPDATE NPCs SET current_activity = ?, targetX = ?, targetY = ?"), // Update includes clearing target
                 [NpcEngine.NPC_STATES.SLEEPING, null, null, 1] // New state, cleared targetX, cleared targetY, NPC ID
             );
         });
 

         it('should set state to TRAVELING home during sleep hours if not at home', async () => {
             // Use NPC 2 who starts at work (20, 20), home is (5, 5)
             const npcState = NpcEngine.getNpcState(2); // Get state to confirm preconditions
             expect(npcState.x).toBe(20); // Should be at work
             expect(npcState.y).toBe(20);
             npcState.currentState = 'Working'; // Ensure starting state
             run.mockClear(); // Clear previous DB calls
 
             await NpcEngine.processNpcTick(mockEngines, mockUtils, 2, { hour: 23 }); // Sleep time
 
             // Expect updateNpcAttributes to be called to change state and set target
             expect(run).toHaveBeenCalledWith(
                 expect.stringContaining("UPDATE NPCs SET current_activity = ?, targetX = ?, targetY = ?"), // Check SQL update
                 [NpcEngine.NPC_STATES.TRAVELING, 5, 5, 2] // New state, targetX, targetY, NPC ID
             );
         });

         it('should call moveNpcTo if state is TRAVELING and target exists', async () => {
             // Set NPC 1 state to Traveling towards work
             const npcState = NpcEngine.getNpcState(1);
             npcState.currentState = NpcEngine.NPC_STATES.TRAVELING;
             npcState.targetX = 15;
             npcState.targetY = 15;
             moveNpcTo.mockResolvedValue(true); // Simulate successful move step

             await NpcEngine.processNpcTick(mockEngines, mockUtils, 1, { hour: 10 }); // During travel time

             expect(moveNpcTo).toHaveBeenCalledWith(1, 15, 15);
         });

         it('should change state to IDLE after arriving at target', async () => {
             // Set NPC 1 state to Traveling towards work
             const npcState = NpcEngine.getNpcState(1);
             npcState.currentState = NpcEngine.NPC_STATES.TRAVELING;
             npcState.targetX = 15;
             npcState.targetY = 15;

             // Mock moveNpcTo to simulate arrival by updating state *before* returning
             moveNpcTo.mockImplementation(async (id, x, y) => {
                 if (id === 1) {
                     // Simulate the position update that moveNpcTo would persist
                     npcState.x = x;
                     npcState.y = y;
                 }
                 return true; // Indicate move happened
             });
             run.mockClear();
             // Mock the DB updates that processNpcTick will trigger *after* arrival
             run.mockResolvedValue({ changes: 1 });

             await NpcEngine.processNpcTick(mockEngines, mockUtils, 1, { hour: 10 });

             expect(moveNpcTo).toHaveBeenCalledWith(1, 15, 15);

             // Check the DB calls triggered by processNpcTick *after* moveNpcTo returns
             // 1. State update to IDLE (via setNpcState -> updateNpcAttributes -> run)
             expect(run).toHaveBeenCalledWith(
                 expect.stringContaining("UPDATE NPCs SET current_activity = ?"), // SQL for setNpcState
                 [NpcEngine.NPC_STATES.IDLE, 1]
             );
             // 2. Target clear update (via updateNpcAttributes -> run)
             expect(run).toHaveBeenCalledWith(
                 expect.stringContaining("UPDATE NPCs SET targetX = ?, targetY = ?"), // SQL for clearing target
                 [null, null, 1]
             );
             // Ensure run was called exactly 3 times: survival + state change + target clear
             expect(run).toHaveBeenCalledTimes(3);
         });

    });

});