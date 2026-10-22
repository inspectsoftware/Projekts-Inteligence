import { readFileSync } from 'node:fs'
import { VectorTile, classifyRings } from '@mapbox/vector-tile'
import { PbfReader } from 'pbf'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TILE_ORIGINS } from '../../shared/origins'
import { valueIn } from '../../src/map/city/building'
import { DEM_SIZE, DEM_ZOOM, sampleGround, terrariumHeights, tilesAround } from '../../src/map/city/dem'
import { attributeStrings, decodeModelNode, decodeTrees, extrudeTile, mercatorX, mercatorY, metreScale, parseColour } from '../../src/map/city/mesh'
import { bakedLeaves, boxCentre, boxRadius, moveMetres } from '../../src/map/city/sources'
import type { BakedLeaf, CityCatalogue, CityLayer, NodeBox } from '../../src/map/city/types'

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

  it('sinks a basement below the street, and leaves a building above the terrain on its own lowest point', () => {
    const data = fixture('city.vecpilseta.bin')
    const plain = decodeModelNode(data, vecpilseta, 4326)
    const vertices = new DataView(data).getUint32(0, true)
    const lowest = vecpilseta.center[2] + Math.min(...new Float32Array(data, 8, vertices * 3).filter((_, i) => i % 3 === 2))
    const heights = (node: { positions: Float32Array }) => node.positions.filter((_, i) => i % 3 === 2)
    const asked: [number, number][] = []
    // The street 1.5 m above the building's lowest point: that much of it is basement.
    const sunk = decodeModelNode(data, vecpilseta, 4326, (lon, lat) => {
      asked.push([lon, lat])
      return lowest + 1.5
    })
    expect(Math.min(...heights(sunk))).toBeCloseTo(-1.5, 4)
    expect(sunk.buildings[6]).toBeCloseTo(plain.buildings[6] - 1.5, 4)
    expect([...sunk.buildings.subarray(0, 6)]).toEqual([...plain.buildings.subarray(0, 6)])
    // Asked once, for the middle of the building, which is about the middle of its node.
    expect(asked).toHaveLength(1)
    expect(Math.abs(asked[0][0] - vecpilseta.center[0])).toBeLessThan(0.001)
    expect(Math.abs(asked[0][1] - vecpilseta.center[1])).toBeLessThan(0.001)
    // Terrain below it, as on a terrace, or none known there: it stands where it did. So it does
    // where the terrain lies metres above most of a node's buildings, as roofs or another datum would.
    for (const terrain of [lowest - 5, NaN, lowest + 3]) expect(decodeModelNode(data, vecpilseta, 4326, () => terrain)).toEqual(plain)
  })

  it('places a leaf from the baked index where its node pages place it', () => {
    const layer: CityLayer = { name: 'Test', region: 'Test', url: 'https://example.org/layers/0', crs: 4326, bbox: [0, 0, 0, 0] }
    for (const [name, obb, crs, vertices] of [
      ['city.vecpilseta.bin', vecpilseta, 4326, 1104],
      ['city.voleri.bin', voleri, 3857, 444],
    ] as const) {
      // As scripts/bake-city-3d.mjs writes a row.
      const { lng, lat } = boxCentre(obb, crs)
      const row: BakedLeaf = [7, +lng.toFixed(6), +lat.toFixed(6), +obb.center[2].toFixed(1), Math.ceil(boxRadius(obb, crs)), vertices]
      const [leaf] = bakedLeaves({ ...layer, crs }, [row])
      expect(leaf).toMatchObject({ key: 'm:https://example.org/layers/0#7', resource: 7, size: vertices, centre: { lng: row[1], lat: row[2] }, radius: row[4] })
      expect(boxRadius(leaf.obb, crs)).toBeCloseTo(row[4], 6)
      // The same geometry, within the 10 cm the rounding allows.
      const pages = decodeModelNode(fixture(name), obb, crs)
      const baked = decodeModelNode(fixture(name), leaf.obb, crs)
      const at = (node: typeof pages, v: number): [number, number] => [node.origin[0] + node.positions[3 * v] * node.scale, node.origin[1] - node.positions[3 * v + 1] * node.scale]
      for (const v of [0, vertices - 1]) expect(metresApart(at(pages, v), at(baked, v))).toBeLessThan(0.1)
    }
  })

  it('reaches as far from its centre as a box lying on its side does', () => {
    // Turned a quarter about east: its second axis points up, its third north, 40 m each way.
    const side: NodeBox = { center: [24.1, 56.95, 10], halfSize: [30, 5, 40], quaternion: [Math.SQRT1_2, 0, 0, Math.SQRT1_2] }
    expect(boxRadius(side, 4326)).toBeGreaterThanOrEqual(Math.hypot(30, 40))
    // In Web Mercator metres, which are longer than ground metres there.
    const lat = boxCentre(voleri, 3857).lat
    expect(boxRadius({ ...side, center: voleri.center }, 3857)).toBeCloseTo(Math.hypot(30, 5, 40) * Math.cos((lat * Math.PI) / 180), 6)
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

  it('reads a clicked building’s year as Float64, even a leaf’s only one, and text otherwise', () => {
    const years = (values: number[]) => {
      const buffer = new ArrayBuffer(8 + 8 * values.length)
      new DataView(buffer).setUint32(0, values.length, true)
      new Float64Array(buffer, 8).set(values)
      return buffer
    }
    expect(valueIn(years([1990]), 0)).toBe('1990')
    expect(valueIn(years([1890, 2004]), 1)).toBe('2004')
    expect(valueIn(years([1990]), 1)).toBeUndefined()
    expect(valueIn(strings(['Laipu iela   7']), 0)).toBe('Laipu iela   7')
    // As long as eight bytes a value, but the total length of the text where the padding would be.
    expect(valueIn(strings(['abc', 'def']), 1)).toBe('def')
    expect(valueIn(new ArrayBuffer(4), 0)).toBeUndefined()
  })
})

describe('terrain under the city models', () => {
  it('reads terrarium colours as metres, in either order of red and blue', () => {
    expect([...terrariumHeights([128, 0, 0, 255, 128, 12, 128, 255, 127, 255, 0, 255])]).toEqual([0, 12.5, -1])
    expect([...terrariumHeights([0, 0, 128, 255, 128, 12, 128, 255, 0, 255, 127, 255], true)]).toEqual([0, 12.5, -1])
  })

  it('finds the tiles round a point, and the height between the pixel centres around it', () => {
    // Raekoja plats in Tallinn, in a tile whose ground rises a metre a pixel eastwards and ten southwards.
    const { zoom, keys } = tilesAround(24.7453, 59.4372, 1)
    expect(zoom).toBe(DEM_ZOOM)
    const [key] = keys
    const [, x, y] = key.split('/').map(Number)
    const tiles = new Map([[key, new Float32Array(DEM_SIZE * DEM_SIZE).map((_, i) => (i % DEM_SIZE) + 10 * Math.floor(i / DEM_SIZE))]])
    // Pixels from the tile's north-west corner, as longitude and latitude.
    const at = (px: number, py: number): [number, number] => {
      const n = 2 ** DEM_ZOOM
      return [((x + px / DEM_SIZE) / n) * 360 - 180, (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + py / DEM_SIZE)) / n))) * 180) / Math.PI]
    }
    expect(sampleGround(tiles, DEM_ZOOM, ...at(100.5, 200.5))).toBeCloseTo(2100, 3)
    expect(sampleGround(tiles, DEM_ZOOM, ...at(100.75, 200.5))).toBeCloseTo(2100.25, 3)
    expect(sampleGround(tiles, DEM_ZOOM, ...at(100.5, 201))).toBeCloseTo(2105, 3)
    // The edge pixels stand for the half pixel beyond them; another tile is unknown, as is this one at another level.
    expect(sampleGround(tiles, DEM_ZOOM, ...at(0.2, 0.2))).toBeCloseTo(0, 3)
    expect(sampleGround(tiles, DEM_ZOOM, ...at(DEM_SIZE - 0.2, DEM_SIZE - 0.2))).toBeCloseTo(11 * (DEM_SIZE - 1), 3)
    expect(sampleGround(tiles, DEM_ZOOM, ...at(-1, 10))).toBeNaN()
    expect(sampleGround(tiles, DEM_ZOOM - 1, ...at(100.5, 200.5))).toBeNaN()
  })

  it('reads a big node off at most two by two tiles, at the deepest level that allows', () => {
    const centre = { lng: 24.7453, lat: 59.4372 }
    const tileOf = ({ lng, lat }: { lng: number; lat: number }, zoom: number) => {
      const n = 2 ** zoom
      return [Math.floor(((lng + 180) / 360) * n), Math.floor(((1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2) * n)]
    }
    const rim = (radius: number, zoom: number) => [[radius, 0], [-radius, 0], [0, radius], [0, -radius]].map(([east, north]) => tileOf(moveMetres(centre, east, north), zoom))
    let last = DEM_ZOOM
    // A tile is about 5 km across here at the deepest level.
    for (const radius of [1, 2000, 6000, 20_000, 60_000]) {
      const { zoom, keys } = tilesAround(centre.lng, centre.lat, radius)
      expect(zoom).toBeLessThanOrEqual(last)
      last = zoom
      expect(keys.length).toBeLessThanOrEqual(4)
      for (const [x, y] of rim(0.95 * radius, zoom)) expect(keys).toContain(`${zoom}/${x}/${y}`)
      if (zoom === DEM_ZOOM) continue
      const deeper = rim(1.05 * radius, zoom + 1)
      const span = (axis: number) => Math.max(...deeper.map((t) => t[axis])) - Math.min(...deeper.map((t) => t[axis]))
      expect(Math.max(span(0), span(1))).toBeGreaterThan(1)
    }
    expect(tilesAround(centre.lng, centre.lat, 2000).zoom).toBe(DEM_ZOOM)
    expect(last).toBeLessThan(DEM_ZOOM - 2)
  })
})

describe('terrain tiles read for a model node', () => {
  /** A fresh dem.ts, in a worker whose canvas reads back what was written to it, plus `noise`. */
  function freshDem(noise = 0) {
    vi.resetModules()
    vi.stubGlobal(
      'OffscreenCanvas',
      class {
        written = new Uint8ClampedArray(0)
        getContext() {
          return {
            createImageData: (width: number, height: number) => ({ data: new Uint8ClampedArray(width * height * 4) }),
            putImageData: ({ data }: { data: Uint8ClampedArray }) => (this.written = data.slice()),
            getImageData: () => ({ data: this.written.map((value) => value + noise) }),
          }
        }
      },
    )
    return import('../../src/map/city/dem')
  }

  /** Tile requests left unanswered; answering one says there is no tile, as for open sea. */
  function fetchLater(): { url: string; answer: () => void }[] {
    const open: { url: string; answer: () => void }[] = []
    vi.stubGlobal('fetch', (url: string) => new Promise((done) => open.push({ url, answer: () => done(new Response(null, { status: 404 })) })))
    return open
  }

  const tick = () => new Promise((done) => setTimeout(done, 0))
  const node = (lng: number, lat: number, half: number): NodeBox => ({ center: [lng, lat, 30], halfSize: [half, half, 10], quaternion: [0, 0, 0, 1] })

  afterEach(() => vi.unstubAllGlobals())

  it('reads a few tiles at a time for every node together, each once', async () => {
    const dem = await freshDem()
    const open = fetchLater()
    const nodes = [node(25.5, 58.7, 15_000), node(26.2, 59.1, 2500), node(24.1, 57.0, 2500)]
    const wanted = nodes.flatMap((obb) => dem.tilesAround(obb.center[0], obb.center[1], boxRadius(obb, 4326)).keys)
    expect(wanted.length).toBeGreaterThan(4)
    const grounds = Promise.all(nodes.map((obb) => dem.groundUnder(obb, 4326)))
    const asked: string[] = []
    for (let answered = 0; answered < wanted.length; answered++) {
      await tick()
      expect(open.length).toBe(Math.min(4, wanted.length - answered))
      const { url, answer } = open.shift()!
      asked.push(url)
      answer()
    }
    expect(asked.sort()).toEqual(wanted.map((key) => `${TILE_ORIGINS.mapterhorn}/${key}.webp`).sort())
    for (const ground of await grounds) expect(ground!(25.5, 58.7)).toBeNaN()
    // The last node's tiles are still kept, the first node's rural ones coarser than the deepest level.
    expect(await dem.groundUnder(nodes[2], 4326)).toBeTypeOf('function')
    expect(open).toHaveLength(0)
    expect(asked.filter((url) => !url.startsWith(`${TILE_ORIGINS.mapterhorn}/${DEM_ZOOM}/`)).length).toBeGreaterThan(0)
  })

  it('leaves the buildings on their lowest points where the canvas alters what it reads back and nothing else can read it', async () => {
    const dem = await freshDem(1)
    const open = fetchLater()
    expect(typeof VideoFrame).toBe('undefined')
    expect(await dem.groundUnder(node(24.1, 57.0, 100), 4326)).toBeNull()
    expect(open).toHaveLength(0)
  })
})

describe('city catalogue', () => {
  const catalogue: CityCatalogue = JSON.parse(readFileSync(new URL('../../public/data/city-3d.json', import.meta.url), 'utf8'))

  it('bakes the leaves of every big layer, each within its layer', () => {
    const indexed = catalogue.buildings.filter((layer) => layer.leaves)
    expect(indexed.map((layer) => layer.name)).toContain('Eesti')
    for (const layer of indexed) {
      const rows: BakedLeaf[] = JSON.parse(readFileSync(new URL(`../../public${layer.leaves}`, import.meta.url), 'utf8'))
      expect(rows.length, layer.name).toBeGreaterThan(100)
      const [west, south, east, north] = layer.bbox
      const odd = rows.filter(
        (leaf) => leaf.length !== 6 || !leaf.every(Number.isFinite) || leaf[1] < west || leaf[1] > east || leaf[2] < south || leaf[2] > north || leaf[4] <= 0 || leaf[5] <= 0,
      )
      expect(odd, layer.name).toEqual([])
    }
  })
})
