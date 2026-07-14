import type { Calendar } from '../engine/ui-api';

const DAY_START_MINUTE = 6 * 60;
const DAY_END_MINUTE = 20 * 60;

function isDaytime(minuteOfDay: number): boolean {
  return minuteOfDay >= DAY_START_MINUTE && minuteOfDay < DAY_END_MINUTE;
}

function formatTimeOfDay(minuteOfDay: number): string {
  const hours24 = Math.floor(minuteOfDay / 60);
  const minutes = minuteOfDay % 60;
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  const suffix = hours24 < 12 ? 'AM' : 'PM';
  return `${hours12}:${minutes.toString().padStart(2, '0')} ${suffix}`;
}

interface SceneHeaderProps {
  icon: string;
  title: string;
  calendar: Calendar;
}

// Placeholder illustration (§14.1: "placeholder illustrations... wired") — a
// season/time-tinted gradient stands in for real location art until the art
// pipeline exists.
export function SceneHeader({ icon, title, calendar }: SceneHeaderProps) {
  const daytime = isDaytime(calendar.minuteOfDay);
  return (
    <header className={`scene-header season-${calendar.season} ${daytime ? 'time-day' : 'time-night'}`}>
      <span className="scene-header-icon" aria-hidden="true">
        {icon}
      </span>
      <h2>{title}</h2>
      <p className="scene-header-calendar">
        Year {calendar.year} · {calendar.season}, day {calendar.day} · {formatTimeOfDay(calendar.minuteOfDay)}
      </p>
    </header>
  );
}
