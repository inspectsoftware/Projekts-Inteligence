/**
 * The ground under the city models, from Mapterhorn's terrain tiles: the tiles the relief is
 * drawn from (src/map/relief.ts), read again in the city worker so that a building stands on the
 * street and not on the floor of its basement. Only decoding a tile needs the browser; finding
 * and sampling the tiles is plain arithmetic, tested on its own. Runs in the worker: nothing here
 * may pull in the map's own modules, which bring the page's translations with them.
 */
import { TILE_ORIGINS } from '../../../shared/origins'
import { boxCentre, boxRadius } from './sources'
import type { ModelCrs, NodeBox } from './types'

/** The deepest level the terrain has, as the relief asks for it: a pixel is about 10 m at 60° N. */
export const DEM_ZOOM = 12
/** Pixels across a tile. */
export const DEM_SIZE = 512
/** MapLibre's figure for the Earth, as in mesh.ts. */
const EARTH_CIRCUMFERENCE = 2 * Math.PI * 6371008.8
/** Decoded tiles kept, a mebibyte each: two nodes' worth at most, and a city's nodes share a few between them. */
const KEPT = 8
/** Tiles read at once, for every node together. */
const FETCHING = 4

/**
 * Heights in metres from a terrarium tile's pixels, given as red, green, blue and alpha each, or
 * as blue, green, red and alpha where `bgr` says so, as a video frame may hold them.
 */
export function terrariumHeights(pixels: ArrayLike<number>, bgr = false): Float32Array {
  const [red, blue] = bgr ? [2, 0] : [0, 2]
  const heights = new Float32Array(pixels.length / 4)
  for (let i = 0; i < heights.length; i++) heights[i] = pixels[4 * i + red] * 256 + pixels[4 * i + 1] + pixels[4 * i + blue] / 256 - 32768
  return heights
}

/** Where a point falls at `zoom`, in pixels across the whole world from its north-west corner. */
function worldPixel(lon: number, lat: number, zoom: number): [number, number] {
  const n = 2 ** zoom * DEM_SIZE
  return [((lon + 180) / 360) * n, ((1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2) * n]
}

/**
 * The tiles within `radius` metres of a point, as "z/x/y", at the deepest level where they make
 * at most two by two. A rural node can be kilometres across: it is grounded on coarser terrain
 * rather than on dozens of tiles, and mesh.ts still refuses terrain that fits its buildings badly.
 */
export function tilesAround(lon: number, lat: number, radius: number): { zoom: number; keys: string[] } {
  for (let zoom = DEM_ZOOM; ; zoom--) {
    const [px, py] = worldPixel(lon, lat, zoom)
    const reach = (radius * 2 ** zoom * DEM_SIZE) / (EARTH_CIRCUMFERENCE * Math.cos((lat * Math.PI) / 180))
    const [west, east, north, south] = [px - reach, px + reach, py - reach, py + reach].map((p) => Math.floor(p / DEM_SIZE))
    if (zoom > 0 && (east - west > 1 || south - north > 1)) continue
    const keys: string[] = []
    for (let x = west; x <= east; x++) for (let y = north; y <= south; y++) keys.push(`${zoom}/${x}/${y}`)
    return { zoom, keys }
  }
}

/**
 * The ground at a point, between the four pixel centres around it, or NaN where its tile is
 * missing. Within half a pixel of a tile's edge the edge pixels stand in for the next tile's.
 */
export function sampleGround(tiles: Map<string, Float32Array | null>, zoom: number, lon: number, lat: number): number {
  const [px, py] = worldPixel(lon, lat, zoom)
  const tx = Math.floor(px / DEM_SIZE)
  const ty = Math.floor(py / DEM_SIZE)
  const heights = tiles.get(`${zoom}/${tx}/${ty}`)
  if (!heights) return NaN
  // A pixel's height belongs to its centre, half a pixel in.
  const x = Math.min(Math.max(px - tx * DEM_SIZE - 0.5, 0), DEM_SIZE - 1)
  const y = Math.min(Math.max(py - ty * DEM_SIZE - 0.5, 0), DEM_SIZE - 1)
  const x0 = Math.min(Math.floor(x), DEM_SIZE - 2)
  const y0 = Math.min(Math.floor(y), DEM_SIZE - 2)
  const fx = x - x0
  const fy = y - y0
  const at = (dx: number, dy: number) => heights[(y0 + dy) * DEM_SIZE + x0 + dx]
  return (at(0, 0) * (1 - fx) + at(1, 0) * fx) * (1 - fy) + (at(0, 1) * (1 - fx) + at(1, 1) * fx) * fy
}

let distorted: boolean | undefined

/**
 * Whether this browser alters the pixels a canvas reads back, as some do against fingerprinting:
 * the heights would come out wrong. Asked once, as MapLibre does, by writing known pixels and
 * reading them again.
 */
function canvasDistorted(): boolean {
  if (distorted === undefined) {
    const context = new OffscreenCanvas(5, 5).getContext('2d', { willReadFrequently: true })!
    const probe = context.createImageData(5, 5)
    for (let i = 0; i < probe.data.length; i++) probe.data[i] = i % 4 === 3 ? 255 : i * 2
    context.putImageData(probe, 0, 0)
    distorted = context.getImageData(0, 0, 5, 5).data.some((value, i) => value !== probe.data[i])
  }
  return distorted
}

/** A terrarium WebP's heights: the one step that needs the browser. */
async function decode(blob: Blob): Promise<Float32Array> {
  // The colours are numbers, so none of them may be corrected on the way.
  const bitmap = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' })
  try {
    if (bitmap.width !== DEM_SIZE || bitmap.height !== DEM_SIZE) throw new Error(`A terrain tile of ${bitmap.width} × ${bitmap.height} pixels`)
    if (!canvasDistorted()) {
      const context = new OffscreenCanvas(DEM_SIZE, DEM_SIZE).getContext('2d')!
      context.drawImage(bitmap, 0, 0)
      return terrariumHeights(context.getImageData(0, 0, DEM_SIZE, DEM_SIZE).data)
    }
    // A video frame's pixels are copied as they are. Asking it for RGBA instead would be quietly
    // ignored by a browser that cannot convert, so the order is read from its format.
    const frame = new VideoFrame(bitmap, { timestamp: 0 })
    try {
      const format = frame.format ?? ''
      if (!/^(RGB|BGR)/.test(format)) throw new Error(`A terrain tile in pixel format ${format}`)
      const pixels = new Uint8Array(DEM_SIZE * DEM_SIZE * 4)
      await frame.copyTo(pixels)
      return terrariumHeights(pixels, format.startsWith('BGR'))
    } finally {
      frame.close()
    }
  } finally {
    bitmap.close()
  }
}

let fetching = 0
const waiting: (() => void)[] = []

/** Runs `task` once fewer than FETCHING others are running; a finished one hands its turn on. */
async function inTurn<T>(task: () => Promise<T>): Promise<T> {
  if (fetching < FETCHING) fetching++
  else await new Promise<void>((go) => waiting.push(go))
  try {
    return await task()
  } finally {
    const next = waiting.shift()
    if (next) next()
    else fetching--
  }
}

/** Tiles read or being read, the most recently asked for last. */
const kept = new Map<string, Promise<Float32Array | null>>()

function tile(key: string): Promise<Float32Array | null> {
  let heights = kept.get(key)
  if (heights) kept.delete(key)
  else {
    heights = inTurn(async () => {
      const res = await fetch(`${TILE_ORIGINS.mapterhorn}/${key}.webp`)
      // Open sea has no tile.
      if (res.status === 404) return null
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return decode(await res.blob())
    })
    // A tile that failed is asked for again by the next node.
    heights.catch(() => kept.delete(key))
  }
  kept.set(key, heights)
  return heights
}

/**
 * The ground under a model node as a function of longitude and latitude, once the tiles the node
 * covers are read; null when they cannot be, and the node's buildings stand on their own lowest
 * points as before.
 */
export async function groundUnder(obb: NodeBox, crs: ModelCrs): Promise<((lon: number, lat: number) => number) | null> {
  const { lng, lat } = boxCentre(obb, crs)
  try {
    // Altered pixels and no other way to read them: no terrain rather than wrong terrain.
    if (canvasDistorted() && typeof VideoFrame === 'undefined') return null
    const { zoom, keys } = tilesAround(lng, lat, boxRadius(obb, crs))
    const asked = Promise.all(keys.map(tile))
    // The oldest go, but never one this node is reading.
    for (const key of kept.keys()) if (kept.size > KEPT && !keys.includes(key)) kept.delete(key)
    const heights = await asked
    const tiles = new Map(keys.map((key, i) => [key, heights[i]]))
    return (lon, lat) => sampleGround(tiles, zoom, lon, lat)
  } catch (err) {
    console.warn('[city] terrain unavailable, so each building stands on its lowest point:', err)
    return null
  }
}
