import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MapMatcher } from '../../server/transit/mapmatch'
import { buildRoadGraph } from '../../server/transit/roads'
import { indexGtfs } from '../../server/transit/gtfs'
import { putOnStreets } from '../../server/transit/streets'

// A two-way street east along 54.68° N, turning north at a corner with traffic signals, and a
// one-way street running back west a block south of it; a tram track off to the side.
const way = (tags: Record<string, string>, points: [number, number][]) => ({ type: 'way' as const, tags, geometry: points.map(([lon, lat]) => ({ lon, lat })) })
const elements = [
  way({ highway: 'secondary', lanes: '2' }, [[25.27, 54.68], [25.28, 54.68], [25.28, 54.69]]),
  way({ highway: 'residential', oneway: 'yes' }, [[25.28, 54.677], [25.27, 54.677]]),
  way({ railway: 'tram' }, [[25.27, 54.683], [25.28, 54.683]]),
  { type: 'node' as const, lon: 25.28, lat: 54.68, tags: { highway: 'traffic_signals' } },
  { type: 'node' as const, lon: 25.275, lat: 54.68, tags: { highway: 'crossing' } },
  way({ highway: 'footway', footway: 'crossing' }, [[25.275, 54.6799], [25.275, 54.6801]]),
]
const graph = buildRoadGraph(elements)
const matcher = new MapMatcher(graph)
const metres = (a: number, b: number, c: number, d: number) => Math.hypot((c - a) * Math.cos((b * Math.PI) / 180), d - b) * 111_320

describe('streets from OpenStreetMap', () => {
  it('joins ways where they meet, keeps one-way streets one way, and finds signals and crossings', () => {
    expect(graph.edges.filter((edge) => edge.kind === 'road')).toHaveLength(3)
    expect(graph.edges.find((edge) => edge.lanes === 1)?.twoWay).toBe(false)
    expect(graph.signals.size).toBe(1)
    expect(graph.crossings.points).toHaveLength(1)
    expect(graph.crossings.ways).toHaveLength(1)
  })
})

describe('route lines on the streets', () => {
  // The operator's line: a few metres off the street, and cutting the corner diagonally.
  const line = Float64Array.from([25.27, 54.68005, 25.2785, 54.68004, 25.28004, 54.6815, 25.28003, 54.69])

  it('follows the street round the corner, in the right-hand lane, with the signal on it', () => {
    const matched = matcher.match(line, 'road')!
    expect(matched).not.toBeNull()
    const corner = Array.from({ length: matched.points.length / 2 }, (_, i) => [matched.points[2 * i], matched.points[2 * i + 1]])
    // A point near the corner itself, not on the diagonal the operator drew.
    expect(corner.some(([lon, lat]) => metres(lon, lat, 25.28, 54.68) < 4)).toBe(true)
    // Eastbound on a two-lane street: the lane centre is 1.6 m to the right (south) of the middle.
    const [lon, lat] = corner[1]
    expect(lat).toBeLessThan(54.68)
    expect(metres(lon, 54.68, lon, lat)).toBeCloseTo(1.6, 0)
    expect(matched.signals).toHaveLength(1)
  })

  it('keeps trams on the track and will not drive a one-way street the wrong way', () => {
    expect(matcher.match(Float64Array.from([25.27, 54.68302, 25.28, 54.68298]), 'tram')).not.toBeNull()
    // Eastwards along the westbound one-way street: no way to drive it.
    expect(matcher.match(Float64Array.from([25.2702, 54.677, 25.2798, 54.677]), 'road')).toBeNull()
  })
})

describe('lines put on the streets once', () => {
  // One bus line along the street above, as a timetable has it.
  const timetable = () =>
    indexGtfs(
      new Map([
        ['stops.txt', 'stop_id,stop_name,stop_lat,stop_lon\nA,West,54.68,25.27\nB,Corner,54.68,25.28\n'],
        ['routes.txt', 'route_id,route_short_name,route_long_name,route_type\nr,1,One,3\n'],
        ['trips.txt', 'route_id,service_id,trip_id,shape_id\nr,s,T,line\n'],
        ['shapes.txt', 'shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence\nline,54.68005,25.27,1\nline,54.68004,25.2785,2\nline,54.6815,25.28004,3\nline,54.69,25.28003,4\n'],
        ['stop_times.txt', 'trip_id,departure_time,stop_id,stop_sequence\nT,10:00:00,A,1\nT,10:05:00,B,2\n'],
      ]),
    )

  it('keeps the matched lines on disk, and a restart reads them back without asking Overpass again', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'streets-'))
    let asked = 0
    const overpass = (async () => {
      asked++
      return new Response(JSON.stringify({ elements }))
    }) as typeof fetch
    const first = timetable()
    await putOnStreets('town', first, dir, overpass)
    expect(asked).toBe(1)
    expect(first.onStreets).toEqual([true])

    const again = timetable()
    await putOnStreets('town', again, dir, async () => {
      throw new Error('asked Overpass again')
    })
    expect(again.onStreets).toEqual([true])
    expect(Array.from(again.shapes[0])).toEqual(Array.from(first.shapes[0], (v) => Math.round(v * 1e7) / 1e7))
    expect(again.signals).toEqual(first.signals)
  })
})
