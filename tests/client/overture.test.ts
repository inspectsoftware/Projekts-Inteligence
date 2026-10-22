import { readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { VectorTile, classifyRings } from '@mapbox/vector-tile'
import { PbfReader, PbfWriter } from 'pbf'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseColour } from '../../src/map/city/mesh'
import { extrudeOverture, overtureTile, resolveOverture } from '../../src/map/city/overture'
import { PmTiles, tileId } from '../../src/map/city/pmtiles'
import { pitchedRoof, roofFrame } from '../../src/map/city/roofs'
import type { ExtrudedTile } from '../../src/map/city/types'

afterEach(() => {
  vi.unstubAllGlobals()
})

type Value = string | number | boolean
interface Feature {
  /** Rings in tile units, each without its first point repeated. */
  rings: [number, number][][]
  properties: Record<string, Value>
}

/** A vector tile of polygons, as Overture's archive holds them. */
function encodeTile(layers: Record<string, Feature[]>): Uint8Array {
  const pbf = new PbfWriter()
  const zigzag = (n: number) => (n << 1) ^ (n >> 31)
  for (const [name, features] of Object.entries(layers)) {
    pbf.writeMessage(
      3,
      () => {
        const keys: string[] = []
        const values: Value[] = []
        const indexOf = <T,>(list: T[], item: T) => (list.includes(item) ? list.indexOf(item) : list.push(item) - 1)
        pbf.writeVarintField(15, 2)
        pbf.writeStringField(1, name)
        pbf.writeVarintField(5, 4096)
        for (const { rings, properties } of features) {
          const tags = Object.entries(properties).flatMap(([key, value]) => [indexOf(keys, key), indexOf(values, value)])
          // MoveTo the first point, LineTo the rest, ClosePath; each point a step from the one before.
          const geometry: number[] = []
          let [x, y] = [0, 0]
          for (const ring of rings) {
            ring.forEach(([px, py], i) => {
              if (i < 2) geometry.push(i === 0 ? (1 << 3) | 1 : ((ring.length - 1) << 3) | 2)
              geometry.push(zigzag(px - x), zigzag(py - y))
              ;[x, y] = [px, py]
            })
            geometry.push((1 << 3) | 7)
          }
          pbf.writeMessage(
            2,
            () => {
              pbf.writeVarintField(3, 3)
              pbf.writePackedVarint(2, tags)
              pbf.writePackedVarint(4, geometry)
            },
            null,
          )
        }
        for (const key of keys) pbf.writeStringField(3, key)
        for (const value of values) {
          pbf.writeMessage(4, () => (typeof value === 'string' ? pbf.writeStringField(1, value) : typeof value === 'boolean' ? pbf.writeBooleanField(7, value) : pbf.writeDoubleField(3, value)), null)
        }
      },
      null,
    )
  }
  return pbf.finish()
}

interface Run {
  centre: [number, number]
  /** x, y, z of each vertex. */
  vertices: number[][]
  /** r, g, b, a of each vertex. */
  colours: number[][]
  /** Corners of each triangle, as positions in vertices. */
  triangles: number[][]
}

/** Each building of a tile on its own. */
function runsOf(tile: ExtrudedTile): Run[] {
  const runs: Run[] = []
  for (let p = 0; p < tile.polygons.length; p += 6) {
    const [firstIndex, indexCount, cx, cy, firstVertex, vertexCount] = tile.polygons.subarray(p, p + 6)
    const each = (count: number, size: number, from: ArrayLike<number>, start: number) => Array.from({ length: count }, (_, i) => Array.from({ length: size }, (_, k) => from[(start + i) * size + k]))
    runs.push({
      centre: [cx, cy],
      vertices: each(vertexCount, 3, tile.positions, firstVertex),
      colours: each(vertexCount, 4, tile.colors, firstVertex),
      triangles: each(indexCount / 3, 3, tile.indices, firstIndex / 3).map((corners) => corners.map((v) => v - firstVertex)),
    })
  }
  return runs
}

/**
 * The volume a building's faces enclose above its lowest point, signed: positive when every face
 * is turned outwards. The floor it lacks lies at that point and adds nothing.
 */
function volumeOf({ vertices, triangles }: Run): number {
  const base = Math.min(...vertices.map((v) => v[2]))
  let volume = 0
  for (const corners of triangles) {
    const [a, b, c] = corners.map((v) => [vertices[v][0], vertices[v][1], vertices[v][2] - base])
    volume += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6
  }
  return volume
}

/** Signed area and area-weighted centre of a ring of x, y points. */
function shapeOf(ring: number[][]): [number, number, number] {
  let [area, x, y] = [0, 0, 0]
  ring.forEach((p, i) => {
    const q = ring[(i + 1) % ring.length]
    const cross = p[0] * q[1] - q[0] * p[1]
    area += cross
    x += (p[0] + q[0]) * cross
    y += (p[1] + q[1]) * cross
  })
  return [area / 2, x / (3 * area), y / (3 * area)]
}

const heightRange = (run: Run) => [Math.min(...run.vertices.map((v) => v[2])), Math.max(...run.vertices.map((v) => v[2]))]

describe('PMTiles archive', () => {
  it('numbers tiles along the Hilbert curve, each zoom after the ones above it', () => {
    expect(tileId(0, 0, 0)).toBe(0)
    expect([tileId(1, 0, 0), tileId(1, 0, 1), tileId(1, 1, 1), tileId(1, 1, 0)]).toEqual([1, 2, 3, 4])
    // Zoom 3 takes ids 21 to 84, one each, and the curve steps from each tile to a neighbour.
    const tiles: [number, number][] = []
    for (let x = 0; x < 8; x++) for (let y = 0; y < 8; y++) tiles[tileId(3, x, y) - 21] = [x, y]
    expect(tiles.filter(Boolean)).toHaveLength(64)
    for (let i = 1; i < 64; i++) expect(Math.abs(tiles[i][0] - tiles[i - 1][0]) + Math.abs(tiles[i][1] - tiles[i - 1][1])).toBe(1)
  })

  // A small archive: tiles A (ids 1 and 2, one run), B (id 4) and C (id 5), B and C under a leaf directory.
  const varints = (values: number[]) =>
    values.flatMap((value) => {
      const bytes: number[] = []
      for (; value >= 128; value = Math.floor(value / 128)) bytes.push((value % 128) | 128)
      return [...bytes, value]
    })
  /** Entries as id, run, offset, length; an offset of null follows straight on from the entry before. */
  const directory = (entries: [number, number, number | null, number][]) =>
    gzipSync(
      Uint8Array.from(
        varints([
          entries.length,
          ...entries.map(([id], i) => id - (i > 0 ? entries[i - 1][0] : 0)),
          ...entries.map((entry) => entry[1]),
          ...entries.map((entry) => entry[3]),
          ...entries.map((entry) => (entry[2] === null ? 0 : entry[2] + 1)),
        ]),
      ),
    )
  const [a, b, c] = ['tile A', 'tile B, a little longer', 'tile C'].map((text) => gzipSync(new TextEncoder().encode(text)))
  const leaf = directory([
    [4, 1, a.length, b.length],
    [5, 1, null, c.length],
  ])
  const root = directory([
    [1, 2, 0, a.length],
    [4, 0, 0, leaf.length],
  ])
  const header = new DataView(new ArrayBuffer(127))
  new TextEncoder().encodeInto('PMTiles', new Uint8Array(header.buffer))
  header.setUint8(7, 3)
  const [leafOffset, dataOffset] = [127 + root.length, 127 + root.length + leaf.length]
  for (const [at, value] of [
    [8, 127],
    [16, root.length],
    [40, leafOffset],
    [48, leaf.length],
    [56, dataOffset],
  ]) {
    header.setUint32(at, value, true)
  }
  // Internal and tile compression gzip, tiles MVT.
  for (const [at, value] of [
    [96, 1],
    [97, 2],
    [98, 2],
    [99, 1],
    [101, 14],
  ]) {
    header.setUint8(at, value)
  }
  const archive = new Uint8Array([...new Uint8Array(header.buffer), ...root, ...leaf, ...a, ...b, ...c])

  function serve(statuses: number[] = []) {
    const requests: { range: string; signal: AbortSignal | null }[] = []
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      expect(url).toBe('https://example.org/buildings.pmtiles')
      const range = new Headers(init.headers).get('Range') ?? ''
      const [, from, to] = /^bytes=(\d+)-(\d+)$/.exec(range) ?? []
      requests.push({ range, signal: init.signal ?? null })
      return new Response(archive.slice(Number(from), Number(to) + 1), { status: statuses.shift() ?? 206 })
    })
    return requests
  }

  it('finds tiles in the root, in a run and under a leaf, fetching each directory once', async () => {
    const requests = serve()
    const pm = new PmTiles('https://example.org/buildings.pmtiles')
    const signal = new AbortController().signal
    const text = async (z: number, x: number, y: number) => {
      const tile = await pm.getTile(z, x, y, signal)
      return tile && new TextDecoder().decode(tile)
    }
    expect(await text(1, 0, 0)).toBe('tile A')
    expect(await text(1, 0, 1)).toBe('tile A')
    expect(await text(1, 1, 0)).toBe('tile B, a little longer')
    expect(await text(2, 0, 0)).toBe('tile C')
    expect(await text(1, 1, 1)).toBeNull()
    expect(await text(0, 0, 0)).toBeNull()
    expect(await text(14, 9318, 4808)).toBeNull()
    const ranges = requests.map((request) => request.range)
    expect(ranges.filter((range) => range === 'bytes=0-16383')).toHaveLength(1)
    expect(ranges.filter((range) => range === `bytes=${leafOffset}-${leafOffset + leaf.length - 1}`)).toHaveLength(1)
    expect(ranges).toContain(`bytes=${dataOffset}-${dataOffset + a.length - 1}`)
    expect(ranges).toContain(`bytes=${dataOffset + a.length + b.length}-${dataOffset + a.length + b.length + c.length - 1}`)
    // Only a tile's own request is cancelled with it; the directories are shared.
    for (const request of requests) expect(request.signal).toBe(Number(/\d+/.exec(request.range)?.[0]) >= dataOffset ? signal : null)
  })

  it('refuses a server that ignores the range, and asks again next time', async () => {
    const requests = serve([200])
    const pm = new PmTiles('https://example.org/buildings.pmtiles')
    await expect(pm.getTile(1, 0, 0)).rejects.toThrow('HTTP 200')
    expect(new TextDecoder().decode((await pm.getTile(1, 0, 0)) ?? undefined)).toBe('tile A')
    expect(requests.filter((request) => request.range === 'bytes=0-16383')).toHaveLength(2)
  })
})

describe('Overture catalogue', () => {
  it('finds the latest release’s buildings archive, and keeps it once found', async () => {
    const asked: string[] = []
    let down = true
    vi.stubGlobal('fetch', async (url: string) => {
      asked.push(url)
      if (down) return new Response('', { status: 503 })
      if (url === 'https://stac.overturemaps.org/catalog.json') return Response.json({ latest: '2026-10-21.0' })
      if (url === 'https://stac.overturemaps.org/2026-10-21.0/buildings/catalog.json') {
        return Response.json({ links: [{ rel: 'root', href: '../../catalog.json' }, { rel: 'pmtiles', href: 'https://tiles.overturemaps.org/2026-10-21.0/buildings.pmtiles' }] })
      }
      return new Response('', { status: 404 })
    })
    await expect(resolveOverture()).rejects.toThrow('HTTP 503')
    down = false
    expect(await resolveOverture()).toBe('https://tiles.overturemaps.org/2026-10-21.0/buildings.pmtiles')
    expect(await resolveOverture()).toBe('https://tiles.overturemaps.org/2026-10-21.0/buildings.pmtiles')
    expect(asked).toEqual(['https://stac.overturemaps.org/catalog.json', 'https://stac.overturemaps.org/catalog.json', 'https://stac.overturemaps.org/2026-10-21.0/buildings/catalog.json'])
  })

  it('looks the release up again once its archive fails, as one taken down does', async () => {
    let latest = '2026-08-21.0'
    const asked: string[] = []
    // Every archive is gone: whichever release the first tile asks for, it fails.
    vi.stubGlobal('fetch', async (url: string) => {
      asked.push(url)
      if (url === 'https://stac.overturemaps.org/catalog.json') return Response.json({ latest })
      const named = /^https:\/\/stac\.overturemaps\.org\/([\w.-]+)\/buildings\/catalog\.json$/.exec(url)?.[1]
      if (named) return Response.json({ links: [{ rel: 'pmtiles', href: `https://tiles.overturemaps.org/${named}/buildings.pmtiles` }] })
      return new Response('', { status: 404 })
    })
    const signal = new AbortController().signal
    await expect(overtureTile(14, 9318, 4808, signal)).rejects.toThrow('HTTP 404')
    latest = '2026-10-21.0'
    asked.length = 0
    await expect(overtureTile(14, 9318, 4808, signal)).rejects.toThrow('HTTP 404')
    expect(asked).toEqual(['https://stac.overturemaps.org/catalog.json', 'https://stac.overturemaps.org/2026-10-21.0/buildings/catalog.json', 'https://tiles.overturemaps.org/2026-10-21.0/buildings.pmtiles'])
  })
})

describe('Overture tile', () => {
  // Overture 14/9318/4808, Tallinn's old town: 42 of its buildings and 41 building parts, among them
  // buildings drawn in parts, every roof shape, buildings the tile's edge cut and one underground.
  const bytes = new Uint8Array(readFileSync(new URL('../fixtures/overture.tallinn.mvt', import.meta.url)))
  const tile = extrudeOverture(bytes, 14, 9318, 4808)
  const runs = runsOf(tile)
  const metres = 1 / (4096 * 2 ** 14 * tile.scale)
  const layers = new VectorTile(new PbfReader(bytes)).layers
  const features = ['building', 'building_part'].flatMap((name) => Array.from({ length: layers[name].length }, (_, i) => layers[name].feature(i)))

  // What should be drawn, in order: every polygon but those of outlines drawn in parts, of
  // underground buildings, of slivers, and of buildings wholly in the next tile.
  const drawn = features.flatMap((feature) => {
    const { properties } = feature
    if (properties.has_parts === true || properties.is_underground === true) return []
    return classifyRings(feature.loadGeometry()).flatMap(([outer]) => {
      const ring = outer.slice(0, -1).map((p) => [p.x * metres, -p.y * metres])
      const [area, cx, cy] = shapeOf(ring)
      const beyond = [(p: { x: number }) => p.x < 0, (p: { x: number }) => p.x > 4096, (p: { y: number }) => p.y < 0, (p: { y: number }) => p.y > 4096]
      if (beyond.some((test) => outer.every(test)) || Math.abs(area) < 1) return []
      const cut = outer.some((p) => p.x < 0 || p.x > 4096 || p.y < 0 || p.y > 4096)
      return [{ properties, centre: [cx, cy], area: Math.abs(area), cut }]
    })
  })

  it('draws buildings in parts as their parts, and leaves out what is underground', () => {
    expect(features.filter((feature) => feature.properties.has_parts === true).length).toBeGreaterThan(3)
    expect(features.filter((feature) => feature.properties.is_underground === true)).toHaveLength(1)
    expect(runs).toHaveLength(drawn.length)
    runs.forEach((run, i) => {
      expect(run.centre[0]).toBeCloseTo(drawn[i].centre[0], 2)
      expect(run.centre[1]).toBeCloseTo(drawn[i].centre[1], 2)
    })
  })

  it('keeps each building’s triangles in one run that uses only its own vertices, every number finite', () => {
    let next = 0
    for (let p = 0; p < tile.polygons.length; p += 6) {
      const [firstIndex, indexCount, , , firstVertex, vertexCount] = tile.polygons.subarray(p, p + 6)
      expect(firstIndex).toBe(next)
      expect(indexCount % 3).toBe(0)
      next += indexCount
      for (let i = firstIndex; i < firstIndex + indexCount; i++) expect(tile.indices[i] >= firstVertex && tile.indices[i] < firstVertex + vertexCount).toBe(true)
    }
    expect(next).toBe(tile.indices.length)
    expect(tile.positions.length / 3).toBe(tile.colors.length / 4)
    expect(tile.positions.every(Number.isFinite)).toBe(true)
    expect(tile.polygons.every(Number.isFinite)).toBe(true)
  })

  it('stands each building on its base and tops it at its height, a roof that cannot be shaped flat halfway up it', () => {
    let shaped = 0
    runs.forEach((run, i) => {
      const { properties } = drawn[i]
      const [bottom, top] = heightRange(run)
      const base = Number(properties.min_height ?? 0) || Number(properties.min_floor ?? 0) * 3
      expect(bottom).toBeCloseTo(base, 3)
      const pitched = typeof properties.roof_shape === 'string' && properties.roof_shape !== 'flat'
      if (typeof properties.height !== 'number') return
      if (!pitched) expect(top).toBe(Math.fround(properties.height))
      else {
        expect(top).toBeLessThanOrEqual(properties.height + 1e-3)
        expect(top).toBeGreaterThanOrEqual((base + properties.height) / 2 - 1e-3)
        if (top > properties.height - 1e-3) shaped++
      }
    })
    expect(shaped).toBeGreaterThan(30)
  })

  it('turns every face outwards and closes each building', () => {
    let checked = 0
    runs.forEach((run, i) => {
      if (drawn[i].cut) return
      const [base, top] = heightRange(run)
      const volume = volumeOf(run)
      // An onion swells past its walls; a spire may be all roof.
      expect(volume).toBeGreaterThan(0.3 * drawn[i].area * (top - base))
      expect(volume).toBeLessThan(1.6 * drawn[i].area * (top - base))
      checked++
    })
    expect(checked).toBeGreaterThan(70)
  })

  it('colours roofs and walls as mapped, or leaves the colour to the theme and says how tall the building is', () => {
    let roofs = 0
    let walls = 0
    runs.forEach((run, i) => {
      const { properties } = drawn[i]
      // The theme's height is the building's, roof and all, though a roof that could not be shaped is drawn lower.
      const theme = run.colours.find((colour) => colour[3] === 0)
      if (theme) {
        expect(theme.slice(1)).toEqual([0, 0, 0])
        if (typeof properties.height === 'number') expect(theme[0]).toBe(Math.min(255, Math.round(properties.height)))
        expect(theme[0]).toBeGreaterThanOrEqual(Math.min(255, Math.round(heightRange(run)[1])))
      }
      const roofRgb = parseColour(properties.roof_color)
      const wallRgb = parseColour(properties.facade_color)
      const roof = roofRgb ? [...roofRgb, 255] : theme
      const wall = wallRgb ? [...wallRgb, 255] : theme
      expect(run.colours[0]).toEqual(roof)
      for (const colour of run.colours) expect([String(roof), String(wall)]).toContain(String(colour))
      if (roofRgb) roofs++
      if (wallRgb) walls++
    })
    expect(roofs).toBeGreaterThan(10)
    expect(walls).toBeGreaterThan(10)
  })
})

describe('Overture roofs', () => {
  // Made-up buildings in the same tile. A rectangle 80 by 40 tile units (about 24 m by 12 m),
  // turned by the 3-4-5 triangle so that its corners stay on whole units.
  const [z, x, y] = [14, 9318, 4808]
  const box = (left: number, top: number, long = 16, wide = 8): [number, number][] => [
    [left, top],
    [left + 4 * long, top + 3 * long],
    [left + 4 * long - 3 * wide, top + 3 * long + 4 * wide],
    [left - 3 * wide, top + 4 * wide],
  ]
  const square = (left: number, top: number, size: number): [number, number][] => [
    [left, top],
    [left + size, top],
    [left + size, top + size],
    [left, top + size],
  ]
  const circle = (cx: number, cy: number, radius: number): [number, number][] =>
    Array.from({ length: 16 }, (_, k) => [Math.round(cx + radius * Math.cos((k * Math.PI) / 8)), Math.round(cy + radius * Math.sin((k * Math.PI) / 8))])
  const shapes = ['gabled', 'hipped', 'half_hipped', 'skillion', 'saltbox', 'gambrel', 'mansard', 'round', 'pyramidal', 'dome', 'onion']
  const building: Feature[] = [
    { rings: [box(1000, 1000)], properties: { height: 12, roof_height: 4, roof_shape: 'gabled' } },
    { rings: [box(1200, 1000)], properties: { num_floors: 2, roof_shape: 'hipped' } },
    { rings: [circle(1500, 1000, 30)], properties: { height: 20, roof_height: 8, roof_shape: 'dome' } },
    { rings: [square(1700, 1000, 40)], properties: { height: 9, roof_height: 3, roof_shape: 'skillion', roof_direction: 92 } },
    { rings: [square(1800, 1000, 40)], properties: { height: 7, facade_color: '#336699', roof_color: '#a00' } },
    { rings: [square(1900, 1000, 40)], properties: { height: 300 } },
    { rings: [box(2000, 1000), square(2015, 1035, 10).reverse()], properties: { height: 12, roof_height: 4, roof_shape: 'gabled' } },
    // Cut by the tile's buffer at its east edge, 64 units out: no wall there, and a flat roof.
    { rings: [[[4000, 1000], [4160, 1000], [4160, 1040], [4000, 1040]]], properties: { height: 12, roof_height: 4, roof_shape: 'gabled' } },
    // Wholly in the buffer: the tile next door draws it.
    { rings: [square(4120, 1100, 20)], properties: { height: 12 } },
    { rings: [square(2200, 1000, 40)], properties: { height: 30, has_parts: true } },
    { rings: [square(2300, 1000, 40)], properties: { height: 10, is_underground: true } },
    ...shapes.map((shape, i): Feature => ({ rings: [box(1000 + 200 * i, 2000)], properties: { height: 15, roof_height: 5, roof_shape: shape } })),
  ]
  const parts: Feature[] = [
    { rings: [[[2200, 1000], [2240, 1000], [2240, 1020], [2200, 1020]]], properties: { height: 10 } },
    { rings: [[[2200, 1020], [2240, 1020], [2240, 1040], [2200, 1040]]], properties: { min_height: 10, height: 30, roof_shape: 'pyramidal', roof_height: 5 } },
  ]
  const tile = extrudeOverture(encodeTile({ building, building_part: parts }), z, x, y)
  const metres = 1 / (4096 * 2 ** z * tile.scale)
  const runs = runsOf(tile)
  const [gabled, hipped, dome, skillion, coloured, tall, holed, cut, ...rest] = runs
  const local = ([px, py]: [number, number]) => [px * metres, -py * metres]
  const near = (p: number[], q: number[]) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-3
  const at = (run: Run, height: number) => run.vertices.filter((v) => Math.abs(v[2] - height) < 1e-3)

  it('draws every building but the one in the buffer, the outline in parts and the underground one, parts last', () => {
    expect(runs).toHaveLength(building.length - 3 + parts.length)
    const [lower, upper] = runs.slice(-2)
    expect(heightRange(lower)).toEqual([0, 10])
    expect(heightRange(upper)[0]).toBeCloseTo(10, 4)
    expect(heightRange(upper)[1]).toBeCloseTo(30, 4)
  })

  it('puts a gabled roof’s ridge at its height along the long side, its eaves at the walls’ top, its gable ends up to the ridge', () => {
    const corners = box(1000, 1000).map(local)
    expect(heightRange(gabled)).toEqual([0, expect.closeTo(12, 4)])
    // Every corner of the outline is an eave, at 12 - 4 m.
    for (const corner of corners) expect(gabled.vertices.some((v) => near(v, corner) && Math.abs(v[2] - 8) < 1e-3)).toBe(true)
    for (const corner of corners) expect(gabled.vertices.some((v) => near(v, corner) && v[2] > 8 + 1e-3)).toBe(false)
    // The ridge runs between the middles of the short sides, and the gable walls rise to it there.
    const ends = [
      [(corners[0][0] + corners[3][0]) / 2, (corners[0][1] + corners[3][1]) / 2],
      [(corners[1][0] + corners[2][0]) / 2, (corners[1][1] + corners[2][1]) / 2],
    ]
    const ridge = at(gabled, 12)
    for (const end of ends) expect(ridge.filter((v) => near(v, end)).length).toBeGreaterThanOrEqual(2)
    const along = [ends[1][0] - ends[0][0], ends[1][1] - ends[0][1]]
    for (const v of ridge) expect(Math.abs((v[0] - ends[0][0]) * along[1] - (v[1] - ends[0][1]) * along[0]) / Math.hypot(...along)).toBeLessThan(1e-3)
    expect(gabled.vertices.every((v) => v[2] === 0 || (v[2] > 8 - 1e-3 && v[2] < 12 + 1e-3))).toBe(true)
  })

  it('guesses a hipped roof’s height from its width over walls of two storeys, its ridge inside the outline', () => {
    const halfWidth = (40 * metres) / 2
    const ridgeHeight = 6 + halfWidth * Math.tan((35 * Math.PI) / 180)
    expect(heightRange(hipped)[1]).toBeCloseTo(ridgeHeight, 3)
    const corners = box(1200, 1000).map(local)
    const inside = (v: number[]) => corners.every((p, k) => {
      const q = corners[(k + 1) % 4]
      return Math.sign((q[0] - p[0]) * (v[1] - p[1]) - (q[1] - p[1]) * (v[0] - p[0])) === Math.sign(shapeOf(corners)[0])
    })
    const ridge = at(hipped, ridgeHeight)
    expect(ridge.length).toBeGreaterThan(1)
    expect(ridge.every(inside)).toBe(true)
    // The hips run in from the ends as far as the roof is half wide: the ridge is the length less the width.
    const length = Math.max(...ridge.map((p) => Math.max(...ridge.map((q) => Math.hypot(p[0] - q[0], p[1] - q[1])))))
    expect(length).toBeCloseTo((80 - 40) * metres, 3)
    for (const corner of corners) expect(hipped.vertices.some((v) => near(v, corner) && v[2] > 6 + 1e-3)).toBe(false)
  })

  it('tops a dome at the middle of its outline', () => {
    const outline = circle(1500, 1000, 30).map(local)
    const [, cx, cy] = shapeOf(outline)
    const top = at(dome, 20)
    expect(top).toHaveLength(1)
    expect(top[0][0]).toBeCloseTo(cx, 3)
    expect(top[0][1]).toBeCloseTo(cy, 3)
    // Its walls stop where it starts.
    for (const corner of outline) expect(dome.vertices.some((v) => near(v, corner) && Math.abs(v[2] - 12) < 1e-3)).toBe(true)
  })

  it('slopes a skillion roof down the way it faces', () => {
    const [west, east] = [1700 * metres, 1740 * metres]
    const roof = skillion.vertices.filter((v) => v[2] > 0)
    expect(roof.filter((v) => Math.abs(v[0] - west) < 1e-3).every((v) => Math.abs(v[2] - 9) < 1e-3)).toBe(true)
    expect(roof.filter((v) => Math.abs(v[0] - east) < 1e-3).every((v) => Math.abs(v[2] - 6) < 1e-3)).toBe(true)
  })

  it('colours walls and roof apart as mapped, or by height for the theme', () => {
    const roof = coloured.colours.filter((_, i) => coloured.vertices[i][2] === Math.fround(7) && i < 4)
    expect(roof).toHaveLength(4)
    for (const colour of roof) expect(colour).toEqual([170, 0, 0, 255])
    expect(coloured.colours.slice(4).every((colour) => String(colour) === String([51, 102, 153, 255]))).toBe(true)
    expect(tall.colours.every((colour) => String(colour) === String([255, 0, 0, 0]))).toBe(true)
  })

  it('falls back to a flat roof halfway up the pitch over a courtyard or where the tile edge cut the outline', () => {
    expect(heightRange(holed)).toEqual([0, 10])
    expect(heightRange(cut)).toEqual([0, 10])
    // No wall along the cut, 64 units east of the tile.
    const east = 4160 * metres
    expect(cut.triangles.filter((corners) => corners.every((v) => Math.abs(cut.vertices[v][0] - east) < 1e-3))).toHaveLength(0)
  })

  it('roofs a building across the tile’s edge alike in both tiles, flat, though only one tile’s buffer cuts it', () => {
    // Whole in this tile, its east end in the buffer; the next tile east cuts it 64 units out.
    const properties = { height: 12, roof_height: 4, roof_shape: 'gabled' }
    const here = extrudeOverture(encodeTile({ building: [{ rings: [[[3900, 1000], [4150, 1000], [4150, 1040], [3900, 1040]]], properties }] }), z, x, y)
    const east = extrudeOverture(encodeTile({ building: [{ rings: [[[-64, 1000], [54, 1000], [54, 1040], [-64, 1040]]], properties }] }), z, x + 1, y)
    const heights = (tile: ExtrudedTile) => [...new Set(runsOf(tile)[0].vertices.map((v) => v[2]))].sort((p, q) => p - q)
    expect(heights(here)).toEqual([0, 10])
    expect(heights(east)).toEqual([0, 10])
  })

  it('keeps every piece of a roof inside an outline that is not convex', () => {
    // An L whose ridge runs along its inner wall, turned so that it does only to within rounding;
    // and one whose hips cross its inner corner.
    const turn = (points: number[][], angle: number) => points.flatMap(([px, py]) => [px * Math.cos(angle) - py * Math.sin(angle), px * Math.sin(angle) + py * Math.cos(angle)])
    const cases: [number[], string][] = [
      [turn([[0, 0], [12, 0], [12, 8], [6, 8], [6, 18], [0, 18]], 0.3), 'gabled'],
      [turn([[0, 0], [10, 0], [10, 8], [2, 8], [2, 12], [0, 12]], 0), 'hipped'],
    ]
    for (const [outline, shape] of cases) {
      const roof = pitchedRoof(outline, roofFrame(outline, undefined, undefined)!, shape, 10, 4)!
      const ring = Array.from({ length: outline.length / 2 }, (_, i) => [outline[2 * i], outline[2 * i + 1]])
      const inside = (px: number, py: number) => ring.reduce((odd, p, i) => {
        const q = ring[(i + 1) % ring.length]
        return p[1] > py !== q[1] > py && px < ((q[0] - p[0]) * (py - p[1])) / (q[1] - p[1]) + p[0] ? !odd : odd
      }, false)
      let area = 0
      for (let t = 0; t < roof.triangles.length; t += 3) {
        const [a, b, c] = [0, 1, 2].map((k) => roof.positions.slice(3 * roof.triangles[t + k], 3 * roof.triangles[t + k] + 2))
        expect(inside((a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3)).toBe(true)
        area += ((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2
      }
      // Covering it once, every piece facing up.
      expect(area).toBeCloseTo(Math.abs(shapeOf(ring)[0]), 6)
    }
  })

  it('builds every shape known up to the roof’s height, with closed faces turned outwards', () => {
    expect(rest.slice(0, shapes.length)).toHaveLength(shapes.length)
    const area = 80 * 40 * metres ** 2
    rest.slice(0, shapes.length).forEach((run, i) => {
      expect([shapes[i], ...heightRange(run).map((h) => Math.round(h * 1000) / 1000)]).toEqual([shapes[i], 0, 15])
      // Walls stop at 10 m, or under the roof where it rises from them; nothing stops between 0 and 10.
      expect(run.vertices.every((v) => v[2] === 0 || v[2] > 10 - 1e-3)).toBe(true)
      expect(run.vertices.some((v) => Math.abs(v[2] - 10) < 1e-3)).toBe(true)
      const volume = volumeOf(run)
      expect(volume).toBeGreaterThan(area * 10)
      expect(volume).toBeLessThan(area * 15 * (shapes[i] === 'onion' ? 1.2 : 1))
    })
  })
})
