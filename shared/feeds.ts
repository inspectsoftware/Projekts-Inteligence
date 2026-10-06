import type { Entity } from './entity'
import type { Attribution } from './origins'

export const FEED_IDS = [
  'aircraft',
  'aircraft-mil',
  'trains',
  'transit',
  'ships',
  'sanctions',
  'satellites',
  'gps-hex',
  'warnings',
  'navwarn',
  'airspace',
  'stations',
  'fires',
  'cameras',
  'cams',
  'roads',
  'radiation',
  'rivers',
  'energy',
  'internet',
  'news',
  'brief',
  'country-briefs',
  'tv',
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

export type CamCountry = 'LV' | 'EE' | 'LT'

/** One officially published live camera view, as the browser can show it right now. */
export interface Cam {
  id: string
  name: string
  /** The town it is in, or the road network it belongs to. */
  place: string
  country: CamCountry
  /** Absent where the publisher gives no position. */
  lon?: number
  lat?: number
  /** The position is the middle of the area or an estimate, not the camera's own mast. */
  approx?: boolean
  /** What `src` is: a picture, an HLS playlist, a YouTube player, another publisher's player page, or a plain video stream. */
  kind: 'still' | 'hls' | 'youtube' | 'iframe' | 'video'
  src: string
  /** A picture for the grid, for a view that is not one itself. */
  poster?: string
  /**
   * Seconds between new frames at the address of the still or the poster. Absent when the address
   * itself changes with every frame, which then arrives with the feed.
   */
  refreshS?: number
  /** One of the hundreds of roadside and junction cameras, which the window keeps apart from the hand-picked views. */
  road?: boolean
  credit: string
  /** The publisher's own page for this camera. */
  page: string
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

/**
 * One announced restriction: a navigational warning at sea, or a piece of airspace that is
 * closed, reserved or dangerous for a time. Where military activity is announced in advance.
 */
export interface Zone {
  id: string
  kind: 'sea' | 'air'
  /** In plain words: "Firing practice", "Naval exercise", "Danger area", "GNSS interference"... */
  type: string
  title: string
  /** The notice as its source worded it. */
  text: string
  /** Epoch ms. Null when the notice names no start, or no end: in force until it is withdrawn. */
  from: number | null
  to: number | null
  /** The hours within that period when it applies, in UTC, as a NOTAM words them: "DAILY 0500-1500", "06 08-09 0600-1800". */
  schedule?: string
  /** True when the notice gives its times in a way that could not be read: it is listed, and never called in force. */
  unsure?: boolean
  /** Outer rings as [lon, lat]. Empty when the notice gives no outline that can be drawn with confidence. */
  rings: [number, number][][]
  /** Somewhere to fly to: the middle of the outline, or the position the notice names. Null for text only. */
  point: [number, number] | null
  /** Who issued it, and the official page it can be read on. */
  issuer: string
  href: string
  /** True when the wording is about military or security activity: exercises, firing, danger areas, interference. */
  military: boolean
}

/** The national power system, from the latest hour the grid operators have published (usually a few hours back). */
export interface EnergySnapshot {
  /** Epoch ms of the hour the figures are for. */
  at: number | null
  loadMw: number | null
  generationMw: number | null
  /** Net exchange with the neighbours: positive while the country is importing. */
  importMw: number | null
  mix: { source: string; mw: number }[]
  /** Exchange with each neighbour; positive is import into Latvia. */
  flows: { country: string; mw: number }[]
  /** Day-ahead price for the Latvian bidding zone, EUR/MWh: this quarter-hour, and the range of the day published. */
  price: { now: number | null; low: number | null; high: number | null }
}

/** One measure of how much of the country's internet is reachable, against its own recent normal. */
export interface InternetSignal {
  id: string
  label: string
  latest: number
  baseline: number
}

/** 0 routine, 1 posture, 2 hybrid pressure, 3 serious incident, 4 crisis, 5 armed attack. */
export type EscalationLevel = 0 | 1 | 2 | 3 | 4 | 5

export interface NewsItem {
  title: string
  link: string
  /** Epoch ms. */
  at: number
  /** Which feed it came from ("lsm-en"), and the publisher's name as shown. */
  source: string
  publisher: string
  lang: 'en' | 'lv' | 'lt' | 'et' | 'ru'
  /** ISO codes of the countries the text is about ("LV", "RU"), as far as it says. */
  countries: string[]
  /** 0 to 100: how much it matters for the region's security picture. */
  importance: number
  escalation: EscalationLevel
  /** Why it scored as it did: the concepts found in the text ("airspace_violation"). */
  tags: string[]
  /** How many other publishers carry the same story. */
  corroboration: number
  /**
   * What the publisher's terms allow a language model to do with this item: write a one-line
   * summary, only rate it, or not see it at all.
   */
  ai: 'summary' | 'rate-only' | 'none'
}

/** A reading of the news feed as a whole: by a language model, or by the rule engine when no key is set. */
export interface IntelBrief {
  mode: 'ai' | 'rules'
  /** Epoch ms. */
  generatedAt: number
  /** The region's level right now. */
  level: EscalationLevel
  headline: string
  /** Two to four sentences. */
  summary: string
  /** Key developments, most serious first. `links` are the NewsItem links a point rests on. */
  points: { text: string; level: EscalationLevel; links: string[] }[]
  /** Level and a one-line reading per country, keyed by ISO code. */
  countries: Record<string, { level: EscalationLevel; text: string }>
  /** Ratings a language model gave, by item link. They replace the rule scores where present. */
  ratings: Record<string, { importance: number; escalation: EscalationLevel; summary?: string }>
}

/** A written profile of one country. Plain text, one or two paragraphs per section. */
export interface CountryBrief {
  overview: string
  defence: string
  military: string
  economy: string
  risks: string
  /** How this one was written. One payload can hold both kinds: a country the model failed on keeps its rule-written text. */
  mode?: 'ai' | 'rules'
}

/**
 * What the lookups found for one channel of the television list (shared/media/tv.ts). A channel
 * that is missing was not looked up, or its lookup failed: nothing is known about it right now.
 */
export interface TvNow {
  id: string
  /**
   * The YouTube video to play: today's broadcast or the latest one, or a pinned stream that passed
   * its check. Absent when the lookup answered and there is none: nothing listed, a bulletin the
   * feed no longer lists although its slot is still ahead or on, or a pinned stream that is gone
   * or may no longer be embedded.
   */
  videoId?: string
  /** That video's title, in its publisher's words. */
  title?: string
  /** It is today's broadcast, not a recording of an earlier day's. */
  today?: boolean
  /** For a programme with a fixed slot: when it starts and ends, epoch ms. */
  from?: number
  to?: number
}

/** What a feed delivers. One entity list cannot describe orbits, hexes or news, hence the union. */
export type FeedPayload =
  | { shape: 'entities'; entities: Entity[] }
  | { shape: 'elements'; sats: OrbitalElement[] }
  | { shape: 'cells'; windowStart: number; cells: GpsCell[] }
  | { shape: 'warnings'; warnings: WeatherWarning[] }
  | { shape: 'zones'; zones: Zone[] }
  | { shape: 'cams'; cams: Cam[] }
  // Sanctioned vessels by IMO number and MMSI, and the same for vessels listed as shadow fleet.
  | { shape: 'vessel-list'; imo: number[]; mmsi: number[]; shadowImo: number[]; shadowMmsi: number[] }
  | ({ shape: 'energy' } & EnergySnapshot)
  | { shape: 'internet'; signals: InternetSignal[] }
  | { shape: 'news'; items: NewsItem[] }
  | ({ shape: 'brief' } & IntelBrief)
  | { shape: 'country-briefs'; mode: 'ai' | 'rules'; generatedAt: number; briefs: Record<string, CountryBrief> }
  | { shape: 'tv'; channels: TvNow[] }

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
    case 'zones':
      return payload.zones.length
    case 'cams':
      return payload.cams.length
    case 'vessel-list':
      return payload.imo.length
    case 'energy':
      return payload.mix.length
    case 'internet':
      return payload.signals.length
    case 'news':
      return payload.items.length
    case 'brief':
      return payload.points.length
    case 'country-briefs':
      return Object.keys(payload.briefs).length
    case 'tv':
      return payload.channels.length
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
