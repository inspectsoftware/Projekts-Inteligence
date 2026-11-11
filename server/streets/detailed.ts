import { readFileSync } from 'node:fs'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { gunzipSync, gzipSync } from 'node:zlib'
import type { Feature, FeatureCollection, Geometry } from 'geojson'
import { CACHE_DIR } from '../core/disk'
import { USER_AGENT } from '../core/upstream'
import { OVERPASS } from '../transit/streets'

/**
 * Streets as they are on the ground, lane by lane, built by osm2streets (A/B Street's street engine,
 * open source) from OpenStreetMap: every carriageway's lanes (driving, bus, cycle, parking, the
 * pavements) as shapes, the paint between them and the arrows in them, and the junctions' own
 * areas, so streets meet as they do on the ground. With them, the islands and the hatched areas no
 * car may cross, where mappers have drawn them (osm2streets leaves those out). A tile at a time
 * (z15, about 670 m square): its OSM fetched through Overpass with 100 m to spare round it, so a
 * junction on its edge is whole, the result cut to the tile and kept on disk for a month.
 */

/** The zoom the streets are cut and kept at. */
export const STREETS_TILE_ZOOM = 15
/** OSM changes slowly; a month-old tile is good enough and keeps the load on Overpass low. */
const FRESH_MS = 30 * 24 * 3600_000
/** Room round a tile, degrees (about 100 m), so a junction on its edge is built whole. */
const MARGIN = 0.0015
/** Kept apart from the transit lines' streets (server/transit/streets.ts), which share the folder above. */
const DIR = join(CACHE_DIR, 'streets', 'tiles')
/** Raised when what a tile holds changes, so tiles kept from before are built afresh. */
const FORMAT = 2

export type BBox = [number, number, number, number]

/** A tile's bounds: west, south, east, north. */
export function tileBounds(z: number, x: number, y: number): BBox {
  const lon = (x: number) => (x / 2 ** z) * 360 - 180
  const lat = (y: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** z))) * 180) / Math.PI
  return [lon(x), lat(y + 1), lon(x + 1), lat(y)]
}

/** Everything a street is made of, as Overpass gives it to osm2streets: the ways and their nodes. */
export function overpassQuery([w, s, e, n]: BBox): string {
  const bbox = `${s - MARGIN / 2},${w - MARGIN},${n + MARGIN / 2},${e + MARGIN}`
  return `[out:xml][timeout:90];(way["highway"](${bbox});way["area:highway"](${bbox});way["traffic_calming"="island"](${bbox}););(._;>;);out body;`
}

interface StreetNetwork {
  toLanePolygonsGeojson(): string
  toLaneMarkingsGeojson(): string
  toIntersectionMarkingsGeojson(): string
  toGeojsonPlain(): string
  free(): void
}
type Engine = { JsStreetNetwork: new (xml: string, clip: string, options: object) => StreetNetwork }

let engine: Promise<Engine> | null = null
/** osm2streets, compiled to WebAssembly, loaded once: its glue is written for the browser, so the module is handed its bytes. */
function load(): Promise<Engine> {
  engine ??= (async () => {
    const dir = dirname(createRequire(import.meta.url).resolve('osm2streets-js/package.json'))
    const mod = (await import(pathToFileURL(join(dir, 'osm2streets_js.js')).href)) as Engine & { initSync(bytes: Buffer): unknown }
    mod.initSync(readFileSync(join(dir, 'osm2streets_js_bg.wasm')))
    return mod
  })()
  return engine
}

const round = (c: unknown): unknown => (typeof (c as number[])[0] === 'number' ? [Math.round((c as number[])[0] * 1e7) / 1e7, Math.round((c as number[])[1] * 1e7) / 1e7] : (c as unknown[]).map(round))
const shaped = (kind: string, f: Feature): Feature => ({
  type: 'Feature',
  properties: { kind, type: (f.properties?.type as string) ?? kind, layer: Number(f.properties?.layer ?? 0) },
  geometry: { ...f.geometry, coordinates: round((f.geometry as Exclude<Geometry, { type: 'GeometryCollection' }>).coordinates) } as Geometry,
})

const attrs = (s: string): Record<string, string> => Object.fromEntries([...s.matchAll(/([\w:]+)="([^"]*)"/g)].map(([, k, v]) => [k, v]))

/**
 * The islands ('island': 'grass' or 'paved') and hatched areas ('hatch') in OSM XML, as mappers draw
 * them: closed ways tagged `area:highway=traffic_island`, `traffic_calming=island` or
 * `area:highway=prohibited`. Each goes to the tile its middle is in, so none is drawn twice.
 */
export function islands(xml: string, [w, s, e, n]: BBox): Feature[] {
  const nodes = new Map<string, [number, number]>()
  for (const [, a] of xml.matchAll(/<node\b([^>]*)>/g)) {
    const { id, lat, lon } = attrs(a)
    nodes.set(id, [Number(lon), Number(lat)])
  }
  const out: Feature[] = []
  for (const [, body] of xml.matchAll(/<way\b[^>]*>([\s\S]*?)<\/way>/g)) {
    const tags = Object.fromEntries([...body.matchAll(/<tag\b([^>]*)>/g)].map(([, a]) => attrs(a)).map(({ k, v }) => [k, v]))
    const hatch = tags['area:highway'] === 'prohibited'
    if (!hatch && tags['area:highway'] !== 'traffic_island' && tags.traffic_calming !== 'island') continue
    const refs = [...body.matchAll(/<nd ref="(\d+)"/g)].map(([, ref]) => ref)
    const ring = refs.map((ref) => nodes.get(ref))
    if (refs.length < 4 || refs[0] !== refs[refs.length - 1] || ring.some((p) => !p)) continue
    const corners = (ring as [number, number][]).slice(0, -1)
    const x = corners.reduce((sum, p) => sum + p[0], 0) / corners.length
    const y = corners.reduce((sum, p) => sum + p[1], 0) / corners.length
    if (x < w || x >= e || y < s || y >= n) continue
    const grass = tags.surface === 'grass' || tags.landuse === 'grass'
    out.push({ type: 'Feature', properties: { kind: hatch ? 'hatch' : 'island', type: hatch ? 'prohibited' : grass ? 'grass' : 'paved', layer: 0 }, geometry: { type: 'Polygon', coordinates: round([ring]) as [number, number][][] } })
  }
  return out
}

/**
 * A tile's streets from OSM XML: lanes ('lane', by type), paint ('mark': lane separators, centre
 * lines, arrows, stop lines), pavement corners ('corner') and junction areas ('junction'), each
 * with its level ('layer': 1 a bridge, -1 a tunnel), and the islands and hatched areas mapped in
 * OSM ('island', 'hatch'). Cut to `bounds`.
 */
export async function buildStreets(xml: string, bounds: BBox): Promise<FeatureCollection> {
  const { JsStreetNetwork } = await load()
  const [w, s, e, n] = bounds
  const clip = JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] } }] })
  const net = new JsStreetNetwork(xml, clip, { debug_each_step: false, dual_carriageway_experiment: false, sidepath_zipping_experiment: false, inferred_sidewalks: true, osm2lanes: false })
  try {
    const parse = (json: string) => (JSON.parse(json) as FeatureCollection).features
    const features = [
      ...parse(net.toGeojsonPlain()).filter((f) => f.properties?.type === 'intersection').map((f) => shaped('junction', f)),
      ...parse(net.toLanePolygonsGeojson()).map((f) => shaped('lane', f)),
      ...parse(net.toIntersectionMarkingsGeojson()).map((f) => shaped('corner', f)),
      ...parse(net.toLaneMarkingsGeojson()).map((f) => shaped('mark', f)),
      ...islands(xml, bounds),
    ]
    return { type: 'FeatureCollection', features }
  } finally {
    net.free()
  }
}

/** The main Overpass server first: the others time out on an XML answer this size. */
const SERVERS = [OVERPASS.find((s) => s.includes('overpass-api.de')) ?? OVERPASS[0], ...OVERPASS.filter((s) => !s.includes('overpass-api.de'))]

/** One Overpass request at a time: the public servers ask callers for that. */
let turn: Promise<unknown> = Promise.resolve()
async function overpassXml(bounds: BBox, fetchImpl: typeof fetch): Promise<string> {
  const body = `data=${encodeURIComponent(overpassQuery(bounds))}`
  const ask = async () => {
    for (const [attempt, server] of SERVERS.entries()) {
      try {
        const res = await fetchImpl(server, { method: 'POST', headers: { 'User-Agent': USER_AGENT, 'Content-Type': 'application/x-www-form-urlencoded' }, body, signal: AbortSignal.timeout(90_000) })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const xml = await res.text()
        if (!xml.includes('<osm')) throw new Error('not OSM XML')
        return xml
      } catch (err) {
        console.warn(`[pwh] detailed streets: ${new URL(server).host} failed (${err instanceof Error ? err.message : err})`)
        await new Promise((resolve) => setTimeout(resolve, 3000 * (attempt + 1)))
      }
    }
    throw new Error('no Overpass server answered')
  }
  const mine = turn.then(ask)
  turn = mine.catch(() => undefined)
  return mine
}

/** Tiles being built now, so two visitors asking for one tile wait for the same build. */
const building = new Map<string, Promise<Buffer>>()

/** A tile's streets as gzipped GeoJSON: from disk while fresh, else built (and kept). */
export async function streetTile(z: number, x: number, y: number, fetchImpl: typeof fetch = fetch, dir = DIR): Promise<Buffer> {
  const key = `${z}-${x}-${y}`
  const file = join(dir, `${key}-v${FORMAT}.json.gz`)
  const fresh = await stat(file).then((s) => Date.now() - s.mtimeMs < FRESH_MS).catch(() => false)
  if (fresh) return readFile(file)
  const pending = building.get(key)
  if (pending) return pending
  const job = (async () => {
    try {
      const bounds = tileBounds(z, x, y)
      const fc = await buildStreets(await overpassXml(bounds, fetchImpl), bounds)
      const gz = gzipSync(JSON.stringify(fc))
      await mkdir(dir, { recursive: true })
      await writeFile(file, gz).catch(() => undefined)
      return gz
    } catch (err) {
      // An old copy beats none while Overpass is busy.
      const old = await readFile(file).catch(() => null)
      if (old) return old
      throw err
    } finally {
      building.delete(key)
    }
  })()
  building.set(key, job)
  return job
}

/** For tests and tools: a tile's features, unzipped. */
export const unzipTile = (gz: Buffer): FeatureCollection => JSON.parse(gunzipSync(gz).toString('utf8')) as FeatureCollection
