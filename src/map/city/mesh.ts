/**
 * The city's geometry, decoded and built from what the servers send: a vector tile's buildings
 * extruded, a node of Rīga's city model, a node of its trees. Plain functions over bytes and
 * JSON, run in the city worker. Every result is placed as the renderer expects: positions in
 * metres east, north and up from an origin given in Mercator, worked out in float64 and only
 * then stored as float32.
 */
import { VectorTile, classifyRings } from '@mapbox/vector-tile'
import earcut from 'earcut'
import { PbfReader } from 'pbf'
import type { ExtrudedTile, ModelCrs, ModelNode, NodeBox, TreeNode } from './types'

/** MapLibre's own figure, so that a metre here is a metre to its camera and its extrusions. */
const EARTH_CIRCUMFERENCE = 2 * Math.PI * 6371008.8

/** Half the width of the Web Mercator square, in EPSG:3857 metres. */
const HALF_WORLD = 20037508.342789244

export function mercatorX(lon: number): number {
  return (180 + lon) / 360
}

export function mercatorY(lat: number): number {
  return (180 - (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))) / 360
}

/** One metre in Mercator units at a latitude, as MapLibre's meterInMercatorCoordinateUnits has it. */
export function metreScale(lat: number): number {
  return 1 / EARTH_CIRCUMFERENCE / Math.cos((lat * Math.PI) / 180)
}

function latitudeOf(y: number): number {
  return (360 / Math.PI) * Math.atan(Math.exp(((180 - y * 360) * Math.PI) / 180)) - 90
}

/** Mercator x of a coordinate in the city model's CRS: degrees, or Web Mercator metres. */
function crsX(crs: ModelCrs, x: number): number {
  return crs === 4326 ? mercatorX(x) : (x + HALF_WORLD) / (2 * HALF_WORLD)
}

function crsY(crs: ModelCrs, y: number): number {
  return crs === 4326 ? mercatorY(y) : (HALF_WORLD - y) / (2 * HALF_WORLD)
}

/** The CSS names OpenStreetMap's mappers give building:colour, plus the two they use that CSS lacks. */
const NAMED_COLOURS: Record<string, string> = {
  white: '#ffffff',
  black: '#000000',
  grey: '#808080',
  gray: '#808080',
  lightgrey: '#d3d3d3',
  lightgray: '#d3d3d3',
  darkgrey: '#a9a9a9',
  darkgray: '#a9a9a9',
  silver: '#c0c0c0',
  red: '#ff0000',
  darkred: '#8b0000',
  brown: '#a52a2a',
  maroon: '#800000',
  orange: '#ffa500',
  yellow: '#ffff00',
  beige: '#f5f5dc',
  tan: '#d2b48c',
  green: '#008000',
  darkgreen: '#006400',
  blue: '#0000ff',
  darkblue: '#00008b',
  navy: '#000080',
  pink: '#ffc0cb',
  purple: '#800080',
  ivory: '#fffff0',
  khaki: '#f0e68c',
  cream: '#fffdd0',
  sandybrown: '#f4a460',
  peru: '#cd853f',
  sienna: '#a0522d',
  salmon: '#fa8072',
  terracotta: '#e2725b',
  wheat: '#f5deb3',
}

/** A mapped colour as red, green and blue, 0-255; null for anything not understood. */
export function parseColour(value: unknown): [number, number, number] | null {
  if (typeof value !== 'string') return null
  const text = value.trim().toLowerCase()
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(Object.hasOwn(NAMED_COLOURS, text) ? NAMED_COLOURS[text] : text)?.[1]
  if (!hex) return null
  const digits = hex.length === 3 ? hex.replace(/./g, '$&$&') : hex
  return [parseInt(digits.slice(0, 2), 16), parseInt(digits.slice(2, 4), 16), parseInt(digits.slice(4, 6), 16)]
}

/** Signed area and area-weighted centre of a ring in a flat x, y list, from one point to before another. Positive runs anticlockwise. */
function ringShape(flat: number[], from: number, to: number): [number, number, number] {
  let area = 0
  let x = 0
  let y = 0
  for (let i = from, j = to - 1; i < to; j = i++) {
    const cross = flat[2 * j] * flat[2 * i + 1] - flat[2 * i] * flat[2 * j + 1]
    area += cross
    x += (flat[2 * j] + flat[2 * i]) * cross
    y += (flat[2 * j + 1] + flat[2 * i + 1]) * cross
  }
  return [area / 2, x / (3 * area), y / (3 * area)]
}

/**
 * The buildings of one OpenFreeMap vector tile as solid blocks: a flat roof at each building's
 * height, and walls down to where it starts. The tiles merge every building of the same height
 * and colour into one feature, so each polygon in a feature is taken as one building.
 */
export function extrudeTile(data: ArrayBuffer | Uint8Array, z: number, x: number, y: number): ExtrudedTile {
  const origin: [number, number] = [x / 2 ** z, y / 2 ** z]
  const scale = metreScale(latitudeOf(origin[1]))
  const layer = new VectorTile(new PbfReader(data)).layers.building
  const extent = layer?.extent ?? 4096
  // Mercator runs straight across a tile, so tile units become metres by one factor. The tile's
  // y grows south, the local y north.
  const metres = 1 / (extent * 2 ** z * scale)

  // The buildings first, and how many corners they have, so that each array is made once.
  const kept: { rings: { x: number; y: number }[][]; height: number; base: number; colour: number[] }[] = []
  let corners = 0
  for (let f = 0; f < (layer?.length ?? 0); f++) {
    const feature = layer.feature(f)
    const { hide_3d, render_height, render_min_height, colour } = feature.properties
    // An outline whose parts are mapped and drawn as buildings of their own.
    if (hide_3d === true || feature.type !== 3) continue
    const height = Number(render_height) || 0
    const base = Number(render_min_height) || 0
    const rgb = parseColour(colour)
    const rgba = rgb ? [...rgb, 255] : [Math.min(255, Math.round(height)), 0, 0, 0]
    for (const polygon of classifyRings(feature.loadGeometry())) {
      // Rings arrive closed, their first point repeated at the end.
      const rings = polygon.map((ring) => (ring.length > 1 && ring[0].equals(ring[ring.length - 1]) ? ring.slice(0, -1) : ring))
      const outer = rings[0]
      // A building wholly in the tile's buffer is drawn whole by the tile next door, as MapLibre does.
      if (outer.length < 3 || outer.every((p) => p.x < 0) || outer.every((p) => p.x > extent) || outer.every((p) => p.y < 0) || outer.every((p) => p.y > extent)) continue
      kept.push({ rings, height, base, colour: rgba })
      for (const ring of rings) corners += ring.length
    }
  }

  // Each corner is a corner of the roof and starts at most one wall of four. A roof of n corners
  // and h holes is n + 2h - 2 triangles, under 5n / 3 as a hole has three corners at least.
  const positions = new Float32Array(corners * 15)
  const colors = new Uint8Array(corners * 20)
  const indices = new Uint32Array(corners * 11)
  const polygons = new Float32Array(kept.length * 6)
  let vertexCount = 0
  let indexCount = 0
  let polygonCount = 0
  let colour = [0, 0, 0, 0]
  const vertex = (vx: number, vy: number, vz: number): number => {
    positions[vertexCount * 3] = vx
    positions[vertexCount * 3 + 1] = vy
    positions[vertexCount * 3 + 2] = vz
    for (let c = 0; c < 4; c++) colors[vertexCount * 4 + c] = colour[c]
    return vertexCount++
  }
  for (const building of kept) {
    const { rings, height, base } = building
    colour = building.colour
    const flat: number[] = []
    const holes: number[] = []
    for (const ring of rings) {
      if (ring !== rings[0]) holes.push(flat.length / 2)
      for (const p of ring) flat.push(p.x * metres, -p.y * metres)
    }
    const [area, centreX, centreY] = ringShape(flat, 0, rings[0].length)
    if (Math.abs(area) < 1) continue

    const firstVertex = vertexCount
    const firstIndex = indexCount
    for (let i = 0; i < flat.length; i += 2) vertex(flat[i], flat[i + 1], height)
    for (const i of earcut(flat, holes)) indices[indexCount++] = firstVertex + i

    // Walls get corners of their own, apart from the roof's, so each face can be shaded flat.
    let start = 0
    for (let r = 0; r < rings.length; r++) {
      const ring = rings[r]
      const end = start + ring.length
      // Faces turned outwards: away from the building round its outline, into the courtyard round a hole.
      const turn = ringShape(flat, start, end)[0] > 0 === (r === 0)
      for (let k = 0; k < ring.length; k++) {
        const a = ring[k]
        const b = ring[(k + 1) % ring.length]
        // Where the tile's buffer cut a building, the cut is not a wall: MapLibre's isBoundaryEdge.
        if ((a.x === b.x && (a.x < 0 || a.x > extent)) || (a.y === b.y && (a.y < 0 || a.y > extent))) continue
        const i = 2 * (start + k)
        const j = 2 * (start + ((k + 1) % ring.length))
        const v = vertex(flat[i], flat[i + 1], base)
        vertex(flat[j], flat[j + 1], base)
        vertex(flat[j], flat[j + 1], height)
        vertex(flat[i], flat[i + 1], height)
        // Two triangles, v v+1 v+2 and v v+2 v+3, or the same the other way round.
        indices[indexCount++] = v
        indices[indexCount++] = turn ? v + 1 : v + 2
        indices[indexCount++] = turn ? v + 2 : v + 1
        indices[indexCount++] = v
        indices[indexCount++] = turn ? v + 2 : v + 3
        indices[indexCount++] = turn ? v + 3 : v + 2
      }
      start = end
    }
    polygons.set([firstIndex, indexCount - firstIndex, centreX, centreY, firstVertex, vertexCount - firstVertex], 6 * polygonCount++)
  }
  return {
    kind: 'extruded',
    origin,
    scale,
    positions: positions.slice(0, vertexCount * 3),
    colors: colors.slice(0, vertexCount * 4),
    indices: indices.slice(0, indexCount),
    polygons: polygons.slice(0, polygonCount * 6),
  }
}

/**
 * One node of Rīga's city model: I3S geometry buffer 0, uncompressed. After a count of vertices
 * and of features come whole arrays one after another: positions, normals, texture coordinates
 * and colours per vertex, then an id and a range of triangles per feature. Only the positions and
 * the ranges are wanted: the normals are worked out again when drawn, and the colours are all
 * the same grey.
 */
export function decodeModelNode(data: ArrayBuffer, obb: NodeBox, crs: ModelCrs): ModelNode {
  const view = new DataView(data)
  const vertexCount = data.byteLength >= 8 ? view.getUint32(0, true) : 0
  const featureCount = data.byteLength >= 8 ? view.getUint32(4, true) : 0
  // 36 bytes a vertex: position 12, normal 12, texture 8, colour 4. 16 a feature: id 8, range 8.
  if (data.byteLength < 8 + vertexCount * 36 + featureCount * 16 || vertexCount % 3 !== 0) {
    throw new Error(`A model node of ${data.byteLength} bytes cannot hold the ${vertexCount} vertices and ${featureCount} features it claims`)
  }
  const source = new Float32Array(data, 8, vertexCount * 3)
  const ranges = new Uint32Array(data, 8 + vertexCount * 36 + featureCount * 8, featureCount * 2)

  // Positions are offsets from the centre of the node's box: degrees or Mercator metres across, metres up.
  const [centreX, centreY] = obb.center
  const origin: [number, number] = [crsX(crs, centreX), crsY(crs, centreY)]
  const scale = metreScale(latitudeOf(origin[1]))
  const positions = new Float32Array(vertexCount * 3)
  let ground = Infinity
  for (let v = 0; v < vertexCount; v++) {
    positions[3 * v] = (crsX(crs, centreX + source[3 * v]) - origin[0]) / scale
    positions[3 * v + 1] = (origin[1] - crsY(crs, centreY + source[3 * v + 1])) / scale
    ground = Math.min(ground, source[3 * v + 2])
  }
  // Heights are above sea level. Each building is set down at its own lowest point, so it stands
  // on the map's ground; anything outside every building goes down with the node's lowest.
  for (let v = 0; v < vertexCount; v++) positions[3 * v + 2] = source[3 * v + 2] - ground

  const buildings = new Float32Array(featureCount * 7)
  for (let f = 0; f < featureCount; f++) {
    const first = ranges[2 * f] * 3
    const end = (ranges[2 * f + 1] + 1) * 3
    if (first >= end || end > vertexCount) throw new Error(`A model node's feature ${f} covers triangles it does not have`)
    let bottom = Infinity
    let top = -Infinity
    let west = Infinity
    let south = Infinity
    let east = -Infinity
    let north = -Infinity
    for (let v = first; v < end; v++) {
      bottom = Math.min(bottom, source[3 * v + 2])
      top = Math.max(top, source[3 * v + 2])
      west = Math.min(west, positions[3 * v])
      east = Math.max(east, positions[3 * v])
      south = Math.min(south, positions[3 * v + 1])
      north = Math.max(north, positions[3 * v + 1])
    }
    for (let v = first; v < end; v++) positions[3 * v + 2] = source[3 * v + 2] - bottom
    buildings.set([first, end - first, west, south, east, north, top - bottom], f * 7)
  }
  return { kind: 'model', origin, scale, positions, buildings }
}

/**
 * An I3S attribute buffer's values: a count, then the values. Float64 values start at byte 8,
 * after four bytes that keep them aligned; Float32 ones at byte 4. Rīga's tree layers store
 * heights both ways, so the length tells which. Values that do not match the features one for
 * one cannot be matched to them at all.
 */
function attributeValues(data: ArrayBuffer | null, count: number): ArrayLike<number> | null {
  if (!data || data.byteLength < 4 || new DataView(data).getUint32(0, true) !== count) return null
  if (data.byteLength === 8 + 8 * count) return new Float64Array(data, 8, count)
  if (data.byteLength === 4 + 4 * count) return new Float32Array(data, 4, count)
  return null
}

/**
 * An I3S string attribute buffer's values: a count and the byte length of all the values together,
 * then each value's byte length, then the values one after another, each closed by a zero byte.
 * Null when the buffer does not hold what it claims, as when the service answers with an error.
 * Read on the main thread, for the one building clicked.
 */
export function attributeStrings(data: ArrayBuffer): string[] | null {
  if (data.byteLength < 8) return null
  const view = new DataView(data)
  const count = view.getUint32(0, true)
  let at = 8 + 4 * count
  if (at > data.byteLength) return null
  const decoder = new TextDecoder()
  const values: string[] = []
  for (let i = 0; i < count; i++) {
    const length = view.getUint32(8 + 4 * i, true)
    if (at + length > data.byteLength) return null
    values.push(decoder.decode(new Uint8Array(data, at, length)).replace(/\0$/, ''))
    at += length
  }
  return values
}

/**
 * One node of a tree layer: a point per tree, and its height from the node's attributes, which
 * list the trees in the same order. A tree without a height is drawn at a usual one.
 */
export function decodeTrees(features: unknown, heights: ArrayBuffer | null, crs: ModelCrs): TreeNode {
  const rows = (features as { featureData?: unknown } | null)?.featureData
  if (!Array.isArray(rows)) throw new Error('A tree node came without its featureData list')
  const positionOf = (row: unknown): number[] | null => {
    const position = (row as { position?: unknown } | null)?.position
    return Array.isArray(position) && Number.isFinite(position[0]) && Number.isFinite(position[1]) ? position : null
  }
  // [0, 0] in either CRS is the middle of the map, which keeps an empty node's numbers finite.
  const [startX, startY] = rows.map(positionOf).find((p) => p) ?? [0, 0]
  const origin: [number, number] = [crsX(crs, startX), crsY(crs, startY)]
  const scale = metreScale(latitudeOf(origin[1]))
  const values = attributeValues(heights, rows.length)
  const trees: number[] = []
  rows.forEach((row, i) => {
    const p = positionOf(row)
    if (!p) return
    const height = values ? values[i] : NaN
    trees.push((crsX(crs, p[0]) - origin[0]) / scale, (origin[1] - crsY(crs, p[1])) / scale, height > 0 ? Math.min(60, Math.max(1, height)) : 8)
  })
  return { kind: 'trees', origin, scale, trees: new Float32Array(trees) }
}
