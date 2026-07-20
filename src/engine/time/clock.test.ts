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

  // §5.4 "Starting Conditions Are Rolled... current season" — startSeasonIndex.
  describe('startSeasonIndex', () => {
    it('shifts which season/day tick 0 itself falls in', () => {
      expect(deriveCalendar(0, 3)).toEqual({ minuteOfDay: 0, day: 1, season: 'winter', year: 1 });
      expect(deriveCalendar(0, 1)).toEqual({ minuteOfDay: 0, day: 1, season: 'summer', year: 1 });
    });

    it('still rolls seasons forward correctly from a shifted start', () => {
      const tick = 25 * 24 * 60; // 25 days into a winter (index 3) start
      const calendar = deriveCalendar(tick, 3);
      expect(calendar.season).toBe('winter');
      expect(calendar.day).toBe(26);
    });

    it('still rolls over to year 2 correctly from a shifted start', () => {
      // Starting in winter (already 90 days into the year), 30 more days
      // completes the year and rolls into year 2's spring.
      const tick = 30 * 24 * 60;
      const calendar = deriveCalendar(tick, 3);
      expect(calendar.year).toBe(2);
      expect(calendar.season).toBe('spring');
    });

    it('defaults to spring (index 0) when omitted, unchanged from before', () => {
      expect(deriveCalendar(0)).toEqual(deriveCalendar(0, 0));
    });
  });
});
