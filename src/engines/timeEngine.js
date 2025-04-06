/**
 * @module timeEngine
 * @description Manages the in-game time, date, speed, and triggers periodic updates (ticks) for other engines.
 */

const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
const GAME_SECONDS_PER_REAL_SECOND = 60; // As per TechnicalDocument

let currentGameTime = {
    day: 1,
    hour: 7, // Start at 7:00 AM
    minute: 0,
    second: 0,
};
let timeScale = 1; // 1x, 2x, 4x speed
let isPaused = false;
let isSleeping = false;
let tickIntervalId = null;
let accumulatedRealTimeMs = 0;

// Callback for when a game tick occurs
let onTickCallback = null;

/**
 * Initializes the Time Engine. Starts the main tick loop.
 * @param {function} tickCallback - Function to call on each game tick, passing the currentGameTime.
 */
function initializeTimeEngine(tickCallback) {
    console.log("Time Engine Initialized");
    onTickCallback = tickCallback;
    // Reset state
    currentGameTime = { day: 1, hour: 7, minute: 0, second: 0 };
    timeScale = 1;
    isPaused = false;
    isSleeping = false;
    accumulatedRealTimeMs = 0;
    stopTicking(); // Ensure no previous interval is running
    startTicking();
}

/**
 * Advances the game time by a specified number of game seconds.
 * Handles minute, hour, and day rollovers.
 * @param {number} secondsToAdd - The number of game seconds to advance.
 */
function advanceTime(secondsToAdd) {
    if (isPaused && !isSleeping) return;

    let totalSeconds = currentGameTime.second + secondsToAdd;
    currentGameTime.second = totalSeconds % SECONDS_PER_MINUTE;

    let totalMinutes = currentGameTime.minute + Math.floor(totalSeconds / SECONDS_PER_MINUTE);
    currentGameTime.minute = totalMinutes % MINUTES_PER_HOUR;

    let totalHours = currentGameTime.hour + Math.floor(totalMinutes / MINUTES_PER_HOUR);
    currentGameTime.hour = totalHours % HOURS_PER_DAY;

    currentGameTime.day += Math.floor(totalHours / HOURS_PER_DAY);

    // Handle sleep completion
    if (isSleeping && currentGameTime.hour >= 7 && totalHours >= HOURS_PER_DAY) { // Wakes up at 7 AM *next* day if slept past midnight
         // More precise check: Wake up exactly at 7:00 AM if sleeping
         if (currentGameTime.hour === 7 && currentGameTime.minute === 0 && currentGameTime.second === 0) {
            stopSleep();
         } else if (currentGameTime.hour > 7) { // Overshot 7 AM slightly due to large tick interval
            currentGameTime.hour = 7;
            currentGameTime.minute = 0;
            currentGameTime.second = 0;
            stopSleep();
         }
    }

    // Trigger the callback for other engines
    if (onTickCallback) {
        onTickCallback(getCurrentTime());
    }
}

/**
 * The main loop that advances time based on real time elapsed.
 * @param {number} [realTimeElapsedMs=1000] - Milliseconds elapsed since last call. Defaults to 1 second for interval.
 */
function tick(realTimeElapsedMs = 1000) { // Default interval of 1s
    if (isPaused && !isSleeping) return;

    const gameSecondsToAdvance = (realTimeElapsedMs / 1000) * GAME_SECONDS_PER_REAL_SECOND * timeScale;
    advanceTime(gameSecondsToAdvance);
}

/** Starts the regular tick interval. */
function startTicking() {
    if (tickIntervalId === null) {
        // Use a smaller interval for smoother updates, especially at higher speeds
        const intervalMs = 250; // Update 4 times per real second
        tickIntervalId = setInterval(() => tick(intervalMs), intervalMs);
        console.log(`Time Engine started ticking (Interval: ${intervalMs}ms)`);
    }
}

/** Stops the regular tick interval. */
function stopTicking() {
    if (tickIntervalId !== null) {
        clearInterval(tickIntervalId);
        tickIntervalId = null;
        console.log("Time Engine stopped ticking");
    }
}

/** Pauses the game time progression (except for sleep). */
function pause() {
    if (!isPaused) {
        isPaused = true;
        console.log("Time Engine Paused");
    }
}

/** Resumes the game time progression. */
function resume() {
    if (isPaused) {
        isPaused = false;
        console.log("Time Engine Resumed");
    }
}

/**
 * Sets the game speed multiplier.
 * @param {number} scale - The desired time scale (e.g., 1, 2, 4).
 */
function setTimeScale(scale) {
    if ([1, 2, 4].includes(scale)) {
        timeScale = scale;
        console.log(`Time scale set to ${scale}x`);
    } else {
        console.warn(`Invalid time scale: ${scale}. Must be 1, 2, or 4.`);
    }
}

/** Initiates the sleep state, rapidly advancing time until 7:00 AM. */
function startSleep() {
    if (!isSleeping) {
        isSleeping = true;
        isPaused = false; // Ensure time advances
        setTimeScale(100); // Use a very high timescale for fast sleep
        console.log("Sleep started. Fast-forwarding time...");
        // The tick loop will now advance time rapidly until stopSleep is called
    }
}

/** Stops the sleep state and restores normal time scale. */
function stopSleep() {
    if (isSleeping) {
        isSleeping = false;
        setTimeScale(1); // Restore default speed
        // Optionally pause the game after waking up? Or resume normally.
        // pause();
        console.log("Sleep finished at 7:00 AM.");
    }
}

/**
 * Gets the current game time.
 * @returns {object} An object containing day, hour, minute, second, and a formatted string.
 */
function getCurrentTime() {
    return {
        ...currentGameTime,
        timeString: `Day ${currentGameTime.day}, ${String(currentGameTime.hour).padStart(2, '0')}:${String(currentGameTime.minute).padStart(2, '0')}:${String(Math.floor(currentGameTime.second)).padStart(2, '0')}`
    };
}

export {
    initializeTimeEngine,
    advanceTime,
    startTicking,
    stopTicking,
    pause,
    resume,
    setTimeScale,
    startSleep,
    stopSleep,
    getCurrentTime,
    isPaused, // Export state for checks if needed
    isSleeping // Export state for checks if needed
};