import type { Entity } from '../entity'

export type TransitMode = 'bus' | 'tram' | 'trolleybus' | 'minibus'

export interface TransitProps {
  /** Which operator's feed this came from, e.g. "Liepāja". */
  network: string
  mode: TransitMode
  route: string | null
  /** Number plate or fleet number, when the feed carries one. */
  vehicle: string | null
  /** The timetable trip it is running, by its GTFS trip_id, where the feed says (Vilnius). */
  trip?: string
  /** When its trip set out, in minutes after the service day's midnight, where the feed says (stops.lt gps_full). */
  start?: number
  /**
   * The way it went along its route since the last refresh, [lon, lat] from where it was to where it
   * is, so the map can move it along the street instead of straight across the bend. Only while it
   * keeps to its timetable line.
   */
  path?: [number, number][]
  /**
   * The next stretch of its route ahead of it, [lon, lat] from where it is: for the map to keep it
   * moving, a little, until the next fix says where it really got to.
   */
  ahead?: [number, number][]
  /** Put on its line on the real streets (server/transit/streets.ts), it already stands in the right-hand lane. */
  lane?: boolean
  /** Not from GPS: where the timetable says it is now, for a town that does not publish its vehicles (server/transit/scheduled.ts). */
  scheduled?: boolean
}

export type TransitVehicle = Entity<TransitProps>

export interface TransitNetwork {
  id: string
  name: string
}

/** One vehicle's trip as the timetable has it, with where along it the vehicle is: GET /api/trip. */
export interface TripAnswer {
  route: string
  /** The route's long name, "Centras–Antakalnis–Saulėtekis", where the timetable gives one. */
  name: string
  headsign: string
  stops: { name: string; lon: number; lat: number; /** Due here, epoch ms, by the timetable. */ at: number }[]
  /** The first stop not yet reached. Equal to stops.length once the trip is done. */
  next: number
  /** Seconds behind the timetable (negative: ahead), from where the vehicle is. */
  delay: number
  /** The line it follows, [lon, lat] pairs. */
  shape: [number, number][]
}

const MODES: Record<string, TransitMode> = { '1': 'trolleybus', '2': 'bus', '3': 'tram', '4': 'minibus' }

/** Roughly the Baltic states: anything outside is a vehicle reporting from the depot's default position, or garbage. */
const inRange = (lon: number, lat: number) => lon > 20 && lon < 29 && lat > 53.8 && lat < 59.8

/**
 * Parses the headerless "gps.txt" position files several Latvian operators publish:
 *
 *   type, route, lon × 1e6, lat × 1e6, speed km/h, heading°, [vehicle, ...]
 *
 * A file holding just "0" or "1" means no vehicles are out. `extras`, by line, adds what a richer
 * file said about the trip (see normaliseGpsFull).
 */
export function normaliseGpsTxt(
  text: string,
  network: TransitNetwork,
  receivedAt: number,
  extras?: readonly (Pick<TransitProps, 'trip' | 'start'> | undefined)[],
): TransitVehicle[] {
  const out: TransitVehicle[] = []
  const ordinals = new Map<string, number>()

  for (const [index, line] of text.split(/\r?\n/).entries()) {
    const cells = line.split(',')
    if (cells.length < 6) continue
    const mode = MODES[cells[0].trim()]
    const lon = Number(cells[2]) / 1e6
    const lat = Number(cells[3]) / 1e6
    if (!mode || !Number.isFinite(lon) || !Number.isFinite(lat) || !inRange(lon, lat)) continue

    const route = cells[1].trim() || null
    const speedKmh = Number(cells[4])
    const heading = Number(cells[5])
    // Only some feeds identify the vehicle. Where they do not, "third bus on route 6" has to do:
    // stable enough between two polls for the icon to keep its place.
    const vehicle = /\d/.test(cells[6] ?? '') ? cells[6].trim() : null
    const group = `${cells[0].trim()}-${route ?? 'x'}`
    const ordinal = (ordinals.get(group) ?? 0) + 1
    ordinals.set(group, ordinal)
    const key = vehicle ? vehicle.replace(/[^\p{L}\p{N}]+/gu, '') : `${group}-${ordinal}`

    out.push({
      id: `transit:${network.id}:${key}`,
      kind: 'transit',
      lon,
      lat,
      ...(Number.isFinite(heading) && { trk: heading }),
      spd: Number.isFinite(speedKmh) ? speedKmh / 3.6 : 0,
      label: route ?? undefined,
      ts: receivedAt,
      flags: 0,
      props: { network: network.name, mode, route, vehicle, ...extras?.[index] },
    })
  }
  return out
}

/** The type names stops.lt writes out in full, as the one-digit codes of gps.txt. */
const FULL_MODES: readonly (readonly [RegExp, string])[] = [
  [/^troleib/i, '1'],
  [/^autob/i, '2'],
  [/^tramv/i, '3'],
  [/^mikro/i, '4'],
]

/**
 * Parses the "gps_full.txt" files stops.lt publishes for Lithuanian towns, where for some (Kaunas,
 * Alytus) the plain gps.txt is all but empty: a header row naming the columns, then
 *
 *   type name (Autobusai, Troleibusai…), route, trip, vehicle, lon × 1e6, lat × 1e6, speed km/h, heading°,
 *   trip start (ReisoPradziaMinutemis), …, and in Vilnius the GTFS trip id (ReisoIdGTFS)
 *
 * Each row is rewritten as a gps.txt row and read the same way, keeping the trip start and id,
 * which tie the vehicle to its timetable trip.
 */
export function normaliseGpsFull(text: string, network: TransitNetwork, receivedAt: number): TransitVehicle[] {
  const [head = '', ...lines] = text.split(/\r?\n/)
  const columns = head.split(',')
  if (!columns[0]?.startsWith('Transportas')) return []
  const startAt = columns.indexOf('ReisoPradziaMinutemis')
  const tripAt = columns.indexOf('ReisoIdGTFS')
  const extras: (Pick<TransitProps, 'trip' | 'start'> | undefined)[] = []
  const rows = lines.map((line) => {
    const cells = line.split(',')
    if (cells.length < 8) {
      extras.push(undefined)
      return ''
    }
    const start = startAt >= 0 && cells[startAt]?.trim() ? Number(cells[startAt]) : NaN
    const trip = tripAt >= 0 ? cells[tripAt]?.trim() : ''
    extras.push({ ...(Number.isFinite(start) && { start }), ...(trip && { trip }) })
    const code = FULL_MODES.find(([name]) => name.test(cells[0].trim()))?.[1] ?? ''
    return [code, cells[1], cells[4], cells[5], cells[6], cells[7], cells[3]].join(',')
  })
  return normaliseGpsTxt(rows.join('\n'), network, receivedAt, extras)
}

/**
 * Parses Rīgas satiksme's position file (stops.lt/rigaapp/read.php?gps, what saraksti.lv's own map
 * reads): gps.txt's columns, then a letter, the vehicle's fleet number, the trip's direction and the
 * minute its trip set out:
 *
 *   type, route, lon × 1e6, lat × 1e6, speed, heading°, "L", fleet number, direction, trip start, …
 *
 * Rewritten as gps.txt rows, with the fleet number where gps.txt has it, and read the same way.
 */
export function normaliseRigaGps(text: string, network: TransitNetwork, receivedAt: number): TransitVehicle[] {
  const extras: (Pick<TransitProps, 'trip' | 'start'> | undefined)[] = []
  const rows = text.split(/\r?\n/).map((line) => {
    const cells = line.split(',')
    const start = Number(cells[9])
    extras.push(cells[9]?.trim() && Number.isFinite(start) ? { start } : undefined)
    return cells.length < 8 ? line : [...cells.slice(0, 6), cells[7]].join(',')
  })
  return normaliseGpsTxt(rows.join('\n'), network, receivedAt, extras)
}

/**
 * The networks read from pieturas.lv's Baltic-wide vehicle list (rt.pieturas.lv/vehicles.csv), by
 * the prefix of its ids: only towns and regions that publish no file of their own we could read
 * directly. Gathered by gsvalbe.id.lv from Ridango (Estonia), diais.lv (Jūrmala), VINTRA and Dutrys
 * (Lithuania). Checked on 2026-11-09.
 */
export const AGGREGATED: Readonly<Record<string, TransitNetwork>> = {
  'tartu-ridango': { id: 'tartu', name: 'Tartu' },
  'harjumaa-ridango': { id: 'harjumaa', name: 'Harju County' },
  'estonia-ridango': { id: 'estonia', name: 'Läänemaa and Saaremaa' },
  'siauliai-ridango': { id: 'siauliai', name: 'Šiauliai' },
  'jurmala-diais': { id: 'jurmala', name: 'Jūrmala' },
  marijampoles: { id: 'marijampole', name: 'Marijampolė' },
  kedainiur: { id: 'kedainiai', name: 'Kėdainiai district' },
  jonavosr: { id: 'jonava', name: 'Jonava district' },
  plungesr: { id: 'plunge', name: 'Plungė district' },
  telsiur: { id: 'telsiai', name: 'Telšiai district' },
  vilniausr: { id: 'vilnius-district', name: 'Vilnius district' },
  alytausr: { id: 'alytus-district', name: 'Alytus district' },
  varenosr: { id: 'varena', name: 'Varėna district' },
  lazdijur: { id: 'lazdijai', name: 'Lazdijai district' },
  ltsar: { id: 'lt-intercity', name: 'Lithuanian intercity buses' },
  // Live, but with no route: each takes the route of the timetable trip it is nearest (feeds/transit.ts).
  'daugavpils-otp': { id: 'daugavpils', name: 'Daugavpils' },
}

const CSV_MODES: Record<string, TransitMode> = { Bus: 'bus', Trol: 'trolleybus', Tram: 'tram' }
/** Older than this, a row is a vehicle that stopped reporting: left out. */
const STALE_S = 5 * 60

/** One CSV line into its cells, with "quoted, cells" kept whole. */
export function csvCells(line: string): string[] {
  const out: string[] = []
  let cell = ''
  let quoted = false
  for (const char of line) {
    if (quoted) {
      if (char === '"') quoted = false
      else cell += char
    } else if (char === '"') quoted = true
    else if (char === ',') {
      out.push(cell)
      cell = ''
    } else cell += char
  }
  out.push(cell)
  return out
}

/**
 * Parses pieturas.lv's vehicle list: a header row, then one vehicle a row, with its route's short
 * name, trip and headsign, and when it last reported (epoch seconds). Only the AGGREGATED networks
 * are kept; trains and the networks read at their source are left out.
 */
export function normalisePieturasCsv(text: string, receivedAt: number): TransitVehicle[] {
  const [head = '', ...lines] = text.split(/\r?\n/)
  const columns = csvCells(head)
  const at = (name: string) => columns.indexOf(name)
  const [ID, LAT, LON, BEARING, SPEED, TYPE, ROUTE, TRIP, TS, LABEL] = ['id', 'lat', 'lon', 'bearing', 'speed', 'type', 'route_short_name', 'trip_id', 'ts', 'label'].map(at)
  if (ID < 0 || LAT < 0 || LON < 0) return []
  const out: TransitVehicle[] = []
  for (const line of lines) {
    if (!line) continue
    const cells = csvCells(line)
    const id = cells[ID]
    const cut = id.indexOf('_')
    const network = AGGREGATED[id.slice(0, cut)]
    const mode = CSV_MODES[cells[TYPE]]
    const lon = Number(cells[LON])
    const lat = Number(cells[LAT])
    if (!network || !mode || !inRange(lon, lat)) continue
    const ts = Number(cells[TS]) * 1000
    if (!(ts > 0) || receivedAt - ts > STALE_S * 1000) continue
    const route = cells[ROUTE]?.trim() || null
    const heading = cells[BEARING] === '' ? NaN : Number(cells[BEARING])
    const speedKmh = cells[SPEED] === '' ? NaN : Number(cells[SPEED])
    // Estonia's trip ids are the national timetable's own, behind an "ee-": the trip itself, for its card.
    const trip = cells[TRIP]?.startsWith('ee-') ? cells[TRIP].slice(3) : undefined
    const vehicle = cells[LABEL]?.trim() || null
    out.push({
      id: `transit:${network.id}:${id.slice(cut + 1).replace(/[^\p{L}\p{N}]+/gu, '').slice(0, 24)}`,
      kind: 'transit',
      lon: Math.round(lon * 1e6) / 1e6,
      lat: Math.round(lat * 1e6) / 1e6,
      ...(Number.isFinite(heading) && { trk: heading }),
      spd: Number.isFinite(speedKmh) ? speedKmh / 3.6 : 0,
      label: route ?? undefined,
      ts: Math.min(ts, receivedAt),
      flags: 0,
      props: { network: network.name, mode, route, vehicle, ...(trip && { trip }) },
    })
  }
  return out
}
