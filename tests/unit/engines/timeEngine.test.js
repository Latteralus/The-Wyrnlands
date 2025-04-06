import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    initializeTimeEngine,
    advanceTime,
    // tick, // tick is internal, tested via interval
    startTicking,
    stopTicking,
    pause,
    resume,
    setTimeScale,
    startSleep,
    stopSleep,
    getCurrentTime,
    isPaused,
    isSleeping
} from '../../../src/engines/timeEngine';

// Constants from the module (consider exporting them for testing if needed)
const GAME_SECONDS_PER_REAL_SECOND = 60;

describe('timeEngine', () => {
    let mockTickCallback;

    beforeEach(() => {
        vi.useFakeTimers(); // Use fake timers for setInterval/clearInterval
        mockTickCallback = vi.fn();
        // Initialize with the mock callback, this also resets internal state
        vi.spyOn(console, 'log').mockImplementation(() => {}); // Setup spy BEFORE calling initialize
        initializeTimeEngine(mockTickCallback);
        // Stop any automatically started ticker from initialize
        stopTicking();
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        stopTicking(); // Ensure timers are cleared after each test
        vi.restoreAllMocks(); // Restore console spies
        vi.useRealTimers(); // Restore real timers
    });

    it('should initialize with default time and state', () => {
        // initializeTimeEngine is called in beforeEach
        const time = getCurrentTime();
        expect(time.day).toBe(1);
        expect(time.hour).toBe(7);
        expect(time.minute).toBe(0);
        expect(time.second).toBe(0);
        expect(isPaused).toBe(false); // Access as variable
        expect(isSleeping).toBe(false); // Access as variable
        expect(console.log).toHaveBeenCalledWith('Time Engine Initialized');
    });

    it('advanceTime should correctly increment seconds, minutes, hours, days', () => {
        advanceTime(30); // +30 seconds
        expect(getCurrentTime().second).toBe(30);
        advanceTime(45); // +45 seconds (total 75s = 1m 15s)
        expect(getCurrentTime().minute).toBe(1);
        expect(getCurrentTime().second).toBe(15);
        advanceTime(60 * 60); // +1 hour (total 1h 1m 15s)
        expect(getCurrentTime().hour).toBe(8);
        expect(getCurrentTime().minute).toBe(1);
        expect(getCurrentTime().second).toBe(15);
        advanceTime(20 * 60 * 60); // +20 hours (total 28h 1m 15s = 1d 4h 1m 15s)
        expect(getCurrentTime().day).toBe(2);
        expect(getCurrentTime().hour).toBe(4);
    });

    it('tick interval should call advanceTime and the callback', () => {
        startTicking();
        const intervalMs = 250; // Internal interval used in startTicking
        const expectedGameSeconds = (intervalMs / 1000) * GAME_SECONDS_PER_REAL_SECOND * 1; // timeScale = 1

        vi.advanceTimersByTime(intervalMs); // Advance time by one interval

        expect(mockTickCallback).toHaveBeenCalledTimes(1);
        const currentTime = getCurrentTime();
        // Check if time advanced roughly correctly (floating point issues possible)
        expect(currentTime.second).toBeCloseTo(expectedGameSeconds % 60);

        vi.advanceTimersByTime(intervalMs * 3); // Advance by 3 more intervals
        expect(mockTickCallback).toHaveBeenCalledTimes(4);
    });

    it('pause should stop time advancement via tick', () => {
        startTicking();
        vi.advanceTimersByTime(250);
        const timeBeforePause = getCurrentTime();
        expect(mockTickCallback).toHaveBeenCalledTimes(1);

        pause();
        expect(isPaused).toBe(true); // Access as variable
        vi.advanceTimersByTime(1000); // Advance timers, but time shouldn't progress

        expect(getCurrentTime()).toEqual(timeBeforePause); // Time should not have changed
        expect(mockTickCallback).toHaveBeenCalledTimes(1); // Callback shouldn't be called again
    });

    it('resume should restart time advancement via tick', () => {
        startTicking();
        pause();
        vi.advanceTimersByTime(1000); // Time doesn't advance
        expect(mockTickCallback).toHaveBeenCalledTimes(0); // Assuming pause before first tick

        resume();
        expect(isPaused).toBe(false); // Access as variable
        vi.advanceTimersByTime(250); // Advance by one interval

        expect(mockTickCallback).toHaveBeenCalledTimes(1); // Callback should now be called
        expect(getCurrentTime().second).toBeGreaterThan(0);
    });

    it('setTimeScale should change the rate of time advancement', () => {
        setTimeScale(4);
        startTicking();
        const intervalMs = 250;
        const expectedGameSeconds = (intervalMs / 1000) * GAME_SECONDS_PER_REAL_SECOND * 4; // 4x speed

        vi.advanceTimersByTime(intervalMs);

        expect(mockTickCallback).toHaveBeenCalledTimes(1);
        expect(getCurrentTime().second).toBeCloseTo(expectedGameSeconds % 60);

        // Test invalid scale
        setTimeScale(3);
        expect(console.warn).toHaveBeenCalledWith('Invalid time scale: 3. Must be 1, 2, or 4.');
    });

    it('startSleep should set sleeping state and increase time scale', () => {
        startSleep();
        expect(isSleeping).toBe(true); // Access as variable
        expect(isPaused).toBe(false); // Access as variable
        // Check if timescale was increased significantly (implementation detail, but testable)
        // This requires accessing the internal timeScale, which isn't exported.
        // We can test the *effect* in the next test.
        expect(console.log).toHaveBeenCalledWith('Sleep started. Fast-forwarding time...');
    });

    it('advanceTime should stop sleep at 7:00 AM', () => {
        // Set time to just before midnight
        initializeTimeEngine(mockTickCallback); // Reset time to 7:00 Day 1
        advanceTime(16 * 60 * 60); // Advance 16 hours to 23:00 Day 1
        expect(getCurrentTime().hour).toBe(23);

        startSleep(); // Sets high timescale
        expect(isSleeping).toBe(true); // Access as variable

        // Simulate enough time passing to go past 7 AM the next day
        // Need to calculate how many *real* seconds correspond to ~8 hours game time at high speed
        // Let's advance directly instead of relying on tick simulation for simplicity here
        const secondsTo7AM = ( (24 - 23) + 7 ) * 60 * 60; // Seconds from 23:00 to 07:00 next day
        advanceTime(secondsTo7AM);

        expect(isSleeping).toBe(false); // Access as variable
        expect(getCurrentTime().day).toBe(2);
        expect(getCurrentTime().hour).toBe(7);
        expect(getCurrentTime().minute).toBe(0);
        expect(getCurrentTime().second).toBe(0);
        expect(console.log).toHaveBeenCalledWith('Sleep finished at 7:00 AM.');
        // Check if timescale was reset (again, requires internal access or testing effect)
    });

     it('stopSleep should reset sleeping state and time scale', () => {
        startSleep();
        expect(isSleeping).toBe(true); // Access as variable
        // Manually stop sleep before 7 AM
        stopSleep();
        expect(isSleeping).toBe(false); // Access as variable
        // Check timescale reset effect - advance time normally
        const timeBefore = getCurrentTime();
        advanceTime(60); // Advance 1 game minute
        const timeAfter = getCurrentTime();
        expect(timeAfter.minute).toBe(timeBefore.minute + 1); // Should advance at normal speed
    });

    it('getCurrentTime should return correct time object and string', () => {
        advanceTime(1*60*60 + 23*60 + 45); // 1h 23m 45s
        const time = getCurrentTime();
        expect(time.day).toBe(1);
        expect(time.hour).toBe(8); // 7 + 1
        expect(time.minute).toBe(23);
        expect(time.second).toBe(45);
        expect(time.timeString).toBe('Day 1, 08:23:45');
    });
});