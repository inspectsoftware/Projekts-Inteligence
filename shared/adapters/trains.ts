import type { Entity } from '../entity'
import { bearing, haversine } from '../geo/sphere'

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
