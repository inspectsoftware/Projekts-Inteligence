import type { Entity } from '../entity'
import { bearing, haversine } from '../geo/sphere'
import { csvCells } from './transit'

/** One running train as published by the Vivi live map. Only the fields used here. */
export interface RawTrain {
  name?: string
  trainColor?: { color?: string; fuelType?: string }
  returnValue?: {
    train?: string
    position?: [number | string, number | string]
    stopped?: boolean
    finished?: boolean
    isGpsActive?: boolean
    departureTime?: string
    arrivalTime?: string
    nextStopObj?: { title?: string; departure?: string }
  }
}

export interface TrainProps {
  number: string
  /** "Rīga - Zilupe" */
  route: string | null
  nextStop: string | null
  /** Local time the train is due to leave the next stop, "HH:MM". */
  nextStopTime: string | null
  departure: string | null
  arrival: string | null
  /** False when the position is interpolated from the timetable instead of read from GPS. */
  gps: boolean
  stopped: boolean
  traction: 'diesel' | 'electric' | null
  /** Whose train: Latvia's Vivi where not said; Estonia's Elron. */
  operator?: 'elron'
  /** Where it is going, where the feed says. */
  destination?: string
  /** Its timetable trip (Elron's GTFS trip_id), for its card. */
  trip?: string
}

export type Train = Entity<TrainProps>

/** Earlier fix per train, kept between frames so speed and heading can be worked out. */
export type TrainFixes = Map<string, { lon: number; lat: number; at: number; trk?: number; spd?: number }>

/** A fix has to be at least this old before it is used as the start of a speed estimate. */
const MIN_BASELINE_MS = 8000
const MIN_MOVE_M = 25
/** Faster than any Latvian train: a jump like this is a glitch in the feed, not motion. */
const MAX_SPEED_MS = 60

/** "2026-10-06 11:50:00" -> "11:50" */
function clock(value: string | undefined): string | null {
  return value?.match(/(\d{2}:\d{2})(?::\d{2})?$/)?.[1] ?? null
}

/**
 * @param fixes Mutated: remembers where each train was, because the feed carries
 *   positions only and the map needs a course and speed to move icons smoothly.
 */
export function normaliseTrains(raw: readonly RawTrain[], receivedAt: number, fixes: TrainFixes): Train[] {
  const out: Train[] = []
  const seen = new Set<string>()

  for (const item of raw) {
    const value = item.returnValue
    const number = value?.train
    const lat = Number(value?.position?.[0])
    const lon = Number(value?.position?.[1])
    if (!value || !number || value.finished || !Number.isFinite(lat) || !Number.isFinite(lon)) continue
    seen.add(number)

    const stopped = value.stopped === true
    let fix = fixes.get(number)
    if (!fix) {
      fix = { lon, lat, at: receivedAt }
      fixes.set(number, fix)
    } else if (receivedAt - fix.at >= MIN_BASELINE_MS) {
      const metres = haversine(fix.lon, fix.lat, lon, lat)
      const speed = metres / ((receivedAt - fix.at) / 1000)
      if (metres >= MIN_MOVE_M && speed <= MAX_SPEED_MS) {
        fix.trk = bearing(fix.lon, fix.lat, lon, lat)
        fix.spd = speed
      } else {
        fix.spd = 0
      }
      fix.lon = lon
      fix.lat = lat
      fix.at = receivedAt
    }

    const fuel = item.trainColor?.fuelType
    out.push({
      id: `train:${number}`,
      kind: 'train',
      lon,
      lat,
      ...(fix.trk !== undefined && { trk: fix.trk }),
      spd: stopped ? 0 : (fix.spd ?? 0),
      label: number,
      ts: receivedAt,
      flags: 0,
      props: {
        number,
        route: item.name?.trim() || null,
        nextStop: value.nextStopObj?.title ?? null,
        nextStopTime: clock(value.nextStopObj?.departure),
        departure: clock(value.departureTime),
        arrival: clock(value.arrivalTime),
        gps: value.isGpsActive === true,
        stopped,
        traction: fuel === 'D' ? 'diesel' : fuel === 'E' ? 'electric' : null,
      },
    })
  }

  for (const number of fixes.keys()) if (!seen.has(number)) fixes.delete(number)
  return out
}

/** A short, steady name for a trip id that can run to 80 characters: FNV-1a, base 36. */
function shortId(id: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193)
  return (h >>> 0).toString(36)
}

/** Older than this, a row is a train that stopped reporting: left out. */
const STALE_TRAIN_S = 5 * 60

/**
 * Estonia's Elron trains out of pieturas.lv's Baltic-wide vehicle list (rt.pieturas.lv/vehicles.csv,
 * relaying Elron's own live map): each with its line (E35, RE34), the line's name, where it is going
 * and its timetable trip. The list carries no heading: like Vivi's, it is worked out from where the
 * train was before.
 *
 * @param fixes Mutated, as normaliseTrains' is.
 */
export function normaliseElronTrains(text: string, receivedAt: number, fixes: TrainFixes): Train[] {
  const [head = '', ...lines] = text.split(/\r?\n/)
  const columns = csvCells(head)
  const at = (name: string) => columns.indexOf(name)
  const [ID, LAT, LON, TYPE, ROUTE, NAME, TRIP, HEADSIGN, TS] = ['id', 'lat', 'lon', 'type', 'route_short_name', 'route_long_name', 'trip_id', 'headsign', 'ts'].map(at)
  if (ID < 0 || LAT < 0 || LON < 0) return []
  const out: Train[] = []
  const seen = new Set<string>()
  for (const line of lines) {
    if (!line.startsWith('elron_') && !line.startsWith('"elron_')) continue
    const cells = csvCells(line)
    const lat = Number(cells[LAT])
    const lon = Number(cells[LON])
    const ts = Number(cells[TS]) * 1000
    if (cells[TYPE] !== 'Train' || !Number.isFinite(lat) || !Number.isFinite(lon) || !(ts > 0) || receivedAt - ts > STALE_TRAIN_S * 1000) continue
    // Estonia's trip ids are the national timetable's own, behind an "ee-".
    const trip = cells[TRIP]?.startsWith('ee-') ? cells[TRIP].slice(3) : cells[TRIP] || undefined
    const key = shortId(cells[ID])
    seen.add(key)
    let fix = fixes.get(key)
    if (!fix) {
      fix = { lon, lat, at: receivedAt }
      fixes.set(key, fix)
    } else if (receivedAt - fix.at >= MIN_BASELINE_MS) {
      const metres = haversine(fix.lon, fix.lat, lon, lat)
      const speed = metres / ((receivedAt - fix.at) / 1000)
      if (metres >= MIN_MOVE_M && speed <= MAX_SPEED_MS) {
        fix.trk = bearing(fix.lon, fix.lat, lon, lat)
        fix.spd = speed
      } else fix.spd = 0
      Object.assign(fix, { lon, lat, at: receivedAt })
    }
    const number = cells[ROUTE]?.trim() || 'Elron'
    out.push({
      id: `train:ee${key}`,
      kind: 'train',
      lon: Math.round(lon * 1e6) / 1e6,
      lat: Math.round(lat * 1e6) / 1e6,
      ...(fix.trk !== undefined && { trk: fix.trk }),
      spd: fix.spd ?? 0,
      label: number,
      ts: Math.min(ts, receivedAt),
      flags: 0,
      props: {
        number,
        route: cells[NAME]?.trim() || null,
        nextStop: null,
        nextStopTime: null,
        departure: null,
        arrival: null,
        gps: true,
        stopped: false,
        traction: null,
        operator: 'elron',
        ...(cells[HEADSIGN]?.trim() && { destination: cells[HEADSIGN].trim() }),
        ...(trip && { trip }),
      },
    })
  }
  for (const key of fixes.keys()) if (!seen.has(key)) fixes.delete(key)
  return out
}
