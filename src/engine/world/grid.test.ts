import { describe, expect, it } from 'vitest'
import { gridDistance, travelDurationTicks } from './grid'

describe('gridDistance', () => {
  it('computes straight-line distance between coordinates', () => {
    expect(gridDistance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5)
  })

  it('is zero for the same point', () => {
    expect(gridDistance({ x: 7, y: 2 }, { x: 7, y: 2 })).toBe(0)
  })
})

describe('travelDurationTicks', () => {
  it('is zero for zero distance', () => {
    expect(travelDurationTicks(0, { mode: 'foot' })).toBe(0)
  })

  it('a paved road is faster than a trackless route', () => {
    const paved = travelDurationTicks(10, { mode: 'foot', roadQuality: 1 })
    const trackless = travelDurationTicks(10, { mode: 'foot', roadQuality: 0 })
    expect(paved).toBeLessThan(trackless)
  })

  it('a full cargo load is slower than travelling empty', () => {
    const empty = travelDurationTicks(10, { mode: 'wagon', cargoLoadFraction: 0 })
    const loaded = travelDurationTicks(10, { mode: 'wagon', cargoLoadFraction: 1 })
    expect(loaded).toBeGreaterThan(empty)
  })

  it('winter travel is slower than summer travel', () => {
    const summer = travelDurationTicks(10, { mode: 'foot', season: 'summer' })
    const winter = travelDurationTicks(10, { mode: 'foot', season: 'winter' })
    expect(winter).toBeGreaterThan(summer)
  })

  it('a wagon outpaces walking on foot under identical conditions', () => {
    const foot = travelDurationTicks(10, { mode: 'foot' })
    const wagon = travelDurationTicks(10, { mode: 'wagon' })
    expect(wagon).toBeLessThan(foot)
  })
})
