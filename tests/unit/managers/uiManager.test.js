import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock buildingEngine dependency for handleBuildingInteraction
const { mockBuildingEngine } = vi.hoisted(() => ({
    mockBuildingEngine: { getBuildingInteractions: vi.fn() }
}));
vi.mock('@/engines/buildingEngine.js', () => mockBuildingEngine); // Adjust path if needed

import {
    initializeUIManager,
    updateStatusBar,
    updateTimeDisplay,
    updateSelectedTileInfo,
    handleBuildingInteraction,
    showInteractionMenu, // Import for direct testing
    hideInteractionMenu // Import for direct testing
} from '@/managers/uiManager.js'; // Use path alias for consistency

// Define the IDs used in uiManager
const UI_ELEMENTS_IDS = {
    hungerBar: 'hunger-bar-fill',
    thirstBar: 'thirst-bar-fill',
    timeDisplay: 'time-display',
    selectedTileInfo: 'selected-tile-info',
    interactionMenu: 'interaction-menu', // Add ID for interaction menu
};

describe('uiManager', () => {

    beforeEach(() => {
        // Set up mock HTML structure before each test
        document.body.innerHTML = `
            <div>
                <div id="${UI_ELEMENTS_IDS.hungerBar}"></div>
            </div>
            <div>
                <div id="${UI_ELEMENTS_IDS.thirstBar}"></div>
            </div>
            <div id="${UI_ELEMENTS_IDS.timeDisplay}"></div>
            <div id="${UI_ELEMENTS_IDS.selectedTileInfo}"></div>
            <div id="${UI_ELEMENTS_IDS.interactionMenu}"></div> <!-- Add interaction menu container -->
        `;
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {}); // Add spy for console.error
    });

    afterEach(() => {
        // Clean up mock HTML and spies
        document.body.innerHTML = '';
        vi.restoreAllMocks();
    });

    it('initializeUIManager should log initialization', () => {
        initializeUIManager();
        expect(console.log).toHaveBeenCalledWith('UI Manager Initialized');
    });

    describe('updateStatusBar', () => {
        it('should update the width style of the correct element', () => {
            updateStatusBar('hunger', 50, 100);
            const element = document.getElementById(UI_ELEMENTS_IDS.hungerBar);
            expect(element.style.width).toBe('50%');

            updateStatusBar('thirst', 25, 50);
            const thirstElement = document.getElementById(UI_ELEMENTS_IDS.thirstBar);
            expect(thirstElement.style.width).toBe('50%'); // 25/50 = 50%
        });

        it('should clamp width between 0% and 100%', () => {
            updateStatusBar('hunger', 150, 100);
            const element = document.getElementById(UI_ELEMENTS_IDS.hungerBar);
            expect(element.style.width).toBe('100%');

            updateStatusBar('thirst', -10, 100);
            const thirstElement = document.getElementById(UI_ELEMENTS_IDS.thirstBar);
            expect(thirstElement.style.width).toBe('0%');
        });

        it('should set width to 0% if maxValue is 0', () => {
            updateStatusBar('hunger', 50, 0);
            const element = document.getElementById(UI_ELEMENTS_IDS.hungerBar);
            expect(element.style.width).toBe('0%');
        });

        it('should warn if element ID is not found', () => {
            document.getElementById(UI_ELEMENTS_IDS.hungerBar).remove(); // Remove the element
            updateStatusBar('hunger', 50, 100);
            expect(console.warn).toHaveBeenCalledWith(`UI Manager: Element with ID "${UI_ELEMENTS_IDS.hungerBar}" not found for status bar.`);
        });

        it('should warn if barType is invalid', () => {
            updateStatusBar('mana', 50, 100); // Invalid type
             expect(console.warn).toHaveBeenCalledWith(`UI Manager: No element ID defined for status bar type "mana"`);
        });
    });

    describe('updateTimeDisplay', () => {
        it('should update the textContent of the time display element', () => {
            const timeString = 'Day 5, 14:30:15';
            updateTimeDisplay(timeString);
            const element = document.getElementById(UI_ELEMENTS_IDS.timeDisplay);
            expect(element.textContent).toBe(timeString);
        });

        it('should warn if time display element is not found', () => {
            document.getElementById(UI_ELEMENTS_IDS.timeDisplay).remove();
            updateTimeDisplay('Day 1, 00:00:00');
            expect(console.warn).toHaveBeenCalledWith(`UI Manager: Element with ID "${UI_ELEMENTS_IDS.timeDisplay}" not found for time display.`);
        });
    });

    describe('updateSelectedTileInfo', () => {
        it('should update textContent with formatted tile data', () => {
            const tileData = { x: 10, y: 20, type: 'Grass' };
            updateSelectedTileInfo(tileData);
            const element = document.getElementById(UI_ELEMENTS_IDS.selectedTileInfo);
            expect(element.textContent).toBe('Selected: (10, 20) Type: Grass'); // Matches basic example format
        });

        it('should update textContent to "None" if tileData is null', () => {
            updateSelectedTileInfo(null);
            const element = document.getElementById(UI_ELEMENTS_IDS.selectedTileInfo);
            expect(element.textContent).toBe('Selected: None');
        });

        it('should warn if selected tile info element is not found', () => {
            document.getElementById(UI_ELEMENTS_IDS.selectedTileInfo).remove();
            updateSelectedTileInfo({ x: 1, y: 1, type: 'Water' });
            expect(console.warn).toHaveBeenCalledWith(`UI Manager: Element with ID "${UI_ELEMENTS_IDS.selectedTileInfo}" not found for tile info display.`);
        });
    });

    // --- Interaction Menu Display Tests ---
    describe('showInteractionMenu / hideInteractionMenu', () => {
        let menuElement;
        const mockInteractions = [
            { label: 'Action 1', action: vi.fn() },
            { label: 'Action 2', action: vi.fn() }
        ];

        beforeEach(() => {
            menuElement = document.getElementById(UI_ELEMENTS_IDS.interactionMenu);
            // Ensure menu is hidden initially
            menuElement.style.display = 'none';
            menuElement.innerHTML = '';
        });

        it('showInteractionMenu should make menu visible and create buttons', () => {
            showInteractionMenu(mockInteractions, 5, 5);

            expect(menuElement.style.display).toBe('block');
            const buttons = menuElement.querySelectorAll('button');
            // Expect buttons for each interaction + 1 close button
            expect(buttons.length).toBe(mockInteractions.length + 1);
            expect(buttons[0].textContent).toBe(mockInteractions[0].label);
            expect(buttons[1].textContent).toBe(mockInteractions[1].label);
            expect(buttons[2].textContent).toBe('Close'); // Last button is Close
        });

        it('clicking an interaction button should call its action and hide the menu', () => {
            showInteractionMenu(mockInteractions, 5, 5);
            const buttons = menuElement.querySelectorAll('button');
            const actionButton = buttons[0]; // Click the first action button

            // Simulate click
            actionButton.click();

            // Verify action was called
            expect(mockInteractions[0].action).toHaveBeenCalledOnce();
            // Verify menu is hidden (hideInteractionMenu was called)
            expect(menuElement.style.display).toBe('none');
            expect(menuElement.innerHTML).toBe(''); // Content should be cleared by hide
        });

        it('clicking the close button should hide the menu', () => {
            showInteractionMenu(mockInteractions, 5, 5);
            const buttons = menuElement.querySelectorAll('button');
            const closeButton = buttons[buttons.length - 1]; // Last button is Close

            // Simulate click
            closeButton.click();

            // Verify menu is hidden
            expect(menuElement.style.display).toBe('none');
            expect(menuElement.innerHTML).toBe('');
            // Verify actions were NOT called
            expect(mockInteractions[0].action).not.toHaveBeenCalled();
            expect(mockInteractions[1].action).not.toHaveBeenCalled();
        });

        it('hideInteractionMenu should hide the menu and clear content', () => {
            // Make it visible first
            menuElement.style.display = 'block';
            menuElement.innerHTML = '<button>Test</button>';

            hideInteractionMenu();

            expect(menuElement.style.display).toBe('none');
            expect(menuElement.innerHTML).toBe('');
        });

         it('showInteractionMenu should warn if menu element is not found', () => {
            menuElement.remove(); // Remove the element
            showInteractionMenu(mockInteractions, 1, 1);
            expect(console.error).toHaveBeenCalledWith(`UI Manager: Interaction menu element with ID "${UI_ELEMENTS_IDS.interactionMenu}" not found.`);
        });
    });

    // --- Interaction Tests ---
    describe('handleBuildingInteraction', () => {
        it('should call getBuildingInteractions and showInteractionMenu', async () => {
            const buildingId = 'bldg_1';
            const tileX = 10;
            const tileY = 15;
            const mockInteractions = [{ label: 'Test', action: vi.fn() }];
            // Mock getBuildingInteractions to return some actions
            mockBuildingEngine.getBuildingInteractions.mockResolvedValue(mockInteractions);
            // Spy on showInteractionMenu (it's internal to the module, so we can't directly mock/spy easily without refactor)
            // Instead, we'll check the console log from showInteractionMenu

            await handleBuildingInteraction(buildingId, tileX, tileY);

            expect(mockBuildingEngine.getBuildingInteractions).toHaveBeenCalledWith(buildingId, tileX, tileY);
            // Check console log as a proxy for showInteractionMenu being called
            expect(console.log).toHaveBeenCalledWith(
                expect.stringContaining('Showing interaction menu'),
                expect.arrayContaining([mockInteractions[0].label])
            );
        });

        it('should log if no interactions are available', async () => {
            const buildingId = 'bldg_2';
            const tileX = 5;
            const tileY = 5;
            // Mock getBuildingInteractions to return empty array
            mockBuildingEngine.getBuildingInteractions.mockResolvedValue([]);

            await handleBuildingInteraction(buildingId, tileX, tileY);

            expect(mockBuildingEngine.getBuildingInteractions).toHaveBeenCalledWith(buildingId, tileX, tileY);
            expect(console.log).toHaveBeenCalledWith(`No interactions available for building ${buildingId}.`);
            expect(console.log).not.toHaveBeenCalledWith(expect.stringContaining('Showing interaction menu'));
        });
    });
});