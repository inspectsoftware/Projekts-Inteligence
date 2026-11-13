import { existsSync, readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { SERVER_DIR } from '../paths'
import { ROAD_FIXES } from './fixes'
import type { RoadNode, RoadWay } from './lanes.mjs'

/**
 * The roads of the Baltic states as scripts/extract-roads.mjs leaves them: cut into z12 squares
 * (about 5 km), one gzipped NDJSON file each, in roads/ (or ROADS_DIR). Not in git: built by hand
 * from the same OSM extract as the tiles and the navigator.
 */
export const BUCKET_ZOOM = 12

export type BBox = [number, number, number, number]

/** The roads folder, if it has been built. */
export function findRoadsDir(env: Record<string, string | undefined> = process.env): string | null {
  const dirs = env.ROADS_DIR ? [env.ROADS_DIR] : [resolve(SERVER_DIR, '../roads'), resolve(SERVER_DIR, '../../roads'), resolve(SERVER_DIR, '../../../roads')]
  return dirs.find((d) => existsSync(join(d, 'meta.json'))) ?? null
}

/** When the roads were built: tiles made from older ones are made again. */
export function roadsStamp(dir: string): string {
  try {
    return String((JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8')) as { built?: string }).built ?? '').replace(/\D/g, '').slice(0, 14)
  } catch {
    return '0'
  }
}

const tileX = (lon: number, z: number) => Math.floor(((lon + 180) / 360) * 2 ** z)
const tileY = (lat: number, z: number) => {
  const r = (lat * Math.PI) / 180
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z)
}

/** The file name of the square a point is in, as scripts/roads/buckets.mjs names it. */
export const bucketKey = ([lon, lat]: [number, number]): string => `${tileX(lon, BUCKET_ZOOM)}-${tileY(lat, BUCKET_ZOOM)}`

interface Bucket {
  ways: RoadWay[]
  nodes: RoadNode[]
}
/** The squares read lately, kept: a tile and its neighbours read the same few. */
const held = new Map<string, Promise<Bucket>>()
const HOLD = 24

function bucket(dir: string, x: number, y: number): Promise<Bucket> {
  const key = `${dir}|${x}-${y}`
  const have = held.get(key)
  if (have) {
    held.delete(key)
    held.set(key, have)
    return have
  }
  const job = readFile(join(dir, String(BUCKET_ZOOM), `${x}-${y}.ndjson.gz`))
    .then((gz) => {
      const out: Bucket = { ways: [], nodes: [] }
      for (const line of gunzipSync(gz).toString('utf8').split('\n')) {
        if (!line) continue
        const o = JSON.parse(line) as RoadWay | RoadNode
        if ('coords' in o) {
          const fix = ROAD_FIXES[o.id]
          if (fix) Object.assign(o.tags, fix)
          out.ways.push(o)
        } else out.nodes.push(o)
      }
      return out
    })
    .catch(() => ({ ways: [], nodes: [] }))
  held.set(key, job)
  while (held.size > HOLD) held.delete(held.keys().next().value!)
  return job
}

/** Every road with a point in the box or crossing it, and the tagged nodes on them. */
export async function roadsIn(dir: string, [w, s, e, n]: BBox): Promise<{ ways: RoadWay[]; nodes: RoadNode[] }> {
  const ways = new Map<number, RoadWay>()
  const nodes = new Map<number, RoadNode>()
  for (let x = tileX(w, BUCKET_ZOOM); x <= tileX(e, BUCKET_ZOOM); x++) {
    for (let y = tileY(n, BUCKET_ZOOM); y <= tileY(s, BUCKET_ZOOM); y++) {
      const b = await bucket(dir, x, y)
      for (const way of b.ways) {
        if (ways.has(way.id)) continue
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
        for (const [lon, lat] of way.coords) {
          x0 = Math.min(x0, lon)
          x1 = Math.max(x1, lon)
          y0 = Math.min(y0, lat)
          y1 = Math.max(y1, lat)
        }
        if (x1 >= w && x0 <= e && y1 >= s && y0 <= n) ways.set(way.id, way)
      }
      for (const node of b.nodes) nodes.set(node.node, node)
    }
  }
  const used = new Set([...ways.values()].flatMap((wy) => wy.nodes))
  return { ways: [...ways.values()], nodes: [...nodes.values()].filter((nd) => used.has(nd.node)) }
}
