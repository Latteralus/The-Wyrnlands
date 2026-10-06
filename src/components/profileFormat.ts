import type { UiApi } from '../engine/ui-api';

// Text formatting shared by the profile screens.

// "spring 5, year 1"
export function formatDate(uiApi: UiApi, tick: number): string {
  const c = uiApi.getCalendarAt(tick);
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
