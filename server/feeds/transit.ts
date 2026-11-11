import { type TransitNetwork, type TransitVehicle, normaliseGpsFull, normaliseGpsTxt, normalisePieturasCsv, normaliseRigaGps } from '../../shared/adapters/transit'
import { UpstreamError } from '../core/upstream'
import type { GtfsIndex } from '../transit/gtfs'
import { lineBearingNear, modeIn, onRouteNear, pathAlong, snapToRoute } from '../transit/match'
import { ParkedVehicles } from '../transit/parked'
import { withoutTwins } from '../transit/twins'
import { SCHEDULED_NETWORKS, nameFromTimetable, scheduledVehicles } from '../transit/scheduled'
import { tripService } from '../transit/service'
import type { FeedDef } from './types'

/**
 * Puts each vehicle on the line of the timetable trip it runs, turned the way the line goes there,
 * so buses keep to their streets instead of wandering with the GPS. A vehicle whose trip is unknown,
 * or which is well off its line (a detour), stays where it said it was; one that went on along its
 * line carries the way it went (props.path), for the map to follow the street. Only for networks whose
 * timetable is already loaded: the first refresh after a start goes out unsnapped.
 */
function onRoutes(timetable: GtfsIndex, vehicles: TransitVehicle[]): void {
  const now = Date.now()
  for (const vehicle of vehicles) {
    const { route, trip, start } = vehicle.props
    const mode = modeIn(timetable, vehicle.props.mode)
    // A standing vehicle's heading is whatever it last was, and says nothing.
    const moving = (vehicle.spd ?? 0) > 1
    const snapped = snapToRoute(timetable, { lon: vehicle.lon, lat: vehicle.lat, route, mode, trip, start, ...(moving && vehicle.trk !== undefined && { trk: vehicle.trk }) }, now)
    const before = onLine.get(vehicle.id)
    if (!snapped) {
      // Off its line: a detour round roadworks, or a trip the timetable does not know. Shown where it is.
      onLine.delete(vehicle.id)
      // Standing with no heading of its own (at its terminus, say): along the nearest of its route's lines.
      if (!moving && !vehicle.trk) vehicle.trk = lineBearingNear(timetable, route, mode, vehicle.lon, vehicle.lat) ?? vehicle.trk
      // In its lane all the same, where one of its route's lines runs by it its way.
      const near = onRouteNear(timetable, route, mode, vehicle.lon, vehicle.lat, moving || vehicle.trk ? vehicle.trk : undefined)
      if (near) {
        vehicle.lon = Math.round(near.lon * 1e6) / 1e6
        vehicle.lat = Math.round(near.lat * 1e6) / 1e6
        vehicle.trk = near.trk
        vehicle.props.lane = true
      }
      continue
    }
    // The same line object: once its line is put on the streets (streets.ts), distances along it change.
    const sameLine = before && before.line === timetable.shapes[snapped.shape]
    const moved = sameLine ? snapped.along - before.along : 0
    if (sameLine && moved < 0 && moved > -BACKTRACK_M) {
      // A few metres back along the line is the GPS wavering at a stop: it stays where it was.
      Object.assign(vehicle, { lon: before.lon, lat: before.lat, trk: before.trk })
      before.at = now
      continue
    }
    vehicle.lon = Math.round(snapped.lon * 1e6) / 1e6
    vehicle.lat = Math.round(snapped.lat * 1e6) / 1e6
    vehicle.trk = snapped.trk
    if (sameLine && moved > 0 && moved < MAX_STEP_M) {
      const path = pathAlong(timetable.shapes[snapped.shape], before.along, snapped.along)
      if (path.length > 2) vehicle.props.path = path.map(([lon, lat]) => [Math.round(lon * 1e6) / 1e6, Math.round(lat * 1e6) / 1e6])
    }
    // Never past its next stop or traffic signal: it may stand there, and the map must not show it already gone on.
    const aheadTo = Math.min(snapped.along + AHEAD_M, snapped.nextStop ?? Infinity, (snapped.nextSignal ?? Infinity) - STOP_LINE_M)
    const ahead = aheadTo - snapped.along > 2 ? pathAlong(timetable.shapes[snapped.shape], snapped.along, aheadTo) : []
    if (ahead.length >= 2) vehicle.props.ahead = ahead.map(([lon, lat]) => [Math.round(lon * 1e6) / 1e6, Math.round(lat * 1e6) / 1e6])
    // On a line put on the streets it already stands in its lane.
    if (timetable.onStreets?.[snapped.shape]) vehicle.props.lane = true
    onLine.set(vehicle.id, { line: timetable.shapes[snapped.shape], along: snapped.along, lon: vehicle.lon, lat: vehicle.lat, trk: vehicle.trk, at: now })
  }
  for (const [id, last] of onLine) if (now - last.at > 10 * 60_000) onLine.delete(id)
}

/** Where each vehicle was last put on its line, so the next refresh knows which way, and how far, it went. */
const onLine = new Map<string, { line: Float64Array; along: number; lon: number; lat: number; trk: number; at: number }>()
/** Where a vehicle waits short of a traffic signal: carrying it on ends there, red or green, until a fix says it went through. */
const STOP_LINE_M = 6
/** Further back than this along its line is not jitter: the vehicle turned round, or a new trip began. */
const BACKTRACK_M = 30
/** Further on than this between two refreshes is not one stretch of driving: shown as a jump, not a path. */
const MAX_STEP_M = 1500
/** How much of its route ahead each vehicle carries: more than the map ever moves it on before the next fix. */
const AHEAD_M = 60

/**
 * pieturas.lv's Baltic-wide list (shared/adapters/transit.ts AGGREGATED): half a megabyte, from a
 * private project whose own data is a minute behind, so asked at most every 15 s, not every refresh.
 */
const AGGREGATE_URL = 'https://rt.pieturas.lv/vehicles.csv'
const AGGREGATE_MS = 15_000
let aggregate: { at: number; vehicles: TransitVehicle[]; text: string } = { at: 0, vehicles: [], text: '' }

async function aggregated(http: Parameters<FeedDef['load']>[0]['http']): Promise<TransitVehicle[]> {
  if (Date.now() - aggregate.at < AGGREGATE_MS) return aggregate.vehicles
  const at = Date.now()
  try {
    const text = await http.text(AGGREGATE_URL, { timeoutMs: 8000, maxBytes: 4 * 1024 * 1024 })
    const vehicles = normalisePieturasCsv(text, at)
    // Put on their lines, network by network, where a timetable is in.
    const byNetwork = new Map<string, TransitVehicle[]>()
    for (const vehicle of vehicles) {
      const id = vehicle.id.split(':')[1]
      const list = byNetwork.get(id)
      if (list) list.push(vehicle)
      else byNetwork.set(id, [vehicle])
    }
    for (const [id, list] of byNetwork) {
      const timetable = tripService.loadedFor(id)
      if (timetable) onRoutes(timetable, list)
    }
    aggregate = { at, vehicles, text }
  } catch (err) {
    console.warn('[pwh] transit: pieturas.lv list unavailable:', err instanceof Error ? err.message : err)
    // Kept for up to a minute, as the other networks' are; then the towns drop off until it answers.
    if (Date.now() - aggregate.at > KEEP_MS) aggregate = { at: aggregate.at, vehicles: [], text: '' }
  }
  return aggregate.vehicles
}

const parked = new ParkedVehicles()

/** The last heading each vehicle had while moving, kept for when it stands and its feed says none, or 0. */
const lastHeading = new Map<string, { trk: number; at: number }>()

function keepHeadings(vehicles: TransitVehicle[], now: number): void {
  for (const vehicle of vehicles) {
    const moving = (vehicle.spd ?? 0) > 1
    const held = lastHeading.get(vehicle.id)
    if (!moving && held && (vehicle.trk === undefined || vehicle.trk === 0)) vehicle.trk = held.trk
    else if (vehicle.trk !== undefined && (moving || vehicle.trk !== 0)) lastHeading.set(vehicle.id, { trk: vehicle.trk, at: now })
  }
  if (lastHeading.size > 20_000) for (const [id, held] of lastHeading) if (now - held.at > 3600_000) lastHeading.delete(id)
}

/**
 * The same list as text, and when it came, fetched if it is older than AGGREGATE_MS: for the trains
 * feed, which reads Estonia's trains out of it. One request serves both feeds.
 */
export async function aggregatedText(http: Parameters<FeedDef['load']>[0]['http']): Promise<{ at: number; text: string }> {
  await aggregated(http)
  return { at: aggregate.at, text: aggregate.text }
}

/** Each network's vehicles from its last answer, and when: shown again while a refresh of it fails. */
const lastGood = new Map<string, { at: number; vehicles: TransitVehicle[] }>()
/** How long a network's last vehicles stand in for it: past this they are too old to show as live. */
const KEEP_MS = 60_000

// Live vehicle positions for the networks that publish them.
// Rīgas satiksme's timetables moved to saraksti.lv (saraksti.rigassatiksme.lv no longer answers);
// its map reads the positions from stops.lt's read.php, which is what is read here too.
// marsruti.lv/rigasmikroautobusi carries the same regional buses as LSA, so it is left out.
// Checked on 2026-11-09 and not published: Daugavpils, Jelgava, Jūrmala, Ventspils, Valmiera,
// Šiauliai, Marijampolė, Utena, Tartu, Pärnu.
const NETWORKS: readonly (TransitNetwork & { url: string; format?: 'full' | 'riga' })[] = [
  { id: 'riga', name: 'Rīga', url: 'https://www.stops.lt/rigaapp/read.php?gps', format: 'riga' },
  { id: 'liepaja', name: 'Liepāja', url: 'https://marsruti.lv/liepaja/gps.txt' },
  { id: 'rezekne', name: 'Rēzekne', url: 'https://marsruti.lv/rezekne/gps.txt' },
  { id: 'regional', name: 'Regional buses', url: 'https://marsruti.lv/LSA/gps.txt' },
  // The same file format from the same software, published by Tallinn and by stops.lt for Lithuanian towns.
  { id: 'tallinn', name: 'Tallinn', url: 'https://transport.tallinn.ee/gps.txt' },
  { id: 'vilnius', name: 'Vilnius', url: 'https://www.stops.lt/vilnius/gps_full.txt', format: 'full' },
  { id: 'klaipeda', name: 'Klaipėda', url: 'https://www.stops.lt/klaipeda/gps_full.txt', format: 'full' },
  { id: 'panevezys', name: 'Panevėžys', url: 'https://www.stops.lt/panevezys/gps.txt' },
  { id: 'taurage', name: 'Tauragė region', url: 'https://www.stops.lt/taurage/gps.txt' },
  { id: 'dzukija', name: 'Druskininkai and Alytus region', url: 'https://www.stops.lt/druskininkai/gps.txt' },
  // gps_full.txt also says which timetable trip each vehicle runs, and Kaunas and Alytus put next
  // to nothing in gps.txt and their whole fleet in gps_full.txt.
  { id: 'kaunas', name: 'Kaunas', url: 'https://www.stops.lt/kaunas/gps_full.txt', format: 'full' },
  { id: 'alytus', name: 'Alytus', url: 'https://www.stops.lt/alytus/gps_full.txt', format: 'full' },
  { id: 'druskininkai', name: 'Druskininkai', url: 'https://www.stops.lt/druskininkai/gps_full.txt', format: 'full' },
]

export const transitFeed: FeedDef = {
  id: 'transit',
  title: 'Public transport',
  origins: [...new Set([...NETWORKS.map((network) => new URL(network.url).origin), new URL(AGGREGATE_URL).origin])],
  // Measured on 2026-11-09: Liepāja's file changes about every 5 s, stops.lt's (Rīga, Vilnius, Kaunas…)
  // every 2-15 s, 6 on average, Tallinn's every 10. Two seconds catches each change soon after it
  // happens, at four or five requests a second to stops.lt for all of its towns together: one server
  // fetching for every visitor, so it never grows with them. Faster than that only repeats the same file.
  ttlMs: 2000,
  staleMs: 90_000,
  waitMs: 1500,
  timeoutMs: 9000,
  attribution: [
    { label: 'marsruti.lv', href: 'https://marsruti.lv' },
    { label: 'Tallinna Transport', href: 'https://transport.tallinn.ee' },
    { label: 'stops.lt', href: 'https://www.stops.lt/' },
    // Their terms: free to use with a reference to pieturas.lv or gsvalbe.id.lv.
    { label: 'pieturas.lv (gsvalbe.id.lv)', href: 'https://gsvalbe.id.lv/pieturas/avoti.html' },
  ],
  async load({ http }) {
    const fromAggregate = aggregated(http)
    const results = await Promise.allSettled(
      NETWORKS.map(async (network) => {
        const text = await http.text(network.url, { timeoutMs: 6000 })
        const parse = network.format === 'full' ? normaliseGpsFull : network.format === 'riga' ? normaliseRigaGps : normaliseGpsTxt
        const vehicles = parse(text, network, Date.now())
        const timetable = tripService.loadedFor(network.id)
        if (timetable) onRoutes(timetable, vehicles)
        return vehicles
      }),
    )
    const entities: TransitVehicle[] = []
    const aggregate = await fromAggregate
    // Towns without live positions: where their timetables say the vehicles are, once each timetable is in.
    // A town whose vehicles report where they are but not their route (Daugavpils) shows those instead,
    // each named after the timetable's vehicle nearest it, and put on that trip's line.
    for (const network of SCHEDULED_NETWORKS) {
      const timetable = tripService.loadedFor(network.id)
      if (!timetable) continue
      const planned = scheduledVehicles(timetable, network, Date.now(), transitFeed.ttlMs)
      const live = aggregate.filter((vehicle) => vehicle.id.startsWith(`transit:${network.id}:`) && !vehicle.props.route)
      if (!live.length) {
        entities.push(...planned)
        continue
      }
      nameFromTimetable(live, planned)
      onRoutes(timetable, live.filter((vehicle) => vehicle.props.route))
    }
    let failures = 0
    const now = Date.now()
    results.forEach((result, i) => {
      const { id } = NETWORKS[i]
      if (result.status === 'fulfilled') {
        lastGood.set(id, { at: now, vehicles: result.value })
        entities.push(...result.value)
        return
      }
      failures += 1
      // A town whose file did not come in this time keeps its vehicles from the last one for a while,
      // rather than vanishing from the map for one slow answer.
      const kept = lastGood.get(id)
      if (kept && now - kept.at < KEEP_MS) entities.push(...kept.vehicles)
    })
    entities.push(...aggregate)
    keepHeadings(entities, now)
    // Parked over five minutes: off the map until it drives off. The timetable's vehicles never park.
    const moving = new Set(parked.shown(entities.filter((vehicle) => !vehicle.props.scheduled), now))
    // And each vehicle once: twins of one route side by side are one (server/transit/twins.ts).
    const shown = withoutTwins(entities.filter((vehicle) => vehicle.props.scheduled || moving.has(vehicle)))
    // One network being down should not blank the others; all of them down is a failed refresh.
    if (failures === NETWORKS.length) throw new UpstreamError('network', 'No public transport network could be reached')
    return { shape: 'entities', entities: shown }
  },
}
