import { describe, expect, it } from 'vitest'
import { withoutTwins } from '../../server/transit/twins'

/** A bus of route 3 this many metres east of Rīga's centre. */
function bus(id: string, east: number, extra: { route?: string; mode?: string; trk?: number; spd?: number; ts?: number; scheduled?: boolean } = {}) {
  return {
    id,
    lon: 24.1 + east / (111_320 * Math.cos((56.95 * Math.PI) / 180)),
    lat: 56.95,
    ts: extra.ts ?? 1000,
    trk: extra.trk,
    spd: extra.spd,
    label: '3',
    props: { mode: extra.mode ?? 'bus', route: extra.route ?? 'riga-3', scheduled: extra.scheduled },
  }
}

describe('twin vehicles', () => {
  it('makes one of two buses of a route side by side, the one heard from last', () => {
    const kept = withoutTwins([bus('a', 0, { ts: 1000 }), bus('b', 12, { ts: 2000 })])
    expect(kept.map((v) => v.id)).toEqual(['b'])
  })

  it('keeps a live bus over its timetable stand-in', () => {
    const kept = withoutTwins([bus('live', 0, { ts: 1000 }), bus('timetable', 20, { ts: 5000, scheduled: true })])
    expect(kept.map((v) => v.id)).toEqual(['live'])
  })

  it('leaves two of one number on different routes, or of different kinds, alone', () => {
    expect(withoutTwins([bus('a', 0), bus('b', 5, { route: 'riga-3-night' })])).toHaveLength(2)
    expect(withoutTwins([bus('a', 0), bus('b', 5, { mode: 'trolleybus' })])).toHaveLength(2)
  })

  it('leaves two passing each other the other way alone', () => {
    expect(withoutTwins([bus('a', 0, { trk: 90, spd: 30 }), bus('b', 10, { trk: 270, spd: 30 })])).toHaveLength(2)
  })

  it('leaves two of a route far enough apart alone', () => {
    expect(withoutTwins([bus('a', 0), bus('b', 60)])).toHaveLength(2)
  })
})
