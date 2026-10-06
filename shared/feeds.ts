import type { Entity } from './entity'
import type { Attribution } from './origins'

export const FEED_IDS = [
  'aircraft',
  'trains',
  'transit',
  'ships',
  'sanctions',
  'satellites',
  'gps-hex',
  'warnings',
  'stations',
  'fires',
  'cameras',
  'roads',
] as const
export type FeedId = (typeof FEED_IDS)[number]

export function isFeedId(value: string): value is FeedId {
  return (FEED_IDS as readonly string[]).includes(value)
}

export const SAT_GROUPS = ['stations', 'military', 'weather', 'resource', 'gnss'] as const
export type SatGroup = (typeof SAT_GROUPS)[number]

/**
 * One satellite's mean orbital elements, in the OMM field names CelesTrak publishes
 * (and satellite.js reads), plus the catalogue group it came from.
 */
export interface OrbitalElement {
  OBJECT_NAME: string
  OBJECT_ID: string
  EPOCH: string
  MEAN_MOTION: number
  ECCENTRICITY: number
  INCLINATION: number
  RA_OF_ASC_NODE: number
  ARG_OF_PERICENTER: number
  MEAN_ANOMALY: number
  NORAD_CAT_ID: number
  ELEMENT_SET_NO: number
  BSTAR: number
  MEAN_MOTION_DOT: number
  MEAN_MOTION_DDOT: number
  GROUP: SatGroup
}

/** One H3 cell with how many aircraft passed through it with healthy and with degraded GPS. */
export interface GpsCell {
  id: string
  /** Closed ring of [lon, lat]. */
  boundary: [number, number][]
  good: number
  bad: number
}

export type WarningLevel = 'yellow' | 'orange' | 'red'

/** One official weather warning that is in force or about to be. */
export interface WeatherWarning {
  id: string
  /** What it is about: "Wind", "Fog", "Rain"... */
  type: string
  level: WarningLevel
  description: string
  /** Epoch ms. */
  onset: number
  expires: number
  sent: number
  areas: string[]
  /** Outer rings of the affected areas as [lon, lat], simplified. Empty for sea areas, which come without geometry. */
  polygons: [number, number][][]
}

/** What a feed delivers. One entity list cannot describe orbits, hexes or news, hence the union. */
export type FeedPayload =
  | { shape: 'entities'; entities: Entity[] }
  | { shape: 'elements'; sats: OrbitalElement[] }
  | { shape: 'cells'; windowStart: number; cells: GpsCell[] }
  | { shape: 'warnings'; warnings: WeatherWarning[] }
  | { shape: 'vessel-list'; imo: number[]; mmsi: number[] }

export type PayloadOf<S extends FeedPayload['shape']> = Extract<FeedPayload, { shape: S }>

/** How many things a payload holds, for the layer list. */
export function countOf(payload: FeedPayload): number {
  switch (payload.shape) {
    case 'entities':
      return payload.entities.length
    case 'elements':
      return payload.sats.length
    case 'cells':
      return payload.cells.length
    case 'warnings':
      return payload.warnings.length
    case 'vessel-list':
      return payload.imo.length
  }
}

/**
 * Response body of GET /api/feed/:id. Identical for every client of one snapshot,
 * so it is serialised once and can be answered with 304. Anything that changes
 * between requests travels in the headers below instead.
 */
export interface FeedBody<T extends FeedPayload = FeedPayload> {
  id: FeedId
  /** Epoch ms when the server fetched this snapshot. */
  updatedAt: number
  payload: T
}

export const FEED_HEADERS = {
  /** Server clock (epoch ms), so the browser can correct its own. */
  serverTime: 'x-server-time',
  /** "1" when the snapshot is older than the feed's TTL. */
  stale: 'x-feed-stale',
  /** Milliseconds until asking again is worthwhile. */
  nextPoll: 'x-feed-next-poll',
} as const

export type FeedStatus = 'idle' | 'ok' | 'stale' | 'error' | 'needs-key'

/** One row of GET /api/feeds. */
export interface FeedMeta {
  id: FeedId
  title: string
  ttlMs: number
  status: FeedStatus
  updatedAt: number | null
  count: number | null
  /** Sanitised reason for the last failure: no URLs, no keys. */
  error: string | null
  attribution: readonly Attribution[]
}

export interface FeedsResponse {
  serverTime: number
  feeds: FeedMeta[]
}
