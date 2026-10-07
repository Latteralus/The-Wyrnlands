import type { Calendar } from '../../shared/gameRules';

// Ticks → this world's calendar (sim/simulation.tsx's useCalendarAt).
export type CalendarAt = (tick: number) => Calendar;

// Text formatting shared by the profile screens.

// "spring 5, year 1"
export function formatDate(calendarAt: CalendarAt, tick: number): string {
  const c = calendarAt(tick);
  return `${c.season} ${c.day}, year ${c.year}`;
}

export function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// A 0..1 trait as words plus the number.
export function describeTrait(value: number): string {
  const word =
    value < 0.2
      ? 'very low'
      : value < 0.4
        ? 'low'
        : value < 0.6
          ? 'middling'
          : value < 0.8
            ? 'high'
            : 'very high';
  return `${word} (${value.toFixed(2)})`;
}

// "spring 3, 7:05 AM" (the year too, once it's past the first) — log
// timestamps, in place of raw tick numbers.
export function formatTimestamp(calendarAt: CalendarAt, tick: number): string {
  const c = calendarAt(tick);
  const hour24 = Math.floor(c.minuteOfDay / 60);
  const minute = String(c.minuteOfDay % 60).padStart(2, '0');
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  const year = c.year > 1 ? `, year ${c.year}` : '';
  return `${c.season} ${c.day}${year}, ${hour12}:${minute} ${hour24 < 12 ? 'AM' : 'PM'}`;
}
