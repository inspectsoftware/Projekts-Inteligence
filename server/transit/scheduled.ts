import type { TransitMode, TransitNetwork, TransitVehicle } from '../../shared/adapters/transit'
import type { GtfsIndex, GtfsTrip } from './gtfs'
import { alongOf, balticDay, pathAlong } from './match'

/**
 * Towns whose operators publish a timetable but not where their vehicles are. A city map shows
 * them anyway, where the timetable says each one is now, and says so; so does this. Each id is
 * also a key of TIMETABLES (service.ts). Checked on 2026-11-09 through the Mobility Database and
 * gsvalbe.id.lv/pieturas/avoti.html: none of them has live positions anyone publishes with their
 * route (Daugavpils's carry none). The Lithuanian ones are VINTRA's, by municipality (visimarsrutai.lt).
 */
export const SCHEDULED_NETWORKS: readonly (TransitNetwork & { url: string })[] = [
  { id: 'parnu', name: 'Pärnu', url: 'https://eu-gtfs.remix.com/parnu.zip' },
  { id: 'narva', name: 'Narva', url: 'https://eu-gtfs.remix.com/narva.zip' },
  { id: 'kohtla-jarve', name: 'Kohtla-Järve', url: 'https://eu-gtfs.remix.com/kohtla_jarve.zip' },
  { id: 'rakvere', name: 'Rakvere', url: 'https://eu-gtfs.remix.com/rakvere.zip' },
  { id: 'daugavpils', name: 'Daugavpils', url: 'https://satiksme.daugavpils.lv/saraksti/GTFS.zip' },
  // gsvalbe.id.lv's own, kept up to date; the operator's on data.lvnap.lv often runs behind.
  { id: 'jelgava', name: 'Jelgava', url: 'https://gsvalbe.id.lv/pieturas/dati/gtfs/jelgava.zip' },
  { id: 'valmiera', name: 'Valmiera', url: 'https://gsvalbe.id.lv/pieturas/dati/gtfs/valmiera.zip' },
  { id: 'ventspils', name: 'Ventspils', url: 'https://gsvalbe.id.lv/pieturas/dati/gtfs/ventspils.zip' },
  { id: 'jekabpils', name: 'Jēkabpils', url: 'https://gsvalbe.id.lv/pieturas/dati/gtfs/jekabpils.zip' },
  { id: 'palanga', name: 'Palanga', url: 'https://visimarsrutai.lt/gtfs/PalangosM.zip' },
  { id: 'visaginas', name: 'Visaginas', url: 'https://visimarsrutai.lt/gtfs/VisaginoM.zip' },
  { id: 'neringa', name: 'Neringa', url: 'https://visimarsrutai.lt/gtfs/neringa.zip' },
  { id: 'mazeikiai', name: 'Mažeikiai district', url: 'https://visimarsrutai.lt/gtfs/MazeikiuR.zip' },
  { id: 'ukmerge', name: 'Ukmergė district', url: 'https://visimarsrutai.lt/gtfs/UkmergesR.zip' },
  { id: 'utena', name: 'Utena district', url: 'https://visimarsrutai.lt/gtfs/UtenosR.zip' },
  { id: 'rokiskis', name: 'Rokiškis district', url: 'https://visimarsrutai.lt/gtfs/RokiskioR.zip' },
  { id: 'birzai', name: 'Biržai district', url: 'https://visimarsrutai.lt/gtfs/BirzuR.zip' },
  { id: 'kretinga', name: 'Kretinga district', url: 'https://visimarsrutai.lt/gtfs/KretingosR.zip' },
  { id: 'radviliskis', name: 'Radviliškis district', url: 'https://visimarsrutai.lt/gtfs/RadviliskioR.zip' },
  { id: 'anyksciai', name: 'Anykščiai district', url: 'https://visimarsrutai.lt/gtfs/AnyksciuR.zip' },
  { id: 'elektrenai', name: 'Elektrėnai', url: 'https://visimarsrutai.lt/gtfs/Elektrenu.zip' },
]

function modeOf(type: number): TransitMode {
  if (type === 0 || type === 900) return 'tram'
  if (type === 11 || type === 800) return 'trolleybus'
  return 'bus'
}

function metres(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const k = Math.cos(((lat1 + lat2) / 2) * (Math.PI / 180))
  return Math.hypot((lon2 - lon1) * k, lat2 - lat1) * 111_320
}

/** Where along its line each stop of a trip lies, metres; worked out once per trip and line. */
const stopAlongs = new WeakMap<Float64Array, WeakMap<GtfsTrip, Float64Array>>()

function alongsOf(index: GtfsIndex, trip: GtfsTrip, shape: Float64Array): Float64Array {
  let byTrip = stopAlongs.get(shape)
  if (!byTrip) stopAlongs.set(shape, (byTrip = new WeakMap()))
  const held = byTrip.get(trip)
  if (held) return held
  const out = new Float64Array(trip.stops.length)
  let after = 0
  for (let i = 0; i < trip.stops.length; i++) {
    const stop = index.stops[trip.stops[i]]
    // A stop the line misses keeps the one before's place: the vehicle waits there for its time.
    after = alongOf(shape, stop.lon, stop.lat, after) ?? after
    out[i] = after
  }
  byTrip.set(trip, out)
  return out
}

/** How far along its line a trip is at this second of its service day, by the timetable. */
function alongAt(times: Int32Array, alongs: Float64Array, second: number): number {
  if (second <= times[0]) return alongs[0]
  for (let i = 1; i < times.length; i++) {
    if (second < times[i]) {
      const span = times[i] - times[i - 1]
      return alongs[i - 1] + (span > 0 ? (second - times[i - 1]) / span : 1) * (alongs[i] - alongs[i - 1])
    }
  }
  return alongs.at(-1)!
}

/** A short, steady name for a trip, whose own id can run to 80 characters (Tartu's do): FNV-1a, base 36. */
function shortId(id: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193)
  return (h >>> 0).toString(36)
}

const round = ([lon, lat]: [number, number]): [number, number] => [Math.round(lon * 1e6) / 1e6, Math.round(lat * 1e6) / 1e6]

/** How much of its line each vehicle carries ahead: no more than the map moves it before the next refresh. */
const AHEAD_M = 60

/**
 * Every trip of a network on the road now, today's or one from yesterday still out past midnight,
 * placed where its timetable says it is: between the two stops it runs between, at the share of the
 * way the clock says, along its line. Trips without a line are left out, having no street to be on.
 */
export function scheduledVehicles(index: GtfsIndex, network: TransitNetwork, now: number, stepMs = 2000): TransitVehicle[] {
  const today = balticDay(now)
  const yesterday = { ...balticDay(now - 86_400_000), second: today.second + 86_400 }
  const out: TransitVehicle[] = []
  for (const trip of index.trips) {
    if (trip.shape < 0 || trip.times.length < 2) continue
    const service = index.services[trip.service]
    if (!service) continue
    for (const day of [today, yesterday]) {
      const second = day.second
      if (second < trip.times[0] || second >= trip.times.at(-1)!) continue
      const runs = !service.removed.has(day.date) && (service.added.has(day.date) || (service.days[day.weekday] === '1' && day.date >= service.from && day.date <= service.to))
      if (!runs) continue
      const shape = index.shapes[trip.shape]
      const alongs = alongsOf(index, trip, shape)
      const along = alongAt(trip.times, alongs, second + (now % 1000) / 1000)
      const before = alongAt(trip.times, alongs, second - stepMs / 1000)
      const here = pathAlong(shape, Math.max(0, along - 3), along + 3)
      if (here.length < 2) continue
      const [[ax, ay], [bx, by]] = [here[0], here.at(-1)!]
      const k = Math.cos(by * (Math.PI / 180))
      const trk = Math.round(((Math.atan2((bx - ax) * k, by - ay) * 180) / Math.PI + 360) % 360)
      const [lon, lat] = round(pathAlong(shape, along, along + 0.01)[0] ?? here[0])
      // Up to its next stop, where the timetable has it wait.
      const next = alongs.find((at) => at > along + 1) ?? alongs.at(-1)!
      const ahead = pathAlong(shape, along, Math.min(along + AHEAD_M, next))
      const path = along - before > 1 ? pathAlong(shape, before, along) : []
      const route = index.routes[trip.route]
      const name = route.short || route.long || null
      out.push({
        id: `transit:${network.id}:s${shortId(trip.id)}`,
        kind: 'transit',
        lon,
        lat,
        trk,
        spd: Math.round(((along - before) / (stepMs / 1000)) * 10) / 10,
        ts: now,
        flags: 0,
        ...(name && { label: name }),
        props: {
          network: network.name,
          mode: modeOf(route.type),
          route: name,
          vehicle: null,
          trip: trip.id,
          scheduled: true,
          ...(path.length >= 2 && { path: path.map(round) }),
          ...(ahead.length >= 2 && metres(...ahead[0], ...ahead.at(-1)!) > 2 && { ahead: ahead.map(round) }),
          ...(index.onStreets?.[trip.shape] && { lane: true }),
        },
      })
      break
    }
  }
  return out
}

/** Further than this from every trip the timetable has out, a live vehicle is not taken for any. */
const NAMED_WITHIN_M = 400

/**
 * Live vehicles that report no route, named after the timetable's: each takes the route, trip and
 * kind of the vehicle the timetable has nearest it, nearest pairs first, each timetable vehicle
 * once. One with none near keeps no route. Returns how many were named.
 */
export function nameFromTimetable(live: TransitVehicle[], timetabled: readonly TransitVehicle[]): number {
  const pairs: [number, number, number][] = []
  live.forEach((vehicle, i) =>
    timetabled.forEach((planned, j) => {
      const d = metres(vehicle.lon, vehicle.lat, planned.lon, planned.lat)
      if (d <= NAMED_WITHIN_M) pairs.push([d, i, j])
    }),
  )
  pairs.sort((a, b) => a[0] - b[0])
  const [livePaired, plannedPaired] = [new Set<number>(), new Set<number>()]
  for (const [, i, j] of pairs) {
    if (livePaired.has(i) || plannedPaired.has(j)) continue
    livePaired.add(i)
    plannedPaired.add(j)
    const { route, mode, trip } = timetabled[j].props
    Object.assign(live[i].props, { route, mode, ...(trip && { trip }) })
    live[i].label = route ?? undefined
  }
  return livePaired.size
}
