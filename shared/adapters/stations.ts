import type { Entity } from '../entity'

/** A weather station as listed by the Latvian met service (LVĢMC). */
export interface RawStationPoint {
  kods?: string
  nosaukums?: string
  lon?: string | number
  lat?: string | number
  h?: string | number
}

/** One hourly observation row. Every value arrives as a string or null. */
export interface RawObservation {
  station_code?: string
  /** "2026.10.06 10:00:00", UTC. */
  time?: string
  air_temperature_actual?: string | null
  air_temperature_feel?: string | null
  wind_speed_actual?: string | null
  wind_speed_gust?: string | null
  wind_direction_actual?: string | null
  humidity_actual?: string | null
  pressure_sea_level?: string | null
  precipitation?: string | null
  visibility_actual?: string | null
  lightning_total?: string | null
}

export interface StationProps {
  code: string
  name: string
  elevationM: number | null
  tempC: number | null
  feelsC: number | null
  windMs: number | null
  gustMs: number | null
  /** Direction the wind blows FROM, degrees. */
  windDir: number | null
  humidity: number | null
  pressureHpa: number | null
  precipMm: number | null
  visibilityM: number | null
  /** Lightning strokes detected around the station in the last hour. */
  lightning: number | null
}

export type Station = Entity<StationProps>

function num(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/** "2026.10.06 10:00:00" (UTC) -> epoch ms */
function parseTime(value: string | undefined): number {
  const m = value?.match(/^(\d{4})\.(\d{2})\.(\d{2}) (\d{2}):(\d{2}):(\d{2})$/)
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : NaN
}

/**
 * Joins the station list with the newest observation each station has. Stations
 * without a usable observation are left out.
 */
export function normaliseStations(points: readonly RawStationPoint[], observations: readonly RawObservation[]): Station[] {
  const newest = new Map<string, { at: number; row: RawObservation }>()
  for (const row of observations) {
    const at = parseTime(row.time)
    if (!row.station_code || !Number.isFinite(at)) continue
    const current = newest.get(row.station_code)
    if (!current || at > current.at) newest.set(row.station_code, { at, row })
  }

  const out: Station[] = []
  for (const point of points) {
    const lon = num(point.lon)
    const lat = num(point.lat)
    const latest = point.kods ? newest.get(point.kods) : undefined
    if (!point.kods || lon === null || lat === null || !latest) continue
    const { row, at } = latest
    const tempC = num(row.air_temperature_actual)
    const windMs = num(row.wind_speed_actual)
    // Some points only measure rain or snow depth; with neither temperature nor wind there is nothing to show.
    if (tempC === null && windMs === null) continue

    out.push({
      id: `station:${point.kods}`,
      kind: 'station',
      lon,
      lat,
      label: tempC === null ? '–' : `${Math.round(tempC)}°`,
      ts: at,
      flags: 0,
      props: {
        code: point.kods,
        name: point.nosaukums ?? point.kods,
        elevationM: num(point.h),
        tempC,
        feelsC: num(row.air_temperature_feel),
        windMs,
        gustMs: num(row.wind_speed_gust),
        windDir: num(row.wind_direction_actual),
        humidity: num(row.humidity_actual),
        pressureHpa: num(row.pressure_sea_level),
        precipMm: num(row.precipitation),
        visibilityM: num(row.visibility_actual),
        lightning: num(row.lightning_total),
      },
    })
  }
  return out
}
