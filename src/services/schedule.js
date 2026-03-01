/**
 * schedule.js
 * Hardcoded trading session schedule for the sniper bot.
 *
 * All times are defined in UTC+8 and converted to UTC internally.
 * Assets outside their session window are skipped by the sniper detector.
 *
 * Schedule (UTC+8):
 *   BTC: 19:40–22:40, 03:40–06:10
 *   ETH: 11:40–15:40, 16:40–19:40
 *   SOL: 09:40–12:40, 21:40–23:40
 *   XRP: 18:40–20:40, 08:40–09:50
 */

import logger from '../utils/logger.js';

// UTC+8 offset in hours
const UTC8_OFFSET = 8;

/**
 * Schedule definition in UTC+8 times.
 * Each asset has an array of sessions with { startUtc8, endUtc8 } strings (HH:MM).
 * Internally we store startMinUTC and endMinUTC for fast comparison.
 */
const SCHEDULE_UTC8 = {
    btc: [
        { startUtc8: '19:40', endUtc8: '22:40' },
        { startUtc8: '03:40', endUtc8: '06:10' },
    ],
    eth: [
        { startUtc8: '11:40', endUtc8: '15:40' },
        { startUtc8: '16:40', endUtc8: '19:40' },
    ],
    sol: [
        { startUtc8: '09:40', endUtc8: '12:40' },
        { startUtc8: '21:40', endUtc8: '23:40' },
    ],
    xrp: [
        { startUtc8: '18:40', endUtc8: '20:40' },
        { startUtc8: '08:40', endUtc8: '09:50' },
    ],
};

/**
 * Convert HH:MM in UTC+8 to minutes-since-midnight in UTC.
 * Result is always in [0, 1440).
 */
function utc8ToUtcMinutes(hhmm) {
    const [h, m] = hhmm.split(':').map(Number);
    let totalMin = (h * 60 + m) - (UTC8_OFFSET * 60);
    if (totalMin < 0) totalMin += 1440;
    if (totalMin >= 1440) totalMin -= 1440;
    return totalMin;
}

// Pre-compute UTC ranges for fast lookup
const SCHEDULE_UTC = {};
for (const [asset, sessions] of Object.entries(SCHEDULE_UTC8)) {
    SCHEDULE_UTC[asset] = sessions.map((s) => ({
        startUtc8: s.startUtc8,
        endUtc8: s.endUtc8,
        startMin: utc8ToUtcMinutes(s.startUtc8),
        endMin: utc8ToUtcMinutes(s.endUtc8),
    }));
}

/**
 * Get current time as minutes since midnight UTC.
 */
function nowMinutesUTC() {
    const d = new Date();
    return d.getUTCHours() * 60 + d.getUTCMinutes();
}

/**
 * Check if `nowMin` falls within range [start, end).
 * Handles overnight wrap (e.g. 22:00–02:00).
 */
function inRange(nowMin, startMin, endMin) {
    if (startMin <= endMin) {
        // Normal range (e.g. 11:40 – 14:40)
        return nowMin >= startMin && nowMin < endMin;
    } else {
        // Overnight wrap (e.g. 19:40 – 22:10 where UTC wraps past midnight)
        return nowMin >= startMin || nowMin < endMin;
    }
}

/**
 * Check if an asset is currently within its trading session.
 * Returns true if asset has no schedule (always active).
 */
export function isAssetInSession(asset) {
    const sessions = SCHEDULE_UTC[asset.toLowerCase()];
    if (!sessions) return true; // no schedule = always active

    const now = nowMinutesUTC();
    return sessions.some((s) => inRange(now, s.startMin, s.endMin));
}

/**
 * Get human-readable time until the next session opens.
 * Returns string like "2h 15m" or null if currently in session.
 */
export function getNextSessionInfo(asset) {
    const sessions = SCHEDULE_UTC[asset.toLowerCase()];
    if (!sessions) return null;

    const now = nowMinutesUTC();

    // If currently in session, return null
    if (sessions.some((s) => inRange(now, s.startMin, s.endMin))) return null;

    // Find the nearest upcoming session start
    let minWait = Infinity;
    for (const s of sessions) {
        let wait = s.startMin - now;
        if (wait <= 0) wait += 1440; // wrap to next day
        if (wait < minWait) minWait = wait;
    }

    if (minWait === Infinity) return null;

    const hours = Math.floor(minWait / 60);
    const mins = minWait % 60;
    if (hours > 0) return `${hours}h ${mins}m`;
    return `${mins}m`;
}

/**
 * Get the full schedule definition (for display in TUI / console).
 * Returns the SCHEDULE_UTC8 object with startUtc8 and endUtc8 strings.
 */
export function getSchedule() {
    return SCHEDULE_UTC8;
}
