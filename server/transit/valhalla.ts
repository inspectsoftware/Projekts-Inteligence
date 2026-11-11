import { type ChildProcess, spawn } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { SERVER_DIR } from '../paths'
import type { MatchedLine } from './mapmatch'

/**
 * Bus and trolleybus lines put in their lanes by Valhalla, the open-source navigation engine: it
 * matches a line to the streets as a navigator does (one-way streets, turns allowed, the bus's own
 * ways), says how many lanes each street has the way the bus goes, and before a turn which of them
 * are for that turn, from OpenStreetMap's turn lanes. A bus keeps to the right-hand lane, as it must
 * for its stops; before a turn it moves to the lane for it, a lane every 25 m at most, as a driver does.
 *
 * Valhalla runs beside the server: VALHALLA_URL where it is run apart, else its service is started
 * here on the road graph scripts/build-valhalla.mjs builds (valhalla/, or VALHALLA_DIR).
 */

/** Lane width, metres: as the map draws lanes (src/map/ownStyle.ts). */
export const LANE_M = 3.2
/** Before a turn, the bus is in the turn's lane over this many metres. */
const TURN_LANE_M = 120
/** A lane change takes at least this many metres. */
const CHANGE_M = 25
/** Points along a line every this many metres, for its lane changes to be smooth. */
const STEP_M = 4

// ---- the service -------------------------------------------------------------------------------

const PORT = 8002
let child: ChildProcess | null = null
let started: Promise<string | null> | null = null

/** Valhalla's road graph folder, with valhalla.json, if it has been built. */
export function findValhallaDir(env: Record<string, string | undefined> = process.env): string | null {
  if (env.VALHALLA_DIR) return existsSync(join(env.VALHALLA_DIR, 'valhalla.json')) ? env.VALHALLA_DIR : null
  for (const dir of [resolve(SERVER_DIR, '../valhalla'), resolve(SERVER_DIR, '../../valhalla'), resolve(SERVER_DIR, '../../../valhalla')]) {
    if (existsSync(join(dir, 'valhalla.json'))) return dir
  }
  return null
}

/** The pyvalhalla package's executables and, on Windows, the folder of their DLLs. */
function findBinaries(env: Record<string, string | undefined>): { bin: string; libs: string | null } | null {
  if (env.VALHALLA_BIN) return { bin: env.VALHALLA_BIN, libs: null }
  for (const root of [resolve(SERVER_DIR, '../scripts/.cache/valhalla-venv'), resolve(SERVER_DIR, '../../scripts/.cache/valhalla-venv')]) {
    if (!existsSync(root)) continue
    // Windows: Lib/site-packages; elsewhere lib/pythonX.Y/site-packages.
    const sites = [join(root, 'Lib/site-packages'), ...(existsSync(join(root, 'lib')) ? readdirSync(join(root, 'lib')).map((v) => join(root, 'lib', v, 'site-packages')) : [])]
    for (const site of sites) {
      const bin = join(site, 'valhalla/bin')
      if (existsSync(bin)) return { bin, libs: existsSync(join(site, 'pyvalhalla.libs')) ? join(site, 'pyvalhalla.libs') : null }
    }
  }
  return null
}

/** Where Valhalla answers, starting its service the first time it is asked for; null where there is none. */
export function valhallaUrl(env: Record<string, string | undefined> = process.env): Promise<string | null> {
  // Never under test: the tests give their own.
  if (env.VITEST) return Promise.resolve(null)
  if (env.VALHALLA_URL) return Promise.resolve(env.VALHALLA_URL.replace(/\/$/, ''))
  started ??= start(env)
  return started
}

async function start(env: Record<string, string | undefined>): Promise<string | null> {
  const url = `http://127.0.0.1:${PORT}`
  // One already running (another server process, or started by hand): use it.
  if (await alive(url)) return url
  const dir = findValhallaDir(env)
  const binaries = findBinaries(env)
  if (!dir || !binaries) return null
  const exe = join(binaries.bin, process.platform === 'win32' ? 'valhalla_service.exe' : 'valhalla_service')
  const pathSep = process.platform === 'win32' ? ';' : ':'
  child = spawn(exe, [join(dir, 'valhalla.json'), '2'], {
    stdio: 'ignore',
    env: binaries.libs ? { ...process.env, PATH: `${binaries.libs}${pathSep}${process.env.PATH ?? ''}` } : process.env,
  })
  child.on('exit', () => {
    child = null
    started = null
  })
  process.once('exit', () => child?.kill())
  for (let i = 0; i < 40; i++) {
    await new Promise((resolve) => setTimeout(resolve, 250))
    if (await alive(url)) {
      console.log('[pwh] valhalla: serving lanes from', dir)
      return url
    }
  }
  console.warn('[pwh] valhalla: the service did not start; lines stay with the matcher of our own')
  child?.kill()
  return null
}

/** Which build of the road graph Valhalla serves: lines matched on an older one are matched again. */
export async function valhallaVersion(url: string): Promise<string> {
  try {
    const status = (await (await fetch(`${url}/status`, { signal: AbortSignal.timeout(3000) })).json()) as { version?: string; tileset_last_modified?: number }
    return `${status.version}@${status.tileset_last_modified}`
  } catch {
    return 'unknown'
  }
}

async function alive(url: string): Promise<boolean> {
  try {
    return (await fetch(`${url}/status`, { signal: AbortSignal.timeout(1500) })).ok
  } catch {
    return false
  }
}

// ---- a line, matched -----------------------------------------------------------------------------

interface Edge {
  lane_count?: number
  traversability?: 'forward' | 'backward' | 'both' | 'none'
  begin_shape_index: number
  end_shape_index: number
  end_node?: { traffic_signal?: boolean }
}

interface Maneuver {
  type: number
  begin_shape_index: number
  /** Left to right: what each lane is for, and set where it is one for this turn. */
  lanes?: { directions: number; active?: number; valid?: number }[]
}

/** Valhalla's turns to the left (sharp, plain, slight) and U-turns, by maneuver type. */
const LEFT_TURNS = new Set([13, 14, 15, 16, 17])

/** Decodes a polyline at six digits, as Valhalla gives its shapes, to lon, lat pairs. */
export function decodePolyline6(text: string): [number, number][] {
  const out: [number, number][] = []
  let i = 0
  let lat = 0
  let lon = 0
  const next = () => {
    let result = 0
    let shift = 0
    let byte: number
    do {
      byte = text.charCodeAt(i++) - 63
      result |= (byte & 0x1f) << shift
      shift += 5
    } while (byte >= 0x20)
    return result & 1 ? ~(result >> 1) : result >> 1
  }
  while (i < text.length) {
    lat += next()
    lon += next()
    out.push([lon / 1e6, lat / 1e6])
  }
  return out
}

const metresBetween = ([lon1, lat1]: [number, number], [lon2, lat2]: [number, number]) => {
  const k = Math.cos((((lat1 + lat2) / 2) * Math.PI) / 180)
  return Math.hypot((lon2 - lon1) * 111_320 * k, (lat2 - lat1) * 110_540)
}

/** How far along a line each of its points is, metres. */
function along(points: readonly [number, number][]): number[] {
  const out = [0]
  for (let i = 1; i < points.length; i++) out.push(out[i - 1] + metresBetween(points[i - 1], points[i]))
  return out
}

/**
 * Where a vehicle drives along a matched line: how far right of each street's middle, metres, at
 * every point of the line. The right-hand lane, but the turn's lane before a turn; changes spread out.
 * Exported for tests.
 */
export function laneOffsets(points: readonly [number, number][], edges: readonly Edge[], maneuvers: readonly Maneuver[]): number[] {
  const dist = along(points)
  // Each point's street: the edge whose stretch of the shape it is on.
  const edgeAt: (Edge | undefined)[] = new Array(points.length)
  for (const edge of edges) for (let i = edge.begin_shape_index; i <= edge.end_shape_index && i < points.length; i++) edgeAt[i] = edge
  // The lane wanted at each point, counted from the right, and how many lanes there are there: the
  // street's, or before a turn as many as its turn lanes, where a lane is added for the turn.
  const lane = new Array<number>(points.length).fill(0)
  const count = points.map((_, i) => Math.max(1, edgeAt[i]?.lane_count ?? 1))
  for (const maneuver of maneuvers) {
    const at = dist[Math.min(maneuver.begin_shape_index, points.length - 1)]
    let wanted: number | null = null
    const turnLanes = maneuver.lanes?.length ?? 0
    if (maneuver.lanes?.length) {
      // The rightmost of the lanes for this turn: a bus keeps right whenever it may.
      const active = maneuver.lanes.map((l, i) => ((l.active ?? 0) !== 0 || (l.valid ?? 0) !== 0 ? i : -1)).filter((i) => i >= 0)
      if (active.length) wanted = maneuver.lanes.length - 1 - Math.max(...active)
    } else if (LEFT_TURNS.has(maneuver.type)) {
      // A left turn without its lanes mapped: from the leftmost lane, as the rules ask.
      wanted = Infinity
    }
    if (wanted === null) continue
    for (let i = 0; i < points.length; i++) {
      if (dist[i] > at) break
      if (dist[i] < at - TURN_LANE_M) continue
      count[i] = Math.max(count[i], turnLanes)
      lane[i] = Math.max(lane[i], Math.min(wanted, count[i] - 1))
    }
  }
  // From the lane to metres off the street's middle: a two-way street's lanes this way lie right of
  // its middle; a one-way street's lie either side of it.
  const offset = points.map((_, i) => {
    const edge = edgeAt[i]
    const lanes = count[i]
    const k = Math.min(lane[i], lanes - 1)
    const oneWay = edge?.traversability === 'forward' || edge?.traversability === 'backward'
    return (oneWay ? lanes / 2 - k - 0.5 : lanes - k - 0.5) * LANE_M
  })
  // No sudden jumps: at most a lane every CHANGE_M, eased in both directions so it is in the
  // turn's lane where the turn begins.
  const rate = LANE_M / CHANGE_M
  for (let i = 1; i < offset.length; i++) {
    const room = (dist[i] - dist[i - 1]) * rate
    offset[i] = Math.min(offset[i - 1] + room, Math.max(offset[i - 1] - room, offset[i]))
  }
  for (let i = offset.length - 2; i >= 0; i--) {
    const room = (dist[i + 1] - dist[i]) * rate
    offset[i] = Math.min(offset[i + 1] + room, Math.max(offset[i + 1] - room, offset[i]))
  }
  return offset
}

/** A line every STEP_M metres, its edges' shape indices moved to match. */
function densify(points: [number, number][], edges: Edge[], maneuvers: Maneuver[]): { points: [number, number][]; edges: Edge[]; maneuvers: Maneuver[] } {
  const out: [number, number][] = [points[0]]
  const newIndex = [0]
  for (let i = 1; i < points.length; i++) {
    const steps = Math.max(1, Math.ceil(metresBetween(points[i - 1], points[i]) / STEP_M))
    for (let s = 1; s <= steps; s++) {
      const t = s / steps
      out.push([points[i - 1][0] + (points[i][0] - points[i - 1][0]) * t, points[i - 1][1] + (points[i][1] - points[i - 1][1]) * t])
    }
    newIndex.push(out.length - 1)
  }
  const at = (i: number) => newIndex[Math.min(i, newIndex.length - 1)]
  return {
    points: out,
    edges: edges.map((e) => ({ ...e, begin_shape_index: at(e.begin_shape_index), end_shape_index: at(e.end_shape_index) })),
    maneuvers: maneuvers.map((m) => ({ ...m, begin_shape_index: at(m.begin_shape_index) })),
  }
}

/** Each point moved right of the way travelled by its offset; and where along the line the signals are. */
export function shiftRight(points: readonly [number, number][], offsets: readonly number[]): Float64Array {
  const out = new Float64Array(points.length * 2)
  for (let i = 0; i < points.length; i++) {
    const [a, b] = [points[Math.max(0, i - 1)], points[Math.min(points.length - 1, i + 1)]]
    const k = Math.cos((points[i][1] * Math.PI) / 180)
    const dx = (b[0] - a[0]) * 111_320 * k
    const dy = (b[1] - a[1]) * 110_540
    const len = Math.hypot(dx, dy) || 1
    // Right of (dx, dy) is (dy, -dx).
    out[i * 2] = points[i][0] + ((dy / len) * offsets[i]) / (111_320 * k)
    out[i * 2 + 1] = points[i][1] + ((-dx / len) * offsets[i]) / 110_540
  }
  return out
}

/** Valhalla's costing for a vehicle that runs on roads: a bus's, which may use bus lanes and bus-only streets. */
const COSTING = 'bus'
/** The most points sent: Valhalla's own limit is 16 000. */
const MAX_POINTS = 8000

/**
 * A line (lon, lat, lon, lat…) on the streets, in its lane, with its traffic signals; null where
 * Valhalla could not match it.
 */
export async function laneLine(url: string, line: Float64Array): Promise<MatchedLine | null> {
  // Thinned to points a few metres apart at least: an operator's line is often far denser than needed.
  const shape: { lon: number; lat: number }[] = []
  let last: [number, number] | null = null
  for (let i = 0; i + 1 < line.length; i += 2) {
    const p: [number, number] = [line[i], line[i + 1]]
    if (!last || metresBetween(last, p) >= 8) {
      shape.push({ lon: p[0], lat: p[1] })
      last = p
    }
  }
  if (shape.length < 2) return null
  const step = Math.ceil(shape.length / MAX_POINTS)
  const sent = step > 1 ? shape.filter((_, i) => i % step === 0 || i === shape.length - 1) : shape
  const ask = async (action: string, extra: object) => {
    const res = await fetch(`${url}/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shape: sent, costing: COSTING, shape_match: 'map_snap', ...extra }),
      signal: AbortSignal.timeout(60_000),
    })
    if (!res.ok) throw new Error(`${action}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`)
    return res.json()
  }
  const [attributes, route] = (await Promise.all([
    ask('trace_attributes', {
      filters: {
        attributes: ['edge.lane_count', 'edge.traversability', 'edge.begin_shape_index', 'edge.end_shape_index', 'node.traffic_signal', 'shape'],
        action: 'include',
      },
    }),
    ask('trace_route', { turn_lanes: true, directions_options: { units: 'kilometers' } }),
  ])) as [{ shape: string; edges: Edge[] }, { trip: { legs: { shape: string; maneuvers: Maneuver[] }[] } }]
  const points = decodePolyline6(attributes.shape)
  if (points.length < 2) return null
  // The turns, from the route's own shape onto the attributes' (the same path, matched the same way),
  // by how far along each is: one leg per stretch between breaks in the match, laid end to end.
  const atAlong = along(points)
  const maneuvers: Maneuver[] = []
  let offset = 0
  for (const leg of route.trip.legs) {
    const legPoints = decodePolyline6(leg.shape)
    const legAlong = along(legPoints)
    for (const m of leg.maneuvers) {
      const d = offset + legAlong[Math.min(m.begin_shape_index, legAlong.length - 1)]
      let i = atAlong.findIndex((a) => a >= d - 0.5)
      if (i < 0) i = points.length - 1
      maneuvers.push({ ...m, begin_shape_index: i })
    }
    offset += legAlong[legAlong.length - 1] ?? 0
  }
  const dense = densify(points, attributes.edges, maneuvers)
  const offsets = laneOffsets(dense.points, dense.edges, dense.maneuvers)
  const shifted = shiftRight(dense.points, offsets)
  const denseAlong = along(dense.points)
  const signals = dense.edges.filter((e) => e.end_node?.traffic_signal).map((e) => Math.round(denseAlong[Math.min(e.end_shape_index, denseAlong.length - 1)]))
  return { points: simplify(shifted, SIMPLIFY_M), signals }
}

/** How far a line may stray from its points left out: well within a lane. */
const SIMPLIFY_M = 0.3

/**
 * A line with the points it does not need left out (Douglas-Peucker): straight on, a point every
 * few metres says nothing the two ends do not. Exported for tests.
 */
export function simplify(line: Float64Array, tolerance: number): Float64Array {
  const n = line.length / 2
  if (n < 3) return line
  const k = Math.cos((line[1] * Math.PI) / 180)
  const x = (i: number) => line[i * 2] * 111_320 * k
  const y = (i: number) => line[i * 2 + 1] * 110_540
  const keep = new Uint8Array(n)
  keep[0] = keep[n - 1] = 1
  const stack: [number, number][] = [[0, n - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()!
    const [ax, ay, bx, by] = [x(a), y(a), x(b), y(b)]
    const len = Math.hypot(bx - ax, by - ay)
    let far = -1
    let worst = tolerance
    for (let i = a + 1; i < b; i++) {
      const d = len > 0 ? Math.abs((bx - ax) * (ay - y(i)) - (ax - x(i)) * (by - ay)) / len : Math.hypot(x(i) - ax, y(i) - ay)
      if (d > worst) {
        worst = d
        far = i
      }
    }
    if (far >= 0) {
      keep[far] = 1
      stack.push([a, far], [far, b])
    }
  }
  const out: number[] = []
  for (let i = 0; i < n; i++) if (keep[i]) out.push(line[i * 2], line[i * 2 + 1])
  return Float64Array.from(out)
}
