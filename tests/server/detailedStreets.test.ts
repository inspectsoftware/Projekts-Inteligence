import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import type { Feature, Polygon } from 'geojson'
import { describe, expect, it } from 'vitest'
import { streetTile, tileBounds, unzipTile } from '../../server/streets/detailed'
import { arrowIcon, buildRoads, type RoadNode, type RoadWay } from '../../server/streets/lanes.mjs'
import { bucketKey, roadsIn } from '../../server/streets/roads'

const BOX: [number, number, number, number] = [24.09, 56.94, 24.13, 56.96]
const way = (id: number, nodes: number[], coords: [number, number][], tags: Record<string, string>): RoadWay => ({ id, nodes, coords, tags })

/** A four-lane main road east-west and a side street without lanes crossing it at a signal. */
const CROSSING: RoadWay[] = [
  way(1, [1, 2, 3], [[24.098, 56.95], [24.1, 56.95], [24.102, 56.95]], { highway: 'primary', lanes: '4' }),
  way(2, [4, 2, 5], [[24.1, 56.9488], [24.1, 56.95], [24.1, 56.9512]], { highway: 'residential' }),
]
const SIGNAL: RoadNode[] = [{ node: 2, tags: { highway: 'traffic_signals' } }]

const kinds = (features: Feature[]) => features.map((f) => f.properties?.kind as string)
const middle = (f: Feature) => {
  const ring = (f.geometry as Polygon).coordinates[0]
  return [ring.reduce((s, p) => s + p[0], 0) / ring.length, ring.reduce((s, p) => s + p[1], 0) / ring.length]
}

describe('streets lane by lane', () => {
  it('cuts the world into z15 tiles, about 670 m square at Rīga', () => {
    const [w, s, e, n] = tileBounds(15, 18571, 10045)
    expect(e - w).toBeCloseTo(360 / 2 ** 15, 9)
    expect(n).toBeGreaterThan(s)
    expect((e - w) * 111_320 * Math.cos((((s + n) / 2) * Math.PI) / 180)).toBeGreaterThan(600)
  })

  it('paves a junction, paints the road OSM gives lanes for and leaves the one it does not plain', () => {
    const fc = buildRoads(CROSSING, SIGNAL, BOX)
    const k = kinds(fc.features)
    expect(k.filter((x) => x === 'carriageway').length).toBeGreaterThanOrEqual(6)
    expect(k).toContain('junction')
    expect(k).toContain('stop-line')
    // Four lanes: a lane line each way and a double line between the directions.
    expect(fc.features.some((f) => f.properties?.kind === 'centre-line' && f.properties.dash === 'double')).toBe(true)
    expect(k.filter((x) => x === 'lane-line').length).toBeGreaterThanOrEqual(2)
    // Every line is on the main road (north-south lines would be the side street's).
    for (const f of fc.features.filter((x) => x.properties?.kind === 'lane-line' || x.properties?.kind === 'centre-line')) {
      const [[x0], [x1]] = [(f.geometry as { coordinates: number[][] }).coordinates[0], (f.geometry as { coordinates: number[][] }).coordinates.at(-1)!]
      expect(Math.abs(x1 - x0)).toBeGreaterThan(0)
    }
  })

  it('joins a slip road on its own side: one coming from the right stays right of the main road', () => {
    // Eastbound main road; the slip road comes up from the south-west, on its right.
    const ways = [
      way(10, [1, 2], [[24.1, 56.95], [24.11, 56.95]], { highway: 'trunk', oneway: 'yes', lanes: '2' }),
      way(11, [2, 3], [[24.11, 56.95], [24.12, 56.95]], { highway: 'trunk', oneway: 'yes', lanes: '2' }),
      way(12, [4, 2], [[24.104, 56.9496], [24.11, 56.95]], { highway: 'trunk_link', oneway: 'yes', lanes: '1' }),
    ]
    const slip = buildRoads(ways, [], BOX).features.filter((f) => f.properties?.kind === 'carriageway' && f.properties?.highway === 'trunk_link')
    expect(slip.length).toBe(1)
    expect(middle(slip[0])[1]).toBeLessThan(56.95)
  })

  it('keeps the islands mappers drew, grass or paved', () => {
    const island = way(20, [20, 21, 22, 20], [[24.1009, 56.95015], [24.1011, 56.95015], [24.101, 56.95025], [24.1009, 56.95015]], { 'area:highway': 'traffic_island', surface: 'grass' })
    const found = buildRoads([...CROSSING, island], SIGNAL, BOX).features.filter((f) => f.properties?.kind === 'island')
    expect(found.map((f) => f.properties?.grass)).toEqual([true])
  })

  it('lays pavements where the road has them, and puts a tunnel under the ground', () => {
    const ways = [
      way(30, [1, 2], [[24.1, 56.95], [24.11, 56.95]], { highway: 'residential', sidewalk: 'both' }),
      way(31, [3, 4], [[24.1, 56.952], [24.11, 56.952]], { highway: 'residential', oneway: 'yes', 'sidewalk:right': 'yes' }),
      way(32, [5, 6], [[24.1, 56.954], [24.11, 56.954]], { highway: 'primary', lanes: '2', tunnel: 'yes', sidewalk: 'both' }),
    ]
    const fs = buildRoads(ways, [], BOX).features
    const sidewalks = fs.filter((f) => f.properties?.kind === 'sidewalk')
    // Both sides of the two-way street, the right of the one-way one, none in the tunnel.
    expect(sidewalks.length).toBe(3)
    // The one-way street runs east: its right is the south side.
    const lat = (f: Feature) => middle(f)[1]
    expect(sidewalks.filter((f) => lat(f) > 56.9515 && lat(f) < 56.952).length).toBe(1)
    expect(sidewalks.filter((f) => lat(f) > 56.952 && lat(f) < 56.9525).length).toBe(0)
    expect(fs.filter((f) => f.properties?.kind === 'carriageway' && f.properties.layer === -1).length).toBeGreaterThan(0)
  })

  it('names a turn arrow by the ways its lane goes', () => {
    expect(arrowIcon(['through', 'left'])).toBe('arrow-left+through')
    expect(arrowIcon(['sharp_right'])).toBe('arrow-right')
  })

  it('builds a tile from the roads kept in squares, keeps it, and has none where no roads were built', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pwh-roads-'))
    mkdirSync(join(dir, '12'))
    writeFileSync(join(dir, 'meta.json'), JSON.stringify({ built: '2026-11-11T00:00:00Z' }))
    const lines = [...CROSSING.map((w) => JSON.stringify(w)), JSON.stringify({ ...SIGNAL[0], coord: [24.1, 56.95] })]
    writeFileSync(join(dir, '12', `${bucketKey([24.1, 56.95])}.ndjson.gz`), gzipSync(lines.join('\n')))
    const found = await roadsIn(dir, [24.099, 56.949, 24.101, 56.951])
    expect(found.ways.map((w) => w.id).sort()).toEqual([1, 2])
    expect(found.nodes.map((n) => n.node)).toEqual([2])

    // The z15 tile the crossing is in.
    const x = Math.floor(((24.1 + 180) / 360) * 2 ** 15)
    const r = (56.95 * Math.PI) / 180
    const y = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** 15)
    const cache = mkdtempSync(join(tmpdir(), 'pwh-lanes-'))
    const gz = await streetTile(15, x, y, dir, cache)
    expect(kinds(unzipTile(gz!).features)).toContain('junction')
    expect(await streetTile(15, x, y, dir, cache)).toEqual(gz)
    expect(await streetTile(15, x, y, null, cache)).toBeNull()
  })
})
