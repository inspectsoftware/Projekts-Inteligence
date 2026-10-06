import { normaliseFires } from '../../shared/adapters/fires'
import { type RawObservation, type RawStationPoint, normaliseStations } from '../../shared/adapters/stations'
import { type CapFeed, normaliseWarnings } from '../../shared/adapters/warnings'
import type { BBox } from '../../shared/region'
import type { FeedDef } from './types'

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE

/**
 * Official weather warnings for Latvia, issued by LVĢMC and distributed through
 * MeteoAlarm. The feed is large (every municipality outline, every revision), so it is
 * reduced here to the warnings that matter now, with simplified outlines.
 */
export const warningsFeed: FeedDef = {
  id: 'warnings',
  title: 'Weather warnings',
  origins: ['https://feeds.meteoalarm.org'],
  ttlMs: 5 * MINUTE,
  staleMs: 3 * HOUR,
  timeoutMs: 20_000,
  persist: true,
  attribution: [{ label: 'MeteoAlarm / LVĢMC (may lag the official site)', href: 'https://meteoalarm.org' }],
  async load({ http, now }) {
    const feed = await http.json<CapFeed>('https://feeds.meteoalarm.org/api/v1/warnings/feeds-latvia')
    return { shape: 'warnings', warnings: normaliseWarnings(feed, now) }
  },
}

const LVGMC = 'https://videscentrs.lvgmc.lv/data'

/**
 * Hourly observations from the national weather stations. These are the JSON files
 * behind the met service's own website; they are undocumented, so they are read
 * sparingly and cached, and the layer simply goes quiet if they ever change.
 */
export const stationsFeed: FeedDef = {
  id: 'stations',
  title: 'Weather stations',
  origins: ['https://videscentrs.lvgmc.lv'],
  ttlMs: 10 * MINUTE,
  staleMs: 3 * HOUR,
  timeoutMs: 25_000,
  persist: true,
  attribution: [{ label: 'LVĢMC', href: 'https://videscentrs.lvgmc.lv' }],
  async load({ http }) {
    const points = await http.json<RawStationPoint[]>(`${LVGMC}/weather_monitoring_points`)
    const observations = await http.json<RawObservation[]>(`${LVGMC}/weather_monitoring_data`)
    return { shape: 'entities', entities: normaliseStations(points, observations) }
  },
}

/** Latvia with a margin, so fires just across the border (and their smoke) are in view too. */
const FIRE_BBOX: BBox = [20.4, 55.3, 28.7, 58.4]

/** Heat sources seen from orbit in the last 24 hours: wildfires, field burning, and the odd flare stack. */
export const firesFeed: FeedDef = {
  id: 'fires',
  title: 'Fires',
  origins: ['https://firms.modaps.eosdis.nasa.gov'],
  ttlMs: 30 * MINUTE,
  staleMs: 12 * HOUR,
  timeoutMs: 20_000,
  persist: true,
  attribution: [{ label: 'NASA FIRMS (VIIRS)', href: 'https://firms.modaps.eosdis.nasa.gov' }],
  async load({ http }) {
    const csv = await http.text(
      'https://firms.modaps.eosdis.nasa.gov/data/active_fire/suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_Europe_24h.csv',
    )
    return { shape: 'entities', entities: normaliseFires(csv, FIRE_BBOX) }
  },
}
