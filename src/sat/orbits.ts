import {
  type SatRec,
  degreesLat,
  degreesLong,
  ecfToLookAngles,
  eciToEcf,
  eciToGeodetic,
  gstime,
  json2satrec,
  propagate,
} from './sgp4'
import type { Entity } from '../../shared/entity'
import type { OrbitalElement, SatGroup } from '../../shared/feeds'
import { bearing, haversine } from '../../shared/geo/sphere'
import { RIGA } from '../../shared/region'

/**
 * Turns orbital elements into positions (SGP4). Runs in the browser: the server only
 * hands out the elements, which change every couple of hours, and each visitor's
 * machine does the arithmetic for the satellites it is actually showing.
 */
export interface SatelliteProps {
  name: string
  noradId: number
  intlDes: string
  group: SatGroup
  /** Kilometres per second, in orbit (not over the ground). */
  speedKmS: number
  periodMin: number
  inclination: number
  /** Look angles from Rīga, degrees, and slant range in km. */
  elevation: number
  azimuth: number
  rangeKm: number
  /** Epoch of the orbital elements, ISO 8601 without a zone (it is UTC). */
  epoch: string
}

export type Satellite = Entity<SatelliteProps>

export interface Tracked {
  element: OrbitalElement
  rec: SatRec
}

export interface Fix {
  lon: number
  lat: number
  altKm: number
  speedKmS: number
  elevation: number
  azimuth: number
  rangeKm: number
}

export interface Region {
  west: number
  south: number
  east: number
  north: number
}

const RAD = Math.PI / 180
const OBSERVER = { longitude: RIGA.lon * RAD, latitude: RIGA.lat * RAD, height: 0.01 }

export const satelliteId = (element: OrbitalElement) => `satellite:${element.NORAD_CAT_ID}`

/** Prepares each element set for propagation, skipping any the library rejects. */
export function track(elements: readonly OrbitalElement[]): Tracked[] {
  const tracked: Tracked[] = []
  for (const element of elements) {
    try {
      // Spread into a plain object: the library's type wants an indexable record.
      tracked.push({ element, rec: json2satrec({ ...element }) })
    } catch {
      // One unusable record must not cost us the other four hundred.
    }
  }
  return tracked
}

/** Where a satellite is at `date`. Look angles from Rīga are only worked out when asked for. */
export function fixAt(rec: SatRec, date: Date, withLook: boolean): Fix | null {
  const state = propagate(rec, date)
  if (!state) return null
  const gmst = gstime(date)
  const geo = eciToGeodetic(state.position, gmst)
  const { x, y, z } = state.velocity
  let elevation = 0
  let azimuth = 0
  let rangeKm = 0
  if (withLook) {
    const look = ecfToLookAngles(OBSERVER, eciToEcf(state.position, gmst))
    elevation = look.elevation / RAD
    azimuth = look.azimuth / RAD
    rangeKm = look.rangeSat
  }
  return {
    lon: degreesLong(geo.longitude),
    lat: degreesLat(geo.latitude),
    altKm: geo.height,
    speedKmS: Math.hypot(x, y, z),
    elevation,
    azimuth,
    rangeKm,
  }
}

export const inRegion = (fix: Fix | null, region: Region): fix is Fix =>
  fix !== null &&
  fix.lon >= region.west &&
  fix.lon <= region.east &&
  fix.lat >= region.south &&
  fix.lat <= region.north

/** Satellites over the region now, or due to be within `lookAheadMs`. Cheap enough for the whole catalogue. */
export function nearRegion(tracked: readonly Tracked[], now: number, lookAheadMs: number, region: Region): Tracked[] {
  const at = new Date(now)
  const soon = new Date(now + lookAheadMs)
  return tracked.filter(
    ({ rec }) => inRegion(fixAt(rec, at, false), region) || inRegion(fixAt(rec, soon, false), region),
  )
}

/**
 * Entities for the satellites currently inside the region, each with a course and
 * ground speed so the map can move its icon smoothly until the next pass.
 */
export function satellitesIn(near: readonly Tracked[], now: number, region: Region): Satellite[] {
  const at = new Date(now)
  const next = new Date(now + 1000)
  const out: Satellite[] = []

  for (const { element, rec } of near) {
    const fix = fixAt(rec, at, true)
    const ahead = fixAt(rec, next, false)
    if (!inRegion(fix, region) || !ahead) continue
    const name = element.OBJECT_NAME.replace(/\s+/g, ' ')

    out.push({
      id: satelliteId(element),
      kind: 'satellite',
      lon: fix.lon,
      lat: fix.lat,
      alt: fix.altKm * 1000,
      trk: bearing(fix.lon, fix.lat, ahead.lon, ahead.lat),
      // Metres covered over the ground in the one second between the two fixes.
      spd: haversine(fix.lon, fix.lat, ahead.lon, ahead.lat),
      label: name,
      ts: now,
      flags: 0,
      props: {
        name,
        noradId: element.NORAD_CAT_ID,
        intlDes: element.OBJECT_ID,
        group: element.GROUP,
        speedKmS: fix.speedKmS,
        periodMin: 1440 / element.MEAN_MOTION,
        inclination: element.INCLINATION,
        elevation: fix.elevation,
        azimuth: fix.azimuth,
        rangeKm: fix.rangeKm,
        epoch: element.EPOCH,
      },
    })
  }
  return out
}

/** Sub-satellite points from `fromS` to `toS` seconds around `now`, one every `stepS`. */
export function groundTrack(rec: SatRec, now: number, fromS: number, toS: number, stepS: number): [number, number][] {
  const path: [number, number][] = []
  for (let offset = fromS; offset <= toS; offset += stepS) {
    const fix = fixAt(rec, new Date(now + offset * 1000), false)
    if (!fix) continue
    const previous = path[path.length - 1]
    // Stop at the date line rather than draw a streak across the whole map.
    if (previous && Math.abs(fix.lon - previous[0]) > 90) break
    path.push([fix.lon, fix.lat])
  }
  return path
}
