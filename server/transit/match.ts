import type { TripAnswer } from '../../shared/adapters/transit'
import { simplify } from '../../shared/geo/simplify'
import type { GtfsIndex, GtfsTrip } from './gtfs'

/** What the live feed says about one vehicle. */
export interface VehicleFix {
  lon: number
  lat: number
  /** Route as the feed names it, "3G"; trains: null. */
  route: string | null
  /** 'trolleybus', 'tram', 'bus', 'minibus' or 'rail'. */
  mode: string
  /** GTFS trip id, where the feed gives it (Vilnius, and trains by their number). */
  trip?: string
  /** When the trip set out, minutes after the service day's midnight (stops.lt gps_full). */
  start?: number
}

const DAY_S = 86_400
/** Farther than this from every stretch of a trip, a vehicle is not on it. */
const MAX_OFF_ROUTE_M = 1500
/** A trip is a candidate from a little before its first departure to a little after its last arrival. */
const SLACK_S = 15 * 60
/** Seconds of timetable difference that weigh as much as a metre off the line, when telling stretches of a loop apart. */
const METRES_PER_SECOND = 0.5

/** The hour, minute and second in the Baltic, and the epoch ms of that day's midnight there. */
const BALTIC = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Riga',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  second: 'numeric',
  hourCycle: 'h23',
})

export function balticDay(now: number): { midnight: number; date: number; weekday: number; second: number } {
  const p = Object.fromEntries(BALTIC.formatToParts(now).map((part) => [part.type, Number(part.value)]))
  const second = p.hour * 3600 + p.minute * 60 + p.second
  const utc = new Date(Date.UTC(p.year, p.month - 1, p.day))
  return {
    midnight: now - second * 1000 - (now % 1000),
    date: p.year * 10_000 + p.month * 100 + p.day,
    weekday: (utc.getUTCDay() + 6) % 7,
    second,
  }
}

/** The day before, as balticDay gives it. Midnight is a day earlier; a day of 23 or 25 hours is off by an hour, which the slack absorbs. */
function dayBefore(day: ReturnType<typeof balticDay>): ReturnType<typeof balticDay> {
  const utc = new Date(Date.UTC(Math.floor(day.date / 10_000), (Math.floor(day.date / 100) % 100) - 1, day.date % 100) - DAY_S * 1000)
  return {
    midnight: day.midnight - DAY_S * 1000,
    date: utc.getUTCFullYear() * 10_000 + (utc.getUTCMonth() + 1) * 100 + utc.getUTCDate(),
    weekday: (utc.getUTCDay() + 6) % 7,
    second: day.second + DAY_S,
  }
}

function runs(index: GtfsIndex, trip: GtfsTrip, day: ReturnType<typeof balticDay>): boolean {
  const service = index.services[trip.service]
  if (!service || service.removed.has(day.date)) return false
  return service.added.has(day.date) || (service.days[day.weekday] === '1' && day.date >= service.from && day.date <= service.to)
}

/** GTFS route types that fit what the feed calls the vehicle. */
/**
 * The kind a vehicle is matched as against this timetable: as it reports itself, but a "trolleybus"
 * where the timetable has none is a bus (Tallinn ran its last trolleybuses in 2023; its feed still
 * calls the buses on their lines trolleybuses).
 */
export function modeIn(index: GtfsIndex, mode: string): string {
  if (mode !== 'trolleybus') return mode
  const known = (index.hasTrolleybuses ??= index.routes.some((route) => route.type === 11 || route.type === 800))
  return known ? mode : 'bus'
}

function fitsMode(type: number, mode: string): boolean {
  const trolley = type === 11 || type === 800
  const tram = type === 0 || type === 900
  const rail = type === 2 || (type >= 100 && type < 200)
  if (mode === 'trolleybus') return trolley
  if (mode === 'tram') return tram
  if (mode === 'rail') return rail
  return !trolley && !tram && !rail
}

/** Metres between two points, flat-earth: fine over the length of a city. */
function metres(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const k = Math.cos(((lat1 + lat2) / 2) * (Math.PI / 180))
  return Math.hypot((lon2 - lon1) * k, lat2 - lat1) * 111_320
}

/** Where a point falls on the segment a→b: the fraction along it and the distance off it, in metres. */
function project(lon: number, lat: number, a: { lon: number; lat: number }, b: { lon: number; lat: number }): { f: number; off: number } {
  const k = Math.cos(lat * (Math.PI / 180))
  const [ax, ay, bx, by, px, py] = [a.lon * k, a.lat, b.lon * k, b.lat, lon * k, lat]
  const dx = bx - ax
  const dy = by - ay
  const len = dx * dx + dy * dy
  const f = len === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len))
  return { f, off: Math.hypot(px - (ax + f * dx), py - (ay + f * dy)) * 111_320 }
}

/**
 * Where along its trip a vehicle is: the first stop not yet reached, and how far behind the
 * timetable that puts it. Each stretch between two stops is scored by the distance off it plus
 * how far its timetable is from now, so a route that doubles back is read the right way.
 */
export function progress(index: GtfsIndex, trip: GtfsTrip, fix: VehicleFix, second: number): { next: number; delay: number; off: number } {
  let best = { next: 0, delay: 0, off: Infinity, score: Infinity }
  for (let i = 1; i < trip.stops.length; i++) {
    const a = index.stops[trip.stops[i - 1]]
    const b = index.stops[trip.stops[i]]
    const { f, off } = project(fix.lon, fix.lat, a, b)
    const due = trip.times[i - 1] + f * (trip.times[i] - trip.times[i - 1])
    const score = off + Math.abs(second - due) * METRES_PER_SECOND
    // Within a few per cent of a stop counts as being at it, and that stop as reached.
    if (score < best.score) best = { next: f > 0.98 ? i + 1 : i, delay: second - due, off, score }
  }
  // Still at the first stop, waiting to set out: nothing passed yet.
  const first = index.stops[trip.stops[0]]
  if (best.next === 1 && metres(fix.lon, fix.lat, first.lon, first.lat) < 60 && second <= trip.times[0] + 60) best.next = 0
  return { next: Math.min(best.next, trip.stops.length), delay: Math.round(Math.max(-15 * 60, Math.min(90 * 60, best.delay))), off: best.off }
}

/**
 * The timetable trip a vehicle is running, and the service day it belongs to (yesterday's, for a
 * trip timed past midnight). By the trip id where the feed gives one; else by the route and, where
 * the feed says, the minute the trip set out; else by the route alone, picking the running trip
 * whose line and timetable fit the vehicle's place best.
 */
export function findTrip(index: GtfsIndex, fix: VehicleFix, now: number): { trip: GtfsTrip; day: ReturnType<typeof balticDay> } | null {
  const today = balticDay(now)
  const days = [today, dayBefore(today)]

  if (fix.trip) {
    const at = index.tripById.get(fix.trip)
    const trip = at === undefined ? undefined : index.trips[at]
    if (trip) {
      const day = days.find((d) => runs(index, trip, d) && d.second >= trip.times[0] - SLACK_S && d.second <= trip.times.at(-1)! + SLACK_S)
      if (day) return { trip, day }
    }
  }
  if (!fix.route) return null

  const candidates = (index.tripsByRoute.get(fix.route.toLowerCase()) ?? []).map((i) => index.trips[i]).filter((trip) => fitsMode(index.routes[trip.route].type, fix.mode))
  let best: { trip: GtfsTrip; day: ReturnType<typeof balticDay>; score: number } | null = null
  for (const day of days) {
    for (const trip of candidates) {
      if (fix.start !== undefined && Math.abs(Math.round(trip.times[0] / 60) - fix.start) > 1) continue
      if (day.second < trip.times[0] - SLACK_S || day.second > trip.times.at(-1)! + SLACK_S || !runs(index, trip, day)) continue
      const { off, delay } = progress(index, trip, fix, day.second)
      if (off > MAX_OFF_ROUTE_M) continue
      const score = off + Math.abs(delay) * METRES_PER_SECOND
      if (!best || score < best.score) best = { trip, day, score }
    }
  }
  return best && { trip: best.trip, day: best.day }
}

/** About five metres: a corner survives, the jitter along a straight does not. */
const SHAPE_TOLERANCE = 0.00005

/** The card's content for a vehicle: its trip, every stop with its time, where it is, and the line it follows. */
export function answerFor(index: GtfsIndex, fix: VehicleFix, now: number): TripAnswer | null {
  const found = findTrip(index, fix, now)
  if (!found) return null
  const { trip, day } = found
  const { next, delay } = progress(index, trip, fix, day.second)
  const route = index.routes[trip.route]
  const stops = Array.from(trip.stops, (stop, i) => ({ ...index.stops[stop], at: day.midnight + trip.times[i] * 1000 }))
  const raw = trip.shape >= 0 ? index.shapes[trip.shape] : null
  const points: [number, number][] = raw
    ? Array.from({ length: raw.length / 2 }, (_, i) => [raw[2 * i], raw[2 * i + 1]])
    : stops.map((stop) => [stop.lon, stop.lat])
  return {
    route: route.short || fix.route || '',
    name: route.long,
    headsign: trip.headsign || stops.at(-1)!.name,
    stops,
    next,
    delay,
    shape: simplify(points, SHAPE_TOLERANCE).map(([lon, lat]) => [Math.round(lon * 1e5) / 1e5, Math.round(lat * 1e5) / 1e5]),
  }
}

/** Farther than this from its route's line, a vehicle is on a detour or the fix is bad: left where it said it was. */
const SNAP_M = 60

/** Degrees clockwise from north, from a to b. */
function bearing(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const k = Math.cos(((lat1 + lat2) / 2) * (Math.PI / 180))
  return ((Math.atan2((lon2 - lon1) * k, lat2 - lat1) * 180) / Math.PI + 360) % 360
}

/**
 * A vehicle put on the line its trip follows, as a city map shows it: GPS wanders five to twenty
 * metres off the street, and the line does not. Turned the way the line runs there. Where the
 * line passes the same spot twice (out and back along one street), the stretch running the way
 * the vehicle is heading wins. Null when its trip is unknown or it is too far off the line.
 */
export interface Snapped {
  lon: number
  lat: number
  trk: number
  /** The line it was put on (an index into the timetable's shapes) and how far along it, in metres. */
  shape: number
  along: number
  /** How far along the same line its next stop is, where the stop lies by the line: where it next has to stop. */
  nextStop?: number
  /** How far along the line the next traffic signal ahead is, once the line is on the streets (streets.ts). */
  nextSignal?: number
}

export function snapToRoute(index: GtfsIndex, fix: VehicleFix & { trk?: number }, now: number): Snapped | null {
  const found = findTrip(index, fix, now)
  if (!found || found.trip.shape < 0) return null
  const { trip } = found
  const shape = index.shapes[trip.shape]
  let best: (Snapped & { score: number }) | null = null
  let walked = 0
  for (let i = 2; i < shape.length; i += 2) {
    const a = { lon: shape[i - 2], lat: shape[i - 1] }
    const b = { lon: shape[i], lat: shape[i + 1] }
    const length = metres(a.lon, a.lat, b.lon, b.lat)
    const { f, off } = project(fix.lon, fix.lat, a, b)
    if (off <= SNAP_M) {
      const trk = bearing(a.lon, a.lat, b.lon, b.lat)
      const turn = fix.trk === undefined ? 0 : Math.abs(((trk - fix.trk + 540) % 360) - 180)
      const score = off + (turn > 90 ? SNAP_M : 0)
      if (!best || score < best.score) {
        best = { lon: a.lon + f * (b.lon - a.lon), lat: a.lat + f * (b.lat - a.lat), trk, shape: found.trip.shape, along: walked + f * length, score }
      }
    }
    walked += length
  }
  if (!best) return null
  const { next } = progress(index, trip, fix, found.day.second)
  const stop = next < trip.stops.length ? index.stops[trip.stops[next]] : null
  const nextStop = stop ? alongOf(shape, stop.lon, stop.lat, best.along) : null
  const along = best.along
  const nextSignal = index.signals?.[trip.shape]?.find((at) => at > along + 3)
  return { lon: best.lon, lat: best.lat, trk: Math.round(best.trk), shape: best.shape, along, ...(nextStop !== null && { nextStop }), ...(nextSignal !== undefined && { nextSignal }) }
}

/**
 * The stretch of a line between two distances along it, as [lon, lat] points from the first to the
 * second: the way a vehicle went between two fixes, bends included, rather than the straight cut.
 */
export function pathAlong(shape: Float64Array, from: number, to: number): [number, number][] {
  const out: [number, number][] = []
  let walked = 0
  for (let i = 2; i < shape.length; i += 2) {
    const [ax, ay, bx, by] = [shape[i - 2], shape[i - 1], shape[i], shape[i + 1]]
    const length = metres(ax, ay, bx, by)
    const at = (d: number): [number, number] => {
      const f = length === 0 ? 0 : (d - walked) / length
      return [ax + f * (bx - ax), ay + f * (by - ay)]
    }
    if (from >= walked && from <= walked + length) out.push(at(from))
    if (out.length && to > walked + length) out.push([bx, by])
    if (to >= walked && to <= walked + length) {
      out.push(at(to))
      break
    }
    walked += length
  }
  return out
}

/**
 * Which way the nearest of a route's lines runs by a point, degrees from north, or undefined when
 * none passes within `within` metres: for a vehicle standing at its terminus, off its trip's line,
 * that reports no heading, so it is drawn along its street rather than pointing north.
 */
export function lineBearingNear(index: GtfsIndex, route: string | null, mode: string, lon: number, lat: number, within = 150): number | undefined {
  if (!route) return undefined
  const shapes = new Set<number>()
  for (const i of index.tripsByRoute.get(route.toLowerCase()) ?? []) {
    const trip = index.trips[i]
    if (trip.shape >= 0 && fitsMode(index.routes[trip.route].type, mode)) shapes.add(trip.shape)
  }
  let best: { off: number; trk: number } | undefined
  for (const at of shapes) {
    const shape = index.shapes[at]
    for (let i = 2; i < shape.length; i += 2) {
      const a = { lon: shape[i - 2], lat: shape[i - 1] }
      const b = { lon: shape[i], lat: shape[i + 1] }
      const { off } = project(lon, lat, a, b)
      if (off <= within && (!best || off < best.off) && (a.lon !== b.lon || a.lat !== b.lat)) best = { off, trk: Math.round(bearing(a.lon, a.lat, b.lon, b.lat)) }
    }
  }
  return best?.trk
}

/**
 * The nearest point to a vehicle on any of its route's lines put in their lanes (streets.ts), within
 * `within` metres and running its way (within 90° of its heading, where it has one): for a vehicle
 * running its route but matched to none of its trips (off its timetable, or a trip it does not
 * list), so it is drawn in its lane all the same rather than where its GPS puts it. Null where none is.
 */
export function onRouteNear(index: GtfsIndex, route: string | null, mode: string, lon: number, lat: number, trk: number | undefined, within = 25): { lon: number; lat: number; trk: number } | null {
  if (!route || !index.onStreets) return null
  const shapes = new Set<number>()
  for (const i of index.tripsByRoute.get(route.toLowerCase()) ?? []) {
    const trip = index.trips[i]
    if (trip.shape >= 0 && index.onStreets[trip.shape] && fitsMode(index.routes[trip.route].type, mode)) shapes.add(trip.shape)
  }
  let best: { off: number; lon: number; lat: number; trk: number } | null = null
  for (const at of shapes) {
    const shape = index.shapes[at]
    for (let i = 2; i < shape.length; i += 2) {
      const a = { lon: shape[i - 2], lat: shape[i - 1] }
      const b = { lon: shape[i], lat: shape[i + 1] }
      if (a.lon === b.lon && a.lat === b.lat) continue
      const { f, off } = project(lon, lat, a, b)
      if (off > within || (best && off >= best.off)) continue
      const way = bearing(a.lon, a.lat, b.lon, b.lat)
      // The line the other way, for a two-way route on the same street: the lane across the road.
      if (trk !== undefined && Math.abs(((way - trk + 540) % 360) - 180) > 90) continue
      best = { off, lon: a.lon + f * (b.lon - a.lon), lat: a.lat + f * (b.lat - a.lat), trk: Math.round(way) }
    }
  }
  return best && { lon: best.lon, lat: best.lat, trk: best.trk }
}

/** A stop or a signal this far from a line is not on it. */
const ON_LINE_M = 40

/**
 * How far along a line a point (a stop, a traffic signal) lies, at or past `after` metres: the
 * nearest place on the line within ON_LINE_M of it. Null when the line does not pass it.
 */
export function alongOf(shape: Float64Array, lon: number, lat: number, after: number): number | null {
  let best: { along: number; off: number } | null = null
  let walked = 0
  for (let i = 2; i < shape.length; i += 2) {
    const a = { lon: shape[i - 2], lat: shape[i - 1] }
    const b = { lon: shape[i], lat: shape[i + 1] }
    const length = metres(a.lon, a.lat, b.lon, b.lat)
    const { f, off } = project(lon, lat, a, b)
    const along = walked + f * length
    if (along >= after && off <= ON_LINE_M && (!best || off < best.off)) best = { along, off }
    walked += length
    // Past the first good match, later stretches are another pass of the line, not this one.
    if (best && walked > best.along + 200) break
  }
  return best && best.along
}
