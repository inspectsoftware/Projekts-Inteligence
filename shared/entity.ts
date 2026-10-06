/**
 * One moving (or fixed) object on the map, whatever feed it came from.
 * WGS84 coordinates, SI units, bearings in degrees true.
 */
export type EntityKind = 'aircraft' | 'ship' | 'transit' | 'train' | 'satellite' | 'station' | 'fire' | 'camera' | 'road-event'

/** Kinds that travel, and so get a trail and dead reckoning. */
export const MOVING_KINDS: ReadonlySet<EntityKind> = new Set(['aircraft', 'ship', 'transit', 'train'])

/** Bit flags, so a whole entity list can be filtered and styled cheaply. */
export const Flag = {
  MIL: 1,
  EMERGENCY: 2,
  GPS_DEGRADED: 4,
  ON_GROUND: 8,
  /** A vessel on a sanctions list. */
  SANCTIONED: 16,
} as const

export interface Entity<P extends object = object> {
  /** `${kind}:${nativeId}`, unique and stable from one poll to the next. */
  id: string
  kind: EntityKind
  lon: number
  lat: number
  /** Metres above mean sea level. */
  alt?: number
  /** Course over ground. Drives both dead reckoning and icon rotation. */
  trk?: number
  /** Ground speed, m/s. */
  spd?: number
  /** Vertical rate, m/s, positive up. */
  vr?: number
  label?: string
  /** Epoch ms, on this server's clock, at which the POSITION was valid. Not the fetch time. */
  ts: number
  flags: number
  /** Display-only details, typed per kind. */
  props: P
}

export interface AircraftProps {
  hex: string
  callsign: string | null
  registration: string | null
  /** ICAO type designator, e.g. "B738". */
  type: string | null
  /** Emitter category, e.g. "A3" (large aircraft) or "A7" (rotorcraft). */
  category: string | null
  squawk: string | null
  /** How the position was obtained. */
  source: 'adsb' | 'mlat' | 'tisb' | 'other'
  /** ADS-B navigation integrity (0 = unknown) and accuracy, when reported. */
  nic: number | null
  nacP: number | null
  /** True when the aircraft recently had a GPS position and then lost it. */
  gpsLost: boolean
  /** Whether the transponder reports integrity at all (ADS-B version 1 or newer). */
  reportsIntegrity: boolean
}

export type Aircraft = Entity<AircraftProps>

export const KNOTS_TO_MS = 0.514444
export const FEET_TO_M = 0.3048
export const FPM_TO_MS = 0.00508
