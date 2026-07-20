export type Season = 'spring' | 'summer' | 'autumn' | 'winter';
export type SpeedSetting = 'paused' | 1 | 4 | 16;

export const MINUTES_PER_DAY = 24 * 60;
export const DAYS_PER_SEASON = 30;

const SEASONS: Season[] = ['spring', 'summer', 'autumn', 'winter'];
const DAYS_PER_YEAR = DAYS_PER_SEASON * SEASONS.length;

export function speedMultiplier(speed: SpeedSetting): number {
  return speed === 'paused' ? 0 : speed;
}

export interface Calendar {
  minuteOfDay: number;
  day: number; // 1-based day within the current season
  season: Season;
  year: number; // 1-based
}

// dayOfYear is always in [0, DAYS_PER_YEAR), so the index below is always in
// [0, SEASONS.length) — this throws only if that invariant is ever broken by
// a future edit, rather than silently defaulting to a wrong season.
function seasonForDayOfYear(dayOfYear: number): Season {
  const index = Math.floor(dayOfYear / DAYS_PER_SEASON);
  const season = SEASONS[index];
  if (!season) throw new Error(`Invalid season index ${index} for dayOfYear ${dayOfYear}`);
  return season;
}

// tick = total in-game minutes elapsed since world creation (tick 0).
// startSeasonIndex (§5.4 "Starting Conditions Are Rolled... current
// season") shifts which season/day/year tick 0 itself falls in — rolled
// once at world creation (Engine.ensureWorldMeta) and applied consistently
// here ever after, rather than every new game always starting on spring
// day 1. Defaults to 0 (spring) so every existing caller/test is unaffected.
export function deriveCalendar(tick: number, startSeasonIndex = 0): Calendar {
  const minuteOfDay = tick % MINUTES_PER_DAY;
  const totalDays = Math.floor(tick / MINUTES_PER_DAY) + startSeasonIndex * DAYS_PER_SEASON;
  const dayOfYear = totalDays % DAYS_PER_YEAR;
  const year = Math.floor(totalDays / DAYS_PER_YEAR) + 1;
  const season = seasonForDayOfYear(dayOfYear);
  const day = (dayOfYear % DAYS_PER_SEASON) + 1;
  return { minuteOfDay, day, season, year };
}
