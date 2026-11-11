import { describe, expect, it } from 'vitest'
import { PARK_MS, ParkedVehicles } from '../../server/transit/parked'

/** A point this many metres east of Rīga's centre. */
const east = (m: number) => ({ id: 'bus', lon: 24.1 + m / (111_320 * Math.cos((56.95 * Math.PI) / 180)), lat: 56.95 })

describe('parked vehicles', () => {
  it('shows a vehicle that stands less than five minutes', () => {
    const parked = new ParkedVehicles()
    expect(parked.shown([east(0)], 0)).toHaveLength(1)
    expect(parked.shown([east(5)], PARK_MS - 1000)).toHaveLength(1)
  })

  it('hides one that has stood over five minutes, its GPS wandering a few metres', () => {
    const parked = new ParkedVehicles()
    parked.shown([east(0)], 0)
    parked.shown([east(8)], 60_000)
    parked.shown([east(-6)], 120_000)
    expect(parked.shown([east(3)], PARK_MS + 1000)).toHaveLength(0)
  })

  it('brings it back once it drives off: twice in a row at driving speed, away from where it stood', () => {
    const parked = new ParkedVehicles()
    parked.shown([east(0)], 0)
    parked.shown([east(0)], PARK_MS + 1000)
    const t = PARK_MS + 60_000
    // Still there a moment before: its fixes keep coming while it stands.
    parked.shown([east(0)], t - 4000)
    // 40 m in 4 s is 36 km/h: one such move is not yet enough.
    expect(parked.shown([east(40)], t)).toHaveLength(0)
    expect(parked.shown([east(80)], t + 4000)).toHaveLength(1)
  })

  it('takes one jump of its position, out and back, for a bad fix', () => {
    const parked = new ParkedVehicles()
    parked.shown([east(0)], 0)
    parked.shown([east(0)], PARK_MS + 1000)
    const t = PARK_MS + 60_000
    expect(parked.shown([east(60)], t)).toHaveLength(0)
    expect(parked.shown([east(2)], t + 2000)).toHaveLength(0)
    // Nor a leap far faster than any bus.
    expect(parked.shown([east(900)], t + 4000)).toHaveLength(0)
    expect(parked.shown([east(1800)], t + 6000)).toHaveLength(0)
  })

  it('does not count its GPS twitching back and forth as driving off', () => {
    const parked = new ParkedVehicles()
    parked.shown([east(0)], 0)
    parked.shown([east(0)], PARK_MS + 1000)
    let t = PARK_MS + 2000
    for (const m of [12, -12, 12, -12, 12]) expect(parked.shown([east(m)], (t += 2000))).toHaveLength(0)
  })
})
