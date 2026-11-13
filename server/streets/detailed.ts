import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { gunzipSync, gzipSync } from 'node:zlib'
import type { Feature, FeatureCollection, Polygon, Position } from 'geojson'
import { CACHE_DIR } from '../core/disk'
import { FIXES_STAMP } from './fixes'
import { buildRoads } from './lanes.mjs'
import { paintNear } from './paint.mjs'
import { type BBox, findRoadsDir, roadsIn, roadsStamp } from './roads'

/**
 * Which builder draws the streets: 'rules' (lanes.mjs, the default) or 'photo', the prototype in
 * prototype/lanes-photo.mjs, which also reads the LĢIA orthophoto of each tile (Latvia only) to fit
 * kerbs and tell chevrons, grass and islands apart. STREETS_BUILDER=photo turns the prototype on.
 */
const BUILDER = process.env.STREETS_BUILDER === 'photo' ? 'photo' : 'rules'
/** Whether the rules builder puts its islands' edges on the paint the LĢIA orthophoto shows (Latvia). Off until it is reliable: STREETS_PAINT=1 turns it on. */
const PAINT = process.env.STREETS_PAINT === '1' && !process.env.VITEST

/**
 * Streets as they lie on the ground, lane by lane, built by our lane builder (lanes.mjs) from the
 * roads of the Baltic states in roads/ (scripts/extract-roads.mjs): every carriageway as wide as its
 * lanes, the paint on it, junctions paved across with their kerbs rounded, slip roads leaving and
 * joining on their own side, arrows, stop lines, zebras, and the islands mappers drew. A tile at a
 * time (z15, about 670 m square), built from the roads 300 m round it so a junction on its edge is
 * whole, and kept on disk until the roads are built again.
 */

/** The zoom the streets are cut and kept at. */
export const STREETS_TILE_ZOOM = 15
/** Room round a tile, degrees of longitude (about 300 m at Rīga; half as many of latitude). */
const MARGIN = 0.005
/** Raised when what a tile holds changes, so tiles kept from before are built afresh. */
const FORMAT = 24
/** Kept apart from the transit lines' streets (server/transit/streets.ts), which share the folder above. */
const DIR = join(CACHE_DIR, 'streets', 'lanes')

/** A tile's bounds: west, south, east, north. */
export function tileBounds(z: number, x: number, y: number): BBox {
  const lon = (x: number) => (x / 2 ** z) * 360 - 180
  const lat = (y: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** z))) * 180) / Math.PI
  return [lon(x), lat(y + 1), lon(x + 1), lat(y)]
}

/** Where a feature belongs: the middle of its outline, so a road two tiles both build is kept by one. */
function anchor(f: Feature): Position {
  const g = f.geometry
  const pts: Position[] = g.type === 'Point' ? [g.coordinates] : g.type === 'LineString' ? g.coordinates : g.type === 'Polygon' ? g.coordinates[0] : []
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const [x, y] of pts) {
    x0 = Math.min(x0, x)
    x1 = Math.max(x1, x)
    y0 = Math.min(y0, y)
    y1 = Math.max(y1, y)
  }
  return [(x0 + x1) / 2, (y0 + y1) / 2]
}

/** A tile's streets, from the roads in `dir`. */
export async function buildTile(dir: string, z: number, x: number, y: number): Promise<FeatureCollection> {
  const bounds = tileBounds(z, x, y)
  const [w, s, e, n] = bounds
  const { ways, nodes } = await roadsIn(dir, [w - MARGIN, s - MARGIN / 2, e + MARGIN, n + MARGIN / 2])
  let fc: FeatureCollection
  if (BUILDER === 'photo') {
    const proto = await import('./prototype/lanes-photo.mjs')
    const extra = await proto.extra(bounds)
    fc = proto.buildRoads([...ways, ...(extra.ways ?? [])], nodes, bounds)
    if (extra.features) fc.features.push(...extra.features)
  } else {
    fc = buildRoads(ways, nodes, bounds)
    // Then again with the photo's paint round the islands where roads part and join, their edges put on the
    // lines painted there (Latvia; STREETS_PAINT=1 turns it on).
    if (PAINT) {
      const M = 0.0007
      const boxes = fc.features
        .filter((f) => f.properties?.kind === 'gore' && f.geometry.type === 'Polygon')
        .map((f) => {
          const ring = (f.geometry as Polygon).coordinates[0]
          const xs = ring.map((p) => p[0]), ys = ring.map((p) => p[1])
          return [Math.min(...xs) - M, Math.min(...ys) - M / 2, Math.max(...xs) + M, Math.max(...ys) + M / 2] as [number, number, number, number]
        })
      const paint = boxes.length ? await paintNear(boxes) : null
      if (paint) fc = buildRoads(ways, nodes, bounds, { paint })
    }
  }
  // West and south edges in, east and north out: each feature in exactly one tile.
  fc.features = fc.features.filter((f) => {
    const [lon, lat] = anchor(f)
    return lon >= w && lon < e && lat >= s && lat < n
  })
  return fc
}

/** What a tile is built from: the builder's format, the roads, the fixes. Null where no roads have been built. */
export function streetsVersion(roadsDir = findRoadsDir()): string | null {
  return roadsDir ? `${FORMAT}-${roadsStamp(roadsDir)}-${FIXES_STAMP}${BUILDER === 'photo' ? '-photo' : ''}${PAINT ? '-paint' : ''}` : null
}

/** Tiles being built now, so two visitors asking for one tile wait for the same build. */
const building = new Map<string, Promise<Buffer | null>>()

/** A tile's streets as gzipped GeoJSON: from disk when built from these roads, else built (and kept). Null where no roads have been built. */
export async function streetTile(z: number, x: number, y: number, roadsDir = findRoadsDir(), dir = DIR): Promise<Buffer | null> {
  if (!roadsDir) return null
  const file = join(dir, `${z}-${x}-${y}-v${streetsVersion(roadsDir)}.json.gz`)
  const kept = await readFile(file).catch(() => null)
  if (kept) return kept
  const pending = building.get(file)
  if (pending) return pending
  const job = (async () => {
    try {
      const gz = gzipSync(JSON.stringify(await buildTile(roadsDir, z, x, y)))
      await mkdir(dir, { recursive: true })
      await writeFile(file, gz).catch(() => undefined)
      return gz
    } finally {
      building.delete(file)
    }
  })()
  building.set(file, job)
  return job
}

/** For tests and tools: a tile's features, unzipped. */
export const unzipTile = (gz: Buffer): FeatureCollection => JSON.parse(gunzipSync(gz).toString('utf8')) as FeatureCollection
