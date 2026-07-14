import type { Season } from '../time/clock'

export interface Coordinates {
  x: number
  y: number
}

// Straight-line distance in grid units. Road quality, transport mode, cargo,
// and season modify how long it takes to *cover* that distance, not the
// distance itself — see travelDurationTicks.
export function gridDistance(a: Coordinates, b: Coordinates): number {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

export type TransportMode = 'foot' | 'handcart' | 'wagon'

// Grid units covered per tick (1 in-game minute, §4.3) at roadQuality 0.5,
// no cargo, no seasonal penalty. Tuned so a ~10-unit trip on foot takes
// roughly a few in-game hours; revisit with the balance harness (§17).
const BASE_SPEED_UNITS_PER_TICK: Record<TransportMode, number> = {
  foot: 0.08,
  handcart: 0.05,
  wagon: 0.12,
}

export interface TravelConditions {
  mode: TransportMode
  /** 0 = trackless ground, 1 = paved road. Defaults to an ungraded dirt track. */
  roadQuality?: number
  /** 0 = empty, 1 = full capacity. Heavier loads travel slower. */
  cargoLoadFraction?: number
  season?: Season
}

function seasonSpeedMultiplier(season?: Season): number {
  switch (season) {
    case 'winter':
      return 0.6
    case 'autumn':
      return 0.85
    default:
      return 1
  }
}

export function travelDurationTicks(distance: number, conditions: TravelConditions): number {
  if (distance <= 0) return 0

  const roadQuality = conditions.roadQuality ?? 0.5
  const cargoLoadFraction = conditions.cargoLoadFraction ?? 0

  const roadMultiplier = 0.5 + roadQuality // 0.5x (no road) .. 1.5x (paved)
  const cargoMultiplier = 1 - cargoLoadFraction * 0.4 // full load costs up to 40% speed
  const seasonMultiplier = seasonSpeedMultiplier(conditions.season)

  const speed = BASE_SPEED_UNITS_PER_TICK[conditions.mode] * roadMultiplier * cargoMultiplier * seasonMultiplier
  return Math.ceil(distance / speed)
}
