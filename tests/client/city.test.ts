import { readFileSync } from 'node:fs'
import { VectorTile, classifyRings } from '@mapbox/vector-tile'
import { PbfReader } from 'pbf'
import { describe, expect, it } from 'vitest'
import { attributeStrings, decodeModelNode, decodeTrees, extrudeTile, mercatorX, mercatorY, metreScale, parseColour } from '../../src/map/city/mesh'
import type { NodeBox } from '../../src/map/city/types'

/** A fixture's bytes in a buffer of their own: Node pools small files into one shared buffer. */
function fixture(name: string): ArrayBuffer {
  const bytes = readFileSync(new URL(`../fixtures/${name}`, import.meta.url))
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

/** Back from Mercator to degrees, the other way from mercatorX and mercatorY. */
function lonLatOf(x: number, y: number): [number, number] {
  return [x * 360 - 180, (360 / Math.PI) * Math.atan(Math.exp(((180 - y * 360) * Math.PI) / 180)) - 90]
}

/** Metres between two points in Mercator, at the first one's latitude. */
function metresApart(a: [number, number], b: [number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]) / metreScale(lonLatOf(a[0], a[1])[1])
}

describe('city placement', () => {
  // Rīga Castle, and a point about 700 m north-east of it.
  const castle: [number, number] = [24.1036, 56.9515]
  const northEast: [number, number] = [24.11, 56.957]

  it('puts a point back where it was to within a centimetre, north up', () => {
    const { origin, scale, trees } = decodeTrees({ featureData: [{ position: [...castle, 5] }, { position: [...northEast, 5] }] }, null, 4326)
    expect(origin).toEqual([mercatorX(castle[0]), mercatorY(castle[1])])
    expect(scale).toBe(metreScale(castle[1]))
    expect([trees[0], trees[1]]).toEqual([0, 0])
    // East and north both come out positive, and the model matrix translate(origin) . scale(s, -s, s) takes it home.
    expect(trees[3]).toBeGreaterThan(300)
    expect(trees[4]).toBeGreaterThan(500)
    const placed: [number, number] = [origin[0] + trees[3] * scale, origin[1] - trees[4] * scale]
    expect(metresApart(placed, [mercatorX(northEast[0]), mercatorY(northEast[1])])).toBeLessThan(0.01)
    const [lon, lat] = lonLatOf(...placed)
    expect(lon).toBeCloseTo(northEast[0], 7)
    expect(lat).toBeCloseTo(northEast[1], 7)
  })

  it('places Web Mercator metres where it places the same degrees', () => {
    const toWebMercator = ([lon, lat]: [number, number]) => [(lon * 20037508.342789244) / 180, 6378137 * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)), 5]
    const degrees = decodeTrees({ featureData: [{ position: [...castle, 5] }, { position: [...northEast, 5] }] }, null, 4326)
    const metres = decodeTrees({ featureData: [{ position: toWebMercator(castle) }, { position: toWebMercator(northEast) }] }, null, 3857)
    expect(metresApart(metres.origin, degrees.origin)).toBeLessThan(0.01)
    expect(Math.hypot(metres.trees[3] - degrees.trees[3], metres.trees[4] - degrees.trees[4])).toBeLessThan(0.01)
  })
})

describe('extruded tile', () => {
  // OpenFreeMap 14/9289/5023, Rīga's old town: its whole building layer, the tile's other layers left out.
  const bytes = new Uint8Array(fixture('city.openfreemap.pbf'))
  const tile = extrudeTile(bytes, 14, 9289, 5023)
  const { positions, colors, indices, polygons } = tile
  const layer = new VectorTile(new PbfReader(bytes)).layers.building
  const features = Array.from({ length: layer.length }, (_, i) => layer.feature(i))
  const width = 4096 / (4096 * 2 ** 14 * tile.scale)

  it('is placed at the tile’s north-west corner', () => {
    expect(tile.origin).toEqual([9289 / 2 ** 14, 5023 / 2 ** 14])
    expect(tile.scale).toBe(metreScale(lonLatOf(...tile.origin)[1]))
  })

  it('makes one building of every polygon but outlines, slivers and those wholly in the next tile', () => {
    let drawn = 0
    let hidden = 0
    let outside = 0
    let slivers = 0
    for (const feature of features) {
      for (const [outer] of classifyRings(feature.loadGeometry())) {
        const beyond = [(p: { x: number }) => p.x < 0, (p: { x: number }) => p.x > 4096, (p: { y: number }) => p.y < 0, (p: { y: number }) => p.y > 4096]
        const area = outer.reduce((sum, p, i) => sum + p.x * outer[(i + 1) % outer.length].y - outer[(i + 1) % outer.length].x * p.y, 0) / 2
        if (feature.properties.hide_3d) hidden++
        else if (beyond.some((test) => outer.every(test))) outside++
        else if (Math.abs(area) * (width / 4096) ** 2 < 1) slivers++
        else drawn++
      }
    }
    expect([hidden, outside, slivers, drawn]).toEqual([2, 96, 22, 1556])
    expect(polygons.length / 6).toBe(drawn)
  })

  it('keeps each building’s triangles in one run that uses only its own vertices', () => {
    let next = 0
    for (let p = 0; p < polygons.length; p += 6) {
      const [firstIndex, indexCount, , , firstVertex, vertexCount] = polygons.subarray(p, p + 6)
      expect(firstIndex).toBe(next)
      expect(indexCount % 3).toBe(0)
      next += indexCount
      for (let i = firstIndex; i < firstIndex + indexCount; i++) {
        expect(indices[i] >= firstVertex && indices[i] < firstVertex + vertexCount).toBe(true)
      }
    }
    expect(next).toBe(indices.length)
    expect(positions.length / 3).toBe(colors.length / 4)
  })

  it('builds closed blocks with every face turned outwards', () => {
    // With the faces turned out, roof and walls enclose roof area times height; the missing floor adds nothing.
    let checked = 0
    for (let p = 0; p < polygons.length; p += 6) {
      const [firstIndex, indexCount, , , firstVertex, vertexCount] = polygons.subarray(p, p + 6)
      const zs = positions.subarray(firstVertex * 3, (firstVertex + vertexCount) * 3).filter((_, i) => i % 3 === 2)
      const [base, top] = [Math.min(...zs), Math.max(...zs)]
      let volume = 0
      let roof = 0
      let cut = false
      for (let i = firstIndex; i < firstIndex + indexCount; i += 3) {
        const [a, b, c] = [indices[i], indices[i + 1], indices[i + 2]].map((v) => [positions[3 * v], positions[3 * v + 1], positions[3 * v + 2] - base])
        volume += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6
        const area = ((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2
        if (a[2] === b[2] && b[2] === c[2]) {
          // A roof triangle, seen from above it runs anticlockwise.
          expect(area).toBeGreaterThan(-1e-3)
          roof += area
        }
      }
      for (let v = firstVertex; v < firstVertex + vertexCount; v++) {
        const [x, y] = [positions[3 * v], positions[3 * v + 1]]
        if (x < 0 || x > width || y > 0 || y < -width) cut = true
      }
      if (cut) continue
      checked++
      expect(volume).toBeCloseTo(roof * (top - base), 0)
    }
    expect(checked).toBeGreaterThan(1400)
  })

  it('puts roofs at the mapped height and leaves out the walls the tile edge cut', () => {
    const heights = new Set(features.map((feature) => Math.fround(Number(feature.properties.render_height))))
    let boundaryWalls = 0
    for (let p = 0; p < polygons.length; p += 6) {
      const [firstIndex, indexCount, , , firstVertex] = polygons.subarray(p, p + 6)
      expect(heights.has(positions[firstVertex * 3 + 2])).toBe(true)
      for (let i = firstIndex; i < firstIndex + indexCount; i += 3) {
        const corners = [indices[i], indices[i + 1], indices[i + 2]].map((v) => positions.subarray(3 * v, 3 * v + 3))
        if (corners.every((c) => c[2] === corners[0][2])) continue
        const along = (axis: number) => corners.every((c) => Math.abs(c[axis] - corners[0][axis]) < 1e-4)
        const x = corners[0][0]
        const y = corners[0][1]
        if ((along(0) && (x < -1e-4 || x > width + 1e-4)) || (along(1) && (y > 1e-4 || y < -width - 1e-4))) boundaryWalls++
      }
    }
    expect(boundaryWalls).toBe(0)
  })

  it('colours a building as mapped, or leaves the colour to the theme and says how tall it is', () => {
    const mapped = new Set(features.map((feature) => String(parseColour(feature.properties.colour))))
    let own = 0
    let theme = 0
    for (let p = 0; p < polygons.length; p += 6) {
      const [, , , , firstVertex, vertexCount] = polygons.subarray(p, p + 6)
      const rgba = colors.subarray(firstVertex * 4, firstVertex * 4 + 4)
      for (let v = firstVertex; v < firstVertex + vertexCount; v++) expect(colors.subarray(v * 4, v * 4 + 4)).toEqual(rgba)
      if (rgba[3] === 255) {
        own++
        expect(mapped.has(String([...rgba.subarray(0, 3)]))).toBe(true)
      } else {
        theme++
        expect([...rgba]).toEqual([Math.min(255, Math.round(positions[firstVertex * 3 + 2])), 0, 0, 0])
      }
    }
    expect(own).toBeGreaterThan(50)
    expect(theme).toBeGreaterThan(1000)
  })
})

describe('city model node', () => {
  // TT_LOD2_Vecpilseta_WSL1 node 1 (CRS 4326): one building. Voleri_WSL1 node 5 (CRS 3857): ten.
  const vecpilseta: NodeBox = {
    center: [24.107246417392332, 56.94547010132746, 17.4649266730994],
    halfSize: [28.840864181518555, 7.7467241287231445, 12.88895320892334],
    quaternion: [0.7784953977423779, 0.5594596584691297, -0.27870114576698835, -0.057231788262375675],
  }
  const voleri: NodeBox = {
    center: [2680365.450042958, 7760889.7244318025, 2.457108266867184],
    halfSize: [326.7604064941406, 47.00575637817383, 1.7840162515640259],
    quaternion: [0.7379546370512428, 0.6748503141053223, -0.000054222960001014945, 0.00006531758649973765],
  }

  for (const [name, obb, crs, vertices, count] of [
    ['city.vecpilseta.bin', vecpilseta, 4326, 1104, 1],
    ['city.voleri.bin', voleri, 3857, 444, 10],
  ] as const) {
    it(`stands every building of ${name} on the ground, inside its node`, () => {
      const node = decodeModelNode(fixture(name), obb, crs)
      expect(node.positions.length).toBe(vertices * 3)
      expect(node.buildings.length).toBe(count * 7)
      // The box's half-sizes are metres, or Mercator metres, which are longer here: a radius that holds either way.
      const reach = Math.hypot(...obb.halfSize)
      let covered = 0
      for (let b = 0; b < node.buildings.length; b += 7) {
        const [first, length, west, south, east, north, height] = node.buildings.subarray(b, b + 7)
        expect(first).toBe(covered)
        covered += length
        const zs = node.positions.subarray(first * 3, (first + length) * 3).filter((_, i) => i % 3 === 2)
        expect(Math.min(...zs)).toBe(0)
        expect(Math.max(...zs)).toBeCloseTo(height, 4)
        for (const side of [west, south, east, north]) expect(Math.abs(side)).toBeLessThan(reach)
        expect(east - west).toBeGreaterThan(1)
        expect(north - south).toBeGreaterThan(1)
      }
      expect(covered).toBe(vertices)
    })
  }

  it('measures the Vecpilsēta building in metres', () => {
    const node = decodeModelNode(fixture('city.vecpilseta.bin'), vecpilseta, 4326)
    expect(node.origin).toEqual([mercatorX(24.107246417392332), mercatorY(56.94547010132746)])
    const [, , west, south, east, north, height] = node.buildings
    for (const side of [east - west, north - south]) {
      expect(side).toBeGreaterThan(20)
      expect(side).toBeLessThan(80)
    }
    // The node's box is exactly as tall as its only building.
    expect(height).toBeCloseTo(2 * vecpilseta.halfSize[2], 1)
  })

  it('refuses a buffer shorter than its counts say', () => {
    const buffer = fixture('city.voleri.bin')
    expect(() => decodeModelNode(buffer.slice(0, buffer.byteLength - 1), voleri, 3857)).toThrow(/cannot hold/)
    expect(() => decodeModelNode(new ArrayBuffer(4), voleri, 3857)).toThrow(/cannot hold/)
    expect(decodeModelNode(new ArrayBuffer(8), voleri, 3857).positions.length).toBe(0)
    const lying = buffer.slice(0)
    new DataView(lying).setUint32(0, 0xffff_fff0, true)
    expect(() => decodeModelNode(lying, voleri, 3857)).toThrow(/cannot hold/)
    // A feature whose triangles run past the vertices there are.
    const overrun = buffer.slice(0)
    new DataView(overrun).setUint32(overrun.byteLength - 4, 1000, true)
    expect(() => decodeModelNode(overrun, voleri, 3857)).toThrow(/does not have/)
  })
})

describe('city trees', () => {
  // Purvciems_LOD2_WSL2 node 3: 393 trees, heights as Float64 in attribute f_2.
  const features = JSON.parse(readFileSync(new URL('../fixtures/city.purvciems.json', import.meta.url), 'utf8'))
  const heights = fixture('city.purvciems.height.bin')

  it('reads every tree with its own height, in Purvciems', () => {
    const { origin, scale, trees } = decodeTrees(features, heights, 4326)
    expect(trees.length).toBe(393 * 3)
    for (let t = 0; t < trees.length; t += 3) {
      const [lon, lat] = lonLatOf(origin[0] + trees[t] * scale, origin[1] - trees[t + 1] * scale)
      expect(lon).toBeGreaterThan(24.15)
      expect(lon).toBeLessThan(24.21)
      expect(lat).toBeGreaterThan(56.94)
      expect(lat).toBeLessThan(56.97)
      // The layer's own heights run from 4 m to 30 m here, so none fell back to the usual 8 m.
      expect(trees[t + 2]).toBeGreaterThanOrEqual(4)
      expect(trees[t + 2]).toBeLessThanOrEqual(30)
    }
    expect(new Set(trees.filter((_, i) => i % 3 === 2)).size).toBeGreaterThan(100)
  })

  it('falls back to 8 m without heights that match the trees, and keeps any height between 1 m and 60 m', () => {
    expect(new Set(decodeTrees(features, null, 4326).trees.filter((_, i) => i % 3 === 2))).toEqual(new Set([8]))
    expect(new Set(decodeTrees(features, heights.slice(0, 800), 4326).trees.filter((_, i) => i % 3 === 2))).toEqual(new Set([8]))
    // Some layers store heights as Float32, straight after the count.
    const float32 = new ArrayBuffer(4 + 4 * 4)
    new DataView(float32).setUint32(0, 4, true)
    new Float32Array(float32, 4).set([12.5, 0, 200, 0.2])
    const four = { featureData: [0, 1, 2, 3].map((i) => ({ position: [24.18 + i / 1000, 56.96, 7] })) }
    expect([...decodeTrees(four, float32, 4326).trees.filter((_, i) => i % 3 === 2)]).toEqual([12.5, 8, 60, 1])
  })

  it('refuses a node with no featureData list, and has nothing to place in an empty one', () => {
    expect(() => decodeTrees({ nodes: [] }, null, 4326)).toThrow(/featureData/)
    const empty = decodeTrees({ featureData: [] }, null, 3857)
    expect(empty.trees.length).toBe(0)
    expect(empty.origin).toEqual([0.5, 0.5])
  })
})

describe('mapped building colours', () => {
  it('reads hex colours and the names mappers use, ignoring case and space', () => {
    expect(parseColour('#fff')).toEqual([255, 255, 255])
    expect(parseColour('#E2725B')).toEqual([226, 114, 91])
    expect(parseColour(' Terracotta ')).toEqual([226, 114, 91])
    expect(parseColour('cream')).toEqual([255, 253, 208])
    expect(parseColour('lightgrey')).toEqual([211, 211, 211])
    expect(parseColour('GRAY')).toEqual(parseColour('grey'))
    expect(parseColour('brown')).toEqual([165, 42, 42])
  })

  it('gives up on anything else', () => {
    for (const value of ['#12345', 'rgb(1, 2, 3)', 'constructor', 'toString', 'red-brown', '', 42, null, undefined]) expect(parseColour(value)).toBeNull()
  })
})

describe('city model string attributes', () => {
  /** A buffer laid out as Rīga's scene services send one: count, total bytes, each length, then the zero-closed values. */
  function strings(values: (string | null)[]): ArrayBuffer {
    const encoded = values.map((value) => (value === null ? new Uint8Array(0) : new TextEncoder().encode(`${value}\0`)))
    const total = encoded.reduce((sum, bytes) => sum + bytes.length, 0)
    const out = new Uint8Array(8 + 4 * values.length + total)
    const view = new DataView(out.buffer)
    view.setUint32(0, values.length, true)
    view.setUint32(4, total, true)
    let at = 8 + 4 * values.length
    encoded.forEach((bytes, i) => {
      view.setUint32(8 + 4 * i, bytes.length, true)
      out.set(bytes, at)
      at += bytes.length
    })
    return out.buffer
  }

  it('reads each value in order, accents and all, a missing one as empty', () => {
    expect(attributeStrings(strings(['Laipu iela   7', '1220 Biroju ēkas', null, '1787-01-01T00:00:00.000Z']))).toEqual([
      'Laipu iela   7',
      '1220 Biroju ēkas',
      '',
      '1787-01-01T00:00:00.000Z',
    ])
  })

  it('refuses a buffer that does not hold what it claims, such as an error answered in its place', () => {
    expect(attributeStrings(new TextEncoder().encode('{"error":{"code":404}}').buffer as ArrayBuffer)).toBeNull()
    expect(attributeStrings(strings(['Laipu iela   7']).slice(0, 20))).toBeNull()
    expect(attributeStrings(new ArrayBuffer(4))).toBeNull()
  })
})
