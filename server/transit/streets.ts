import { createHash } from 'node:crypto'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { USER_AGENT } from '../core/upstream'
import type { GtfsIndex } from './gtfs'
import { MapMatcher } from './mapmatch'
import { type Way, buildRoadGraph } from './roads'
import { laneLine, valhallaUrl, valhallaVersion } from './valhalla'

/**
 * Puts a network's route lines on its town's real streets and tracks, by itself: the first time
 * a network's timetable is read, its streets are fetched from OpenStreetMap (through Overpass, kept
 * on disk for a month) and every line is matched to them in the background, a few at a time, so
 * the server keeps answering meanwhile. Until a line is done the operator's own is used.
 */

/** Public Overpass servers, tried in turn: the main one is often full. */
export const OVERPASS = ['https://overpass.private.coffee/api/interpreter', 'https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter']
/** A town's streets change slowly; a month-old copy is good enough, and keeps the load on Overpass to a request a month per town. */
const FRESH_MS = 30 * 24 * 3600_000
/** Wider than this (degrees of longitude by latitude) is a regional network: its streets would be far too many to fetch. */
const MAX_SPAN = [0.7, 0.45] as const
/** Lines matched between two pauses that let the server answer requests: one, as a long line takes a good part of a second. */
const BATCH = 1

const ROADS = 'motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|busway|bus_guideway|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link'

/** The Overpass query for what a network's vehicles run on, and the crossings and signals along it. */
function query(bbox: string, kinds: ReadonlySet<Way>): string {
  const parts: string[] = []
  if (kinds.has('road')) parts.push(`way["highway"~"^(${ROADS})$"](${bbox});`, `way["highway"="service"]["bus"~"yes|designated"](${bbox});`, `way["footway"="crossing"](${bbox});`, `node["highway"~"^(crossing|traffic_signals)$"](${bbox});`)
  if (kinds.has('tram')) parts.push(`way["railway"="tram"](${bbox});`, `node["highway"="traffic_signals"](${bbox});`)
  if (kinds.has('rail')) parts.push(`way["railway"~"^(rail|light_rail)$"](${bbox});`)
  return `[out:json][timeout:180];(${parts.join('')});out tags geom qt;`
}

/** What a GTFS route type runs on. */
function wayOf(type: number): Way {
  if (type === 0 || type === 900) return 'tram'
  if (type === 2 || (type >= 100 && type < 200)) return 'rail'
  return 'road'
}

/** One Overpass request at a time, whatever the number of towns: the servers ask callers for that. */
let overpassTurn: Promise<unknown> = Promise.resolve()
/** One town matched at a time: each holds a large graph while its lines are matched. */
let matchingTurn: Promise<unknown> = Promise.resolve()
/** After every server refused, a town is tried again this much later. */
const RETRY_MS = 3600_000

async function fetchStreets(file: string, body: string, fetchImpl: typeof fetch): Promise<unknown[]> {
  const fresh = await stat(file).then((s) => Date.now() - s.mtimeMs < FRESH_MS).catch(() => false)
  if (fresh) return (JSON.parse(await readFile(file, 'utf8')) as { elements: unknown[] }).elements
  const turn = overpassTurn.then(() => askOverpass(file, body, fetchImpl))
  overpassTurn = turn.catch(() => undefined)
  return turn
}

async function askOverpass(file: string, body: string, fetchImpl: typeof fetch): Promise<unknown[]> {
  for (const [attempt, server] of OVERPASS.entries()) {
    try {
      const res = await fetchImpl(server, {
        method: 'POST',
        headers: { 'User-Agent': USER_AGENT, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(body)}`,
        signal: AbortSignal.timeout(120_000),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const text = await res.text()
      const elements = (JSON.parse(text) as { elements?: unknown[] }).elements
      if (!elements) throw new Error('no elements in the answer')
      await mkdir(join(file, '..'), { recursive: true })
      await writeFile(file, text).catch(() => undefined)
      return elements
    } catch (err) {
      console.warn(`[pwh] streets: ${new URL(server).host} failed (${err instanceof Error ? err.message : err})`)
      // Overpass asks callers to back off before trying again.
      await new Promise((resolve) => setTimeout(resolve, 5000 * (attempt + 1)))
    }
  }
  // An old copy beats none while every server is busy.
  const old = await readFile(file, 'utf8').catch(() => null)
  if (old) return (JSON.parse(old) as { elements: unknown[] }).elements
  throw new Error('no Overpass server answered')
}

/**
 * Matches every line of a timetable to its town's streets and tracks, in place: `index.shapes[i]`
 * becomes the line on the road, in the lane, and `index.onStreets[i]` and `index.signals[i]` are
 * filled in. Resolves once all are done; safe to leave running.
 */
export async function putOnStreets(network: string, index: GtfsIndex, dir: string, fetchImpl: typeof fetch = fetch, valhalla: () => Promise<string | null> = valhallaUrl): Promise<void> {
  if (index.stops.length === 0) return
  // What each line carries.
  const all = new Map<number, Way>()
  for (const trip of index.trips) if (trip.shape >= 0 && !all.has(trip.shape)) all.set(trip.shape, wayOf(index.routes[trip.route].type))
  if (all.size === 0) return
  // Buses and trolleybuses through Valhalla, where it runs: lane by lane, as a navigator would drive
  // them. Trams and trains on the tracks fetched from Overpass, as before.
  const url = await valhalla()
  const byValhalla = new Map([...all].filter(([, kind]) => url !== null && kind === 'road'))
  const kinds = new Map([...all].filter(([shape]) => !byValhalla.has(shape)))
  index.onStreets ??= index.shapes.map(() => false)
  index.signals ??= index.shapes.map(() => [])
  if (!operatorLines.has(index)) operatorLines.set(index, [...index.shapes])
  const lanes = url && byValhalla.size ? inLanes(network, index, byValhalla, url, dir) : Promise.resolve()
  const wanted = new Set(kinds.values())
  if (wanted.size === 0) return lanes

  // The stops the trips call at, not every stop in the file: Estonia's town timetables each list the
  // whole country's. And the middle 96% of them, so a lone stop far out does not stretch the town.
  const used = new Set<number>()
  for (const trip of index.trips) if (trip.shape >= 0) for (const stop of trip.stops) used.add(stop)
  const lons = [...used].map((i) => index.stops[i].lon).sort((a, b) => a - b)
  const lats = [...used].map((i) => index.stops[i].lat).sort((a, b) => a - b)
  if (!lons.length) return
  const at = (sorted: number[], share: number) => sorted[Math.floor((sorted.length - 1) * share)]
  // Trains run between towns: all of their stops count.
  const cut = wanted.has('rail') ? 0 : 0.02
  const [w, e, s, n] = [at(lons, cut) - 0.01, at(lons, 1 - cut) + 0.01, at(lats, cut) - 0.01, at(lats, 1 - cut) + 0.01]
  // Trains run between towns, on few tracks: their whole country is small enough. Buses across a region are not.
  if (!wanted.has('rail') && (e - w > MAX_SPAN[0] || n - s > MAX_SPAN[1])) return

  // Matched before, from these same lines and this same copy of the streets: read back, not matched again.
  // Matching a big town takes the better part of a minute, and the live feeds wait on it meanwhile.
  const streetsFile = join(dir, `${network}.json`)
  const savedFile = join(dir, `${network}.matched.json`)
  const streetsAt = await stat(streetsFile).then((st) => (Date.now() - st.mtimeMs < FRESH_MS ? st.mtimeMs : null)).catch(() => null)
  const key = `${MATCHING}|${linesKey(index, kinds)}|${streetsAt}`
  if (streetsAt !== null && (await readSaved(savedFile, key, index))) return lanes

  let elements: unknown[]
  try {
    elements = await fetchStreets(streetsFile, query(`${s.toFixed(3)},${w.toFixed(3)},${n.toFixed(3)},${e.toFixed(3)}`, wanted), fetchImpl)
  } catch (err) {
    // Every server busy: the town stays on the operators' lines for now, and is tried again later.
    console.warn(`[pwh] streets: ${network} not fetched (${err instanceof Error ? err.message : err}); trying again in an hour`)
    setTimeout(() => void putOnStreets(network, index, dir, fetchImpl, valhalla), RETRY_MS).unref?.()
    return lanes
  }
  const turn = matchingTurn.then(async () => {
    await matchLines(network, index, kinds, elements)
    // Keyed by the copy of the streets now on disk, which fetchStreets may just have written.
    const at = await stat(streetsFile).then((st) => st.mtimeMs).catch(() => null)
    await save(savedFile, `${MATCHING}|${linesKey(index, kinds, true)}|${at}`, index, kinds)
  })
  matchingTurn = turn.catch(() => undefined)
  await Promise.all([turn, lanes])
}

/** Changed whenever putting lines in their lanes changes, so lines saved by an older way are done again. */
const LANES = 3

/**
 * A network's bus and trolleybus lines in their lanes, through Valhalla, saved for next time keyed by
 * the lines and Valhalla's road graph. One line at a time, as the server answers requests meanwhile.
 */
async function inLanes(network: string, index: GtfsIndex, kinds: Map<number, Way>, url: string, dir: string): Promise<void> {
  const file = join(dir, `${network}.lanes.json`)
  const key = `${LANES}|${linesKey(index, kinds, true)}|${await valhallaVersion(url)}`
  if (await readSaved(file, key, index)) return
  const started = Date.now()
  let done = 0
  let failed = 0
  for (const shape of kinds.keys()) {
    const line = operatorLines.get(index)?.[shape] ?? index.shapes[shape]
    const matched = await laneLine(url, line).catch((err) => {
      if (failed++ < 3) console.warn(`[pwh] lanes: ${network} line ${shape}: ${err instanceof Error ? err.message : err}`)
      return null
    })
    if (matched) {
      index.shapes[shape] = matched.points
      index.onStreets![shape] = true
      index.signals![shape] = matched.signals
      done++
    }
  }
  console.log(`[pwh] lanes: ${network}: ${done} of ${kinds.size} lines in their lanes in ${Math.round((Date.now() - started) / 1000)} s`)
  // Valhalla gone away part way (stopped, restarted): not kept, so the lines are done again next time.
  if (failed > done) return
  await mkdir(dir, { recursive: true }).catch(() => undefined)
  await save(file, key, index, kinds)
}

/** Changed whenever matching itself changes, so lines saved by an older one are matched again. */
const MATCHING = 2

/** The operator's lines and what each carries, as a short fingerprint. `original`: from the copies kept before matching replaced them. */
function linesKey(index: GtfsIndex, kinds: Map<number, Way>, original = false): string {
  const hash = createHash('sha1')
  for (const [shape, kind] of kinds) {
    const line = original ? (operatorLines.get(index)?.[shape] ?? index.shapes[shape]) : index.shapes[shape]
    hash.update(`${shape}:${kind}:`)
    hash.update(new Uint8Array(line.buffer, line.byteOffset, line.byteLength))
  }
  return hash.digest('hex')
}

/** The operator's own lines of each timetable, kept when matching replaces them, for linesKey. */
const operatorLines = new WeakMap<GtfsIndex, Float64Array[]>()

interface Saved {
  key: string
  lines: Record<string, { points: number[]; signals: number[] }>
}

async function readSaved(file: string, key: string, index: GtfsIndex): Promise<boolean> {
  const saved = await readFile(file, 'utf8')
    .then((text) => JSON.parse(text) as Saved)
    .catch(() => null)
  if (!saved || saved.key !== key) return false
  index.onStreets ??= index.shapes.map(() => false)
  index.signals ??= index.shapes.map(() => [])
  for (const [at, line] of Object.entries(saved.lines)) {
    const shape = Number(at)
    if (!(shape in index.shapes)) continue
    index.shapes[shape] = Float64Array.from(line.points)
    index.onStreets[shape] = true
    index.signals[shape] = line.signals
  }
  return true
}

async function save(file: string, key: string, index: GtfsIndex, kinds: Map<number, Way>): Promise<void> {
  const lines: Saved['lines'] = {}
  for (const shape of kinds.keys()) {
    if (index.onStreets?.[shape]) lines[shape] = { points: Array.from(index.shapes[shape], (v) => Math.round(v * 1e7) / 1e7), signals: index.signals?.[shape] ?? [] }
  }
  await writeFile(file, JSON.stringify({ key, lines } satisfies Saved)).catch(() => undefined)
}

async function matchLines(network: string, index: GtfsIndex, kinds: Map<number, Way>, elements: unknown[]): Promise<void> {
  const started = Date.now()
  const matcher = new MapMatcher(buildRoadGraph(elements as Parameters<typeof buildRoadGraph>[0]))
  if (!operatorLines.has(index)) operatorLines.set(index, [...index.shapes])
  index.onStreets ??= index.shapes.map(() => false)
  index.signals ??= index.shapes.map(() => [])
  let done = 0
  const lines = [...kinds.entries()]
  for (let i = 0; i < lines.length; i++) {
    const [shape, kind] = lines[i]
    const matched = matcher.match(index.shapes[shape], kind)
    if (matched) {
      index.shapes[shape] = matched.points
      index.onStreets![shape] = true
      index.signals![shape] = matched.signals
      done++
    }
    if (i % BATCH === BATCH - 1) await new Promise((resolve) => setImmediate(resolve))
  }
  console.log(`[pwh] streets: ${network}: ${done} of ${lines.length} lines on the streets in ${Math.round((Date.now() - started) / 1000)} s`)
}
