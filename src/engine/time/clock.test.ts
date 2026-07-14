import { describe, expect, it } from 'vitest';
import { deriveCalendar } from './clock';

describe('deriveCalendar', () => {
  it('starts at day 1, spring, year 1', () => {
    expect(deriveCalendar(0)).toEqual({ minuteOfDay: 0, day: 1, season: 'spring', year: 1 });
  });

  it('rolls over to summer after 30 days', () => {
    const tick = 30 * 24 * 60;
    const calendar = deriveCalendar(tick);
    expect(calendar.season).toBe('summer');
    expect(calendar.day).toBe(1);
  });

  it('rolls over to year 2 after 120 days (4 seasons)', () => {
    const tick = 120 * 24 * 60;
    const calendar = deriveCalendar(tick);
    expect(calendar.year).toBe(2);
    expect(calendar.season).toBe('spring');
  });
});
