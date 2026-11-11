import { describe, expect, it } from 'vitest'
import { LANE_M, decodePolyline6, laneOffsets, shiftRight } from '../../server/transit/valhalla'

/** A straight street east from Rīga's centre, a point every 4 m for this many metres. */
function street(metres: number): [number, number][] {
  const k = Math.cos((56.95 * Math.PI) / 180)
  return Array.from({ length: metres / 4 + 1 }, (_, i) => [24.1 + (i * 4) / (111_320 * k), 56.95] as [number, number])
}

describe('lanes from Valhalla', () => {
  it('decodes its six-digit polylines', () => {
    // Valhalla's own example: 38.5, -120.2; 40.7, -120.95; 43.252, -126.453.
    expect(decodePolyline6('_izlhA~rlgdF_{geC~ywl@_kwzCn`{nI')).toEqual([
      [-120.2, 38.5],
      [-120.95, 40.7],
      [-126.453, 43.252],
    ])
  })

  it('keeps to the right-hand lane of a two-way street, right of its middle', () => {
    const points = street(200)
    const offsets = laneOffsets(points, [{ lane_count: 2, traversability: 'both', begin_shape_index: 0, end_shape_index: points.length - 1 }], [])
    // Two lanes this way: the right-hand one's middle is a lane and a half right of the street's.
    for (const o of offsets) expect(o).toBeCloseTo(1.5 * LANE_M)
  })

  it('keeps right on a one-way street too, whose lanes lie either side of its middle', () => {
    const points = street(200)
    const offsets = laneOffsets(points, [{ lane_count: 3, traversability: 'forward', begin_shape_index: 0, end_shape_index: points.length - 1 }], [])
    for (const o of offsets) expect(o).toBeCloseTo(LANE_M)
  })

  it("moves to the turn's lane before a turn, a lane at a time, and is in it where the turn begins", () => {
    const points = street(400)
    const turn = points.length - 1
    const offsets = laneOffsets(
      points,
      [{ lane_count: 3, traversability: 'both', begin_shape_index: 0, end_shape_index: turn }],
      // Three lanes, left to right: left, left and straight on, right. The turn left may be taken from either left one.
      [{ type: 15, begin_shape_index: turn, lanes: [{ directions: 8, active: 8 }, { directions: 10, active: 8 }, { directions: 64 }] }],
    )
    // Far from the turn, the right-hand lane; at it, the middle one (the rightmost for the turn).
    expect(offsets[0]).toBeCloseTo(2.5 * LANE_M)
    expect(offsets[turn]).toBeCloseTo(1.5 * LANE_M)
    // Never more than a lane per 25 m between points 4 m apart.
    for (let i = 1; i < offsets.length; i++) expect(Math.abs(offsets[i] - offsets[i - 1])).toBeLessThanOrEqual((LANE_M / 25) * 4 + 1e-9)
  })

  it('counts the lanes before a turn by its turn lanes where a lane is added for it', () => {
    // A one-way street of two lanes that opens to three before the junction: left, left and on, right.
    const points = street(400)
    const turn = points.length - 1
    const offsets = laneOffsets(
      points,
      [{ lane_count: 2, traversability: 'forward', begin_shape_index: 0, end_shape_index: turn }],
      [{ type: 15, begin_shape_index: turn, lanes: [{ directions: 8, active: 8 }, { directions: 10, active: 8 }, { directions: 64 }] }],
    )
    // At the turn, the middle of the three: the street's middle. Far from it, the right of the two.
    expect(offsets[turn]).toBeCloseTo(0)
    expect(offsets[0]).toBeCloseTo(0.5 * LANE_M)
  })

  it('takes a left turn without mapped lanes from the leftmost lane', () => {
    const points = street(400)
    const turn = points.length - 1
    const offsets = laneOffsets(points, [{ lane_count: 2, traversability: 'both', begin_shape_index: 0, end_shape_index: turn }], [{ type: 15, begin_shape_index: turn }])
    expect(offsets[turn]).toBeCloseTo(0.5 * LANE_M)
  })

  it('moves a line right of the way it runs', () => {
    const points = street(100)
    const shifted = shiftRight(points, points.map(() => 10))
    // Heading east, right is south: 10 m south.
    expect((points[3][1] - shifted[7]) * 110_540).toBeCloseTo(10, 1)
    expect(shifted[6]).toBeCloseTo(points[3][0], 7)
  })
})

describe('simplified lines', () => {
  it('keeps a lane change and drops the points along the straight', async () => {
    const { simplify } = await import('../../server/transit/valhalla')
    const k = Math.cos((56.95 * Math.PI) / 180)
    // 400 m east, a point every 4 m, moving 3.2 m south between 200 m and 225 m.
    const line: number[] = []
    for (let m = 0; m <= 400; m += 4) {
      const south = m < 200 ? 0 : m > 225 ? 3.2 : ((m - 200) / 25) * 3.2
      line.push(24.1 + m / (111_320 * k), 56.95 - south / 110_540)
    }
    const out = simplify(Float64Array.from(line), 0.3)
    expect(out.length / 2).toBeLessThan(10)
    expect(out.length / 2).toBeGreaterThanOrEqual(4)
    // Its ends are kept.
    expect([out[0], out[1]]).toEqual([line[0], line[1]])
    expect([out.at(-2), out.at(-1)]).toEqual([line.at(-2), line.at(-1)])
  })
})
