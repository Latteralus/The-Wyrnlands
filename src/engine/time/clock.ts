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

// tick = total in-game minutes elapsed since world creation (tick 0).
export function deriveCalendar(tick: number): Calendar {
  const minuteOfDay = tick % MINUTES_PER_DAY;
  const totalDays = Math.floor(tick / MINUTES_PER_DAY);
  const dayOfYear = totalDays % DAYS_PER_YEAR;
  const year = Math.floor(totalDays / DAYS_PER_YEAR) + 1;
  const season = SEASONS[Math.floor(dayOfYear / DAYS_PER_SEASON)];
  const day = (dayOfYear % DAYS_PER_SEASON) + 1;
  return { minuteOfDay, day, season, year };
}
