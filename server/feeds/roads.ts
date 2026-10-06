import { VectorTile } from '@mapbox/vector-tile'
import { PbfReader } from 'pbf'
import { type RoadRow, normaliseCameras, normaliseRoadEvents } from '../../shared/adapters/roads'
import type { Upstream } from '../core/upstream'
import type { FeedDef } from './types'

const MINUTE = 60 * 1000

/**
 * Latvia's National Access Point for road data publishes its map as vector tiles and
 * nothing lighter, so the tiles are read here and reduced to what the map shows.
 */
const ORIGIN = 'https://map.transportdata.gov.lv'
const TILES = `${ORIGIN}/gis/pg_tileserv`
const ATTRIBUTION = [{ label: 'Latvijas Valsts ceļi / transportdata.gov.lv', href: 'https://transportdata.gov.lv' }]

/** The six zoom-6 tiles that cover Latvia. One tile unit there is about 85 m on the ground. */
const ZOOM = 6
const TILE_XY = [
  [35, 19],
  [36, 19],
  [37, 19],
  [35, 20],
  [36, 20],
  [37, 20],
] as const

type Keep = (properties: Record<string, unknown>) => boolean

function rowsOf(bytes: Uint8Array, x: number, y: number, keep: Keep): RoadRow[] {
  // A tile with nothing in it is an empty body.
  if (bytes.length === 0) return []
  const rows: RoadRow[] = []
  for (const [layer, features] of Object.entries(new VectorTile(new PbfReader(bytes)).layers)) {
    for (let i = 0; i < features.length; i++) {
      const feature = features.feature(i)
      if (!keep(feature.properties)) continue
      // ponytail: a stretch of road is marked at its middle vertex; draw the line itself if that ever matters.
      const flat = ((feature.toGeoJSON(x, y, ZOOM).geometry as { coordinates: unknown[] }).coordinates.flat(Infinity) as number[])
      const middle = Math.floor(flat.length / 4) * 2
      rows.push({ layer, properties: feature.properties, lon: flat[middle], lat: flat[middle + 1] })
    }
  }
  return rows
}

/** Everything `keep` lets through from the given layers, across Latvia. Fails as a whole: half a country would mislead. */
async function readTiles(http: Upstream, layers: string, keep: Keep): Promise<RoadRow[]> {
  const tiles = await Promise.all(
    TILE_XY.map(async ([x, y]) =>
      rowsOf(await http.bytes(`${TILES}/${layers}/${ZOOM}/${x}/${y}.pbf`, { maxBytes: 32 * 1024 * 1024, timeoutMs: 25_000 }), x, y, keep),
    ),
  )
  return tiles.flat()
}

/** Latest frame of each camera, by camera id. Lives in memory only: it is minutes old at best anyway. */
let frames = new Map<string, Uint8Array>()

export function cameraFrame(id: string): Uint8Array | undefined {
  return frames.get(id)
}

/** The tiles carry each frame as PostgreSQL hex text ("\xffd8..."). Only what starts like a JPEG is accepted. */
function jpegOf(field: unknown): Uint8Array | null {
  return typeof field === 'string' && field.startsWith('\\xffd8') ? Buffer.from(field.slice(2), 'hex') : null
}

/** The road authority's roadside cameras: a still every few minutes, no video. */
export const camerasFeed: FeedDef = {
  id: 'cameras',
  title: 'Road cameras',
  origins: [ORIGIN],
  ttlMs: 5 * MINUTE,
  staleMs: 30 * MINUTE,
  timeoutMs: 40_000,
  attribution: ATTRIBUTION,
  async load({ http }) {
    const rows = await readTiles(http, 'public.mvt_kafkamessages_camera', () => true)
    const next = new Map<string, Uint8Array>()
    for (const { properties } of rows) {
      const jpeg = jpegOf(properties.file_field)
      if (jpeg) next.set(String(properties.id), jpeg)
    }
    frames = next
    const withFrame = rows.filter((row) => next.has(String(row.properties.id)))
    return { shape: 'entities', entities: normaliseCameras(withFrame, Date.now()) }
  },
}

/** Roadworks, closures, accidents and hazards on the state roads. */
export const roadsFeed: FeedDef = {
  id: 'roads',
  title: 'Roadworks and incidents',
  origins: [ORIGIN],
  ttlMs: 5 * MINUTE,
  staleMs: 2 * 60 * MINUTE,
  timeoutMs: 45_000,
  persist: true,
  attribution: ATTRIBUTION,
  async load({ http, now }) {
    const rows = await readTiles(
      http,
      'public.mvt_kafkamessages_notplannedevent_public,public.mvt_kafkamessages_plannedevent_public',
      // Dropped before any geometry is decoded: nine in ten features are maintenance job entries.
      (p) => p.status === 'ACTIVE' && p.event_enum !== 'UVIS',
    )
    return { shape: 'entities', entities: normaliseRoadEvents(rows, now) }
  },
}
