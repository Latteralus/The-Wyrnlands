// tests/unit/managers/saveLoadManager.test.js
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';

// Hoist the mock variable definitions so they exist before vi.mock factory runs
const {
    mockExportDatabase,
    mockImportDatabase,
    mockInitializeDatabase,
    mockIsDbInitializedRef // Use a ref object to allow modification within tests
} = vi.hoisted(() => {
    return {
        mockExportDatabase: vi.fn(),
        mockImportDatabase: vi.fn(),
        mockInitializeDatabase: vi.fn(),
        mockIsDbInitializedRef: { value: true } // Use an object wrapper for mutable state
    };
});

// Mock database dependency
vi.mock('@/data/database.js', () => ({
    exportDatabase: mockExportDatabase,
    importDatabase: mockImportDatabase,
    initializeDatabase: mockInitializeDatabase,
    get isDbInitialized() { return mockIsDbInitializedRef.value; } // Access the ref's value
}));

// Mock FileSaver.js's saveAs function (assuming it's global)
const mockSaveAs = vi.fn();
global.saveAs = mockSaveAs;

// Mock alert (simple console log mock)
const mockAlert = vi.fn();
global.alert = mockAlert;

// Mock the global SQL object expected by saveLoadManager
global.SQL = { /* Minimal mock, doesn't need functionality for this test */ };

// Import AFTER mocks are defined
// NOTE: We import the actual functions. The mocks apply via vi.mock above.
import { saveGame, loadGameFromFile, triggerLoadGame } from '@/managers/saveLoadManager.js';

// Define mock file data at a higher scope
const mockFile = new File(['mock file content'], 'load_test.sqlite', { type: 'application/x-sqlite3' });
const mockFileData = new Uint8Array([4, 5, 6]);
const mockArrayBuffer = mockFileData.buffer;


describe('Save/Load Manager', () => {

    beforeEach(() => {
        // Reset mocks before each test
        vi.clearAllMocks(); // Clears calls, reset mock implementations below
        // Reset DB state for mocks using the ref object
        mockIsDbInitializedRef.value = true;
        mockExportDatabase.mockResolvedValue(new Uint8Array([1, 2, 3])); // Default success
        mockImportDatabase.mockResolvedValue(undefined); // Default success behavior
        mockInitializeDatabase.mockResolvedValue(undefined);
    });

    // Restore all mocks AND spies after each test
    afterEach(() => {
        vi.restoreAllMocks();
    });


    describe('saveGame', () => {
        // These tests don't use FileReader, should be fine
        it('should export the database and call saveAs on success', async () => {
            const filename = 'test_save.sqlite';
            await saveGame(filename);
            expect(mockExportDatabase).toHaveBeenCalledOnce();
            expect(mockSaveAs).toHaveBeenCalledOnce();
            const blobArg = mockSaveAs.mock.calls[0][0];
            const filenameArg = mockSaveAs.mock.calls[0][1];
            expect(blobArg).toBeInstanceOf(Blob);
            expect(blobArg.type).toBe('application/x-sqlite3');
            expect(filenameArg).toBe(filename);
            expect(mockAlert).toHaveBeenCalledWith(`Game saved as ${filename}`);
        });

        it('should use default filename if none provided', async () => {
            await saveGame();
            expect(mockSaveAs).toHaveBeenCalledOnce();
            expect(mockSaveAs.mock.calls[0][1]).toBe('wyrnlands_save.sqlite');
            expect(mockAlert).toHaveBeenCalledWith(`Game saved as wyrnlands_save.sqlite`);
        });

        it('should handle database not initialized error', async () => {
            mockIsDbInitializedRef.value = false;
            await saveGame();
            expect(mockExportDatabase).not.toHaveBeenCalled();
            expect(mockSaveAs).not.toHaveBeenCalled();
            expect(mockAlert).toHaveBeenCalledWith("Error: Database not ready. Cannot save game.");
        });

        it('should handle errors during database export', async () => {
            const exportError = new Error('Export failed');
            mockExportDatabase.mockRejectedValue(exportError);
            await saveGame();
            expect(mockExportDatabase).toHaveBeenCalledOnce();
            expect(mockSaveAs).not.toHaveBeenCalled();
            expect(mockAlert).toHaveBeenCalledWith(`Error saving game: ${exportError.message}`);
        });
    });

    describe('loadGameFromFile', () => {
        // Use mockFile, mockFileData, mockArrayBuffer defined in the outer scope

        it('should read file, import database, and alert on success', async () => {
            // Mock FileReader constructor for this test
            const mockReaderInstance = {
                onload: null,
                onerror: null,
                result: null,
                readAsArrayBuffer: vi.fn(function() {
                    // Simulate async success
                    this.result = mockArrayBuffer;
                    // Use setTimeout to ensure it's async
                    setTimeout(() => { if (this.onload) this.onload({ target: this }); }, 0);
                })
            };
            const fileReaderSpy = vi.spyOn(global, 'FileReader').mockImplementation(() => mockReaderInstance);

            // Trigger the function
            const loadPromise = loadGameFromFile(mockFile);

            // Wait for the promise chain to settle
            await expect(loadPromise).resolves.toBeUndefined();

            // Assertions
            expect(mockReaderInstance.readAsArrayBuffer).toHaveBeenCalledWith(mockFile);
            expect(mockImportDatabase).toHaveBeenCalledOnce();
            expect(mockImportDatabase).toHaveBeenCalledWith(mockFileData);
            expect(mockAlert).toHaveBeenCalledWith("Game loaded successfully!");

            fileReaderSpy.mockRestore(); // Restore constructor mock
        });


        it('should handle file read errors', async () => {
            const readError = new Error('Read failed');
             // Mock FileReader constructor for this test
             const mockReaderInstance = {
                onload: null,
                onerror: null,
                readAsArrayBuffer: vi.fn(function() {
                    // Simulate async error
                    this.error = readError;
                     // Use setTimeout to ensure it's async
                    setTimeout(() => { if (this.onerror) this.onerror({ target: this }); }, 0);
                })
            };
            const fileReaderSpy = vi.spyOn(global, 'FileReader').mockImplementation(() => mockReaderInstance);

            // Trigger the function
            const loadPromise = loadGameFromFile(mockFile);

            // Assertions
            await expect(loadPromise).rejects.toThrow(readError.message);
            expect(mockReaderInstance.readAsArrayBuffer).toHaveBeenCalledWith(mockFile);
            expect(mockImportDatabase).not.toHaveBeenCalled();
            expect(mockAlert).toHaveBeenCalledWith(`Error reading file: ${readError.message}`);

            fileReaderSpy.mockRestore(); // Restore constructor mock
        });


        it('should handle errors during database import', async () => {
            const importError = new Error('Import failed');
            mockImportDatabase.mockImplementationOnce(async () => { throw importError; });

            // Mock FileReader constructor for this test
            const mockReaderInstance = {
                onload: null,
                onerror: null,
                result: null,
                readAsArrayBuffer: vi.fn(function() {
                    // Simulate async success (to reach the import step)
                    this.result = mockArrayBuffer;
                    setTimeout(() => { if (this.onload) this.onload({ target: this }); }, 0);
                })
            };
            const fileReaderSpy = vi.spyOn(global, 'FileReader').mockImplementation(() => mockReaderInstance);


            // Trigger the function (use the top-level import)
            const loadPromise = loadGameFromFile(mockFile);

            // Assertions: Check the main promise returned by loadGameFromFile
            await expect(loadPromise).rejects.toThrow(importError.message);

            // Check call count *after* rejection is confirmed
            expect(mockReaderInstance.readAsArrayBuffer).toHaveBeenCalledWith(mockFile);
            expect(mockImportDatabase).toHaveBeenCalledTimes(1); // Should have been called exactly once
            expect(mockImportDatabase).toHaveBeenCalledWith(mockFileData);
            expect(mockAlert).toHaveBeenCalledWith(`Error loading game: ${importError.message}`);

            fileReaderSpy.mockRestore(); // Restore constructor mock
        });


         it('should initialize database if not already initialized before import', async () => {
            mockIsDbInitializedRef.value = false; // Set DB as not initialized via ref
            const originalSQL = global.SQL;
            global.SQL = undefined;

            // Mock FileReader constructor for this test
            const mockReaderInstance = {
                onload: null,
                onerror: null,
                result: null,
                readAsArrayBuffer: vi.fn(function() {
                    // Simulate async success
                    this.result = mockArrayBuffer;
                    setTimeout(() => { if (this.onload) this.onload({ target: this }); }, 0);
                })
            };
            const fileReaderSpy = vi.spyOn(global, 'FileReader').mockImplementation(() => mockReaderInstance);


            // Mock initializeDatabase to set isDbInitialized to true when called via ref
            mockInitializeDatabase.mockImplementationOnce(async () => {
                mockIsDbInitializedRef.value = true;
            });

            // Trigger the function
            const loadPromise = loadGameFromFile(mockFile);

            // Wait for the loadPromise to resolve
            await expect(loadPromise).resolves.toBeUndefined();

            // Assertions
            expect(mockReaderInstance.readAsArrayBuffer).toHaveBeenCalledWith(mockFile);
            expect(mockInitializeDatabase).toHaveBeenCalledOnce(); // Verify init was called
            expect(mockImportDatabase).toHaveBeenCalledOnce();
            expect(mockImportDatabase).toHaveBeenCalledWith(mockFileData);
            expect(mockAlert).toHaveBeenCalledWith("Game loaded successfully!");

            fileReaderSpy.mockRestore(); // Restore constructor mock
            global.SQL = originalSQL; // Restore original SQL mock
        });


         it('should handle empty file read result', async () => {
             // Mock FileReader constructor for this test
             const mockReaderInstance = {
                onload: null,
                onerror: null,
                result: null,
                readAsArrayBuffer: vi.fn(function() {
                    // Simulate async success with empty buffer
                    this.result = new ArrayBuffer(0);
                    setTimeout(() => { if (this.onload) this.onload({ target: this }); }, 0);
                })
            };
            const fileReaderSpy = vi.spyOn(global, 'FileReader').mockImplementation(() => mockReaderInstance);

            // Trigger the function
            const loadPromise = loadGameFromFile(mockFile);

            // Assertions
            await expect(loadPromise).rejects.toThrow("File read resulted in empty buffer.");
            expect(mockReaderInstance.readAsArrayBuffer).toHaveBeenCalledWith(mockFile);
            expect(mockImportDatabase).not.toHaveBeenCalled();
            expect(mockAlert).toHaveBeenCalledWith("Error loading game: File read resulted in empty buffer.");

            fileReaderSpy.mockRestore(); // Restore constructor mock
        });
    });

    // Note: Testing triggerLoadGame is complex due to DOM interactions (createElement, click).
    // jsdom provides document, so we can test this more thoroughly now.
    describe('triggerLoadGame', () => {
        // loadGameFromFile is NOT mocked here anymore, we test the real flow
        // which should call the mocked mockImportDatabase eventually.

        it('should create input, click, handle change, and resolve successfully', async () => {
            // No need to mock internal call anymore

            const mockFileInput = {
                type: '',
                accept: '',
                onchange: null,
                oncancel: null,
                click: vi.fn(),
                files: [mockFile] // Use mockFile defined above
            };
            const createElementSpy = vi.spyOn(document, 'createElement').mockReturnValue(mockFileInput);

             // Mock FileReader constructor for the *internal* call within loadGameFromFile
             const mockInternalReaderInstance = {
                onload: null,
                onerror: null,
                result: null,
                readAsArrayBuffer: vi.fn(function() {
                    // Simulate async success
                    this.result = mockArrayBuffer;
                    setTimeout(() => { if (this.onload) this.onload({ target: this }); }, 0);
                })
            };
            const fileReaderSpy = vi.spyOn(global, 'FileReader').mockImplementation(() => mockInternalReaderInstance);


             // Trigger the function (will call the actual loadGameFromFile)
            const triggerPromise = triggerLoadGame();

            // Check that createElement and click were called
            expect(createElementSpy).toHaveBeenCalledWith('input');
            expect(mockFileInput.click).toHaveBeenCalledOnce();

            // Simulate the file input change event
            expect(mockFileInput.onchange).toBeInstanceOf(Function);
            if (mockFileInput.onchange) {
                // Don't await this directly, let the promise chain run
                 mockFileInput.onchange({ target: mockFileInput });
            }

            // Check if the main triggerPromise resolves
            await expect(triggerPromise).resolves.toBeUndefined();

            // Verify the final DB mock was hit
            expect(mockImportDatabase).toHaveBeenCalledOnce();

            // No explicit restore needed here due to afterEach
        });


         it('should reject if no file is selected and not call loadGameFromFile', async () => {
             // No need to mock internal call

            const mockFileInput = {
                type: '',
                accept: '',
                onchange: null,
                oncancel: null,
                click: vi.fn(),
                files: [] // Simulate NO selected file
            };
            const createElementSpy = vi.spyOn(document, 'createElement').mockReturnValue(mockFileInput);

            const triggerPromise = triggerLoadGame();

            expect(createElementSpy).toHaveBeenCalledWith('input');
            expect(mockFileInput.click).toHaveBeenCalledOnce();

            // Simulate the file input change event
            expect(mockFileInput.onchange).toBeInstanceOf(Function);
            if (mockFileInput.onchange) {
                 // Don't await here, let the rejection propagate
                 mockFileInput.onchange({ target: mockFileInput });
            }

            await expect(triggerPromise).rejects.toThrow("No file selected.");
            expect(mockImportDatabase).not.toHaveBeenCalled(); // DB import shouldn't happen

            // No explicit restore needed here due to afterEach
        });
    }); // Closing bracket for describe('triggerLoadGame')

}); // Closing bracket for describe('Save/Load Manager')