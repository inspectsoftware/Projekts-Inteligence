import { parseSanctionedVessels } from '../../shared/adapters/sanctions'
import {
  VesselTable,
  parseAisStreamMessage,
  parseDigitrafficLocations,
  parseDigitrafficVessels,
} from '../../shared/adapters/ships'
import type { BBox } from '../../shared/region'
import { LazyStream } from '../core/stream'
import type { FeedDef } from './types'

const HOUR = 60 * 60 * 1000

/** Latvian waters and their approaches: the Gulf of Rīga, the Irbe Strait and the open coast. */
const SEA_BBOX: BBox = [18.5, 55.3, 25.6, 59.7]

/**
 * Vessels under sanctions, by IMO number and MMSI, from OpenSanctions' maritime list.
 * A 5 MB download reduced to two lists of numbers, refreshed daily and kept on disk.
 */
export const sanctionsFeed: FeedDef = {
  id: 'sanctions',
  title: 'Sanctioned vessels',
  origins: ['https://data.opensanctions.org'],
  ttlMs: 24 * HOUR,
  staleMs: 14 * 24 * HOUR,
  timeoutMs: 45_000,
  persist: true,
  attribution: [{ label: 'OpenSanctions (CC BY-NC)', href: 'https://www.opensanctions.org/datasets/maritime/' }],
  async load({ http }) {
    const csv = await http.text('https://data.opensanctions.org/datasets/latest/maritime/maritime.csv', {
      maxBytes: 16 * 1024 * 1024,
      timeoutMs: 40_000,
    })
    return { shape: 'vessel-list', ...parseSanctionedVessels(csv) }
  },
}

const DIGITRAFFIC = 'https://meri.digitraffic.fi/api/ais/v1'
// Digitraffic asks callers to name themselves in this header.
const DIGITRAFFIC_HEADERS = { 'Digitraffic-User': 'ProjectWhiteHornet' }
/** Ship names and types change rarely; the whole list is small, so it is simply re-read now and then. */
const STATIC_REFRESH_MS = 6 * HOUR

const AISSTREAM_URL = 'wss://stream.aisstream.io/v0/stream'
const KEY_NAME = 'AISSTREAM_API_KEY'

const table = new VesselTable()
let staticLoadedAt = 0
let apiKey = ''

const [west, south, east, north] = SEA_BBOX
const aisStream = new LazyStream({
  name: 'AISStream',
  url: AISSTREAM_URL,
  idleCloseMs: 3 * 60 * 1000,
  onOpen(send) {
    // AISStream drops connections that do not subscribe within three seconds.
    send(
      JSON.stringify({
        APIKey: apiKey,
        BoundingBoxes: [
          [
            [south, west],
            [north, east],
          ],
        ],
        FilterMessageTypes: ['PositionReport', 'StandardClassBPositionReport', 'ShipStaticData', 'StaticDataReport'],
      }),
    )
  },
  onMessage(raw, receivedAt) {
    const parsed = parseAisStreamMessage(raw, receivedAt)
    if (parsed?.position) table.position(parsed.position)
    if (parsed?.static) table.describe(parsed.static)
    return parsed !== null
  },
})

/**
 * Ships from AIS. Two sources feed one table:
 *
 *  - Digitraffic (Finnish open data, no key): reliable, but its receivers only reach
 *    the northern approaches, from the Irbe Strait towards the Gulf of Finland.
 *  - AISStream (free key): covers Rīga, Liepāja, Ventspils and the Gulf of Rīga. Only
 *    used when AISSTREAM_API_KEY is set; its socket is opened on demand like the trains'.
 */
export const shipsFeed: FeedDef = {
  id: 'ships',
  title: 'Ships',
  origins: ['https://meri.digitraffic.fi'],
  ttlMs: 30_000,
  staleMs: 10 * 60 * 1000,
  waitMs: 2000,
  timeoutMs: 15_000,
  attribution: [
    { label: 'Fintraffic / digitraffic.fi (CC BY 4.0)', href: 'https://www.digitraffic.fi/en/marine-traffic/' },
    { label: 'AISStream', href: 'https://aisstream.io' },
  ],
  async load({ http, env, now, feed }) {
    apiKey = env[KEY_NAME] ?? ''
    // Never fatal: with the socket still connecting (or no key at all) the open data alone is served.
    if (apiKey) await aisStream.ready(1500).catch(() => undefined)

    const positions = await http
      .json(`${DIGITRAFFIC}/locations?latitude=57.6&longitude=22.2&radius=260`, { headers: DIGITRAFFIC_HEADERS, timeoutMs: 8000 })
      .then((data) => parseDigitrafficLocations(data as Parameters<typeof parseDigitrafficLocations>[0], Date.now()))
      .catch((err: unknown) => {
        // Without a key this is the only source, so its failure is the feed's failure.
        if (!apiKey) throw err
        return []
      })
    for (const position of positions) table.position(position)

    if (now - staticLoadedAt > STATIC_REFRESH_MS) {
      const vessels = await http
        .json(`${DIGITRAFFIC}/vessels`, { headers: DIGITRAFFIC_HEADERS, timeoutMs: 8000 })
        .catch(() => null)
      if (Array.isArray(vessels)) {
        for (const update of parseDigitrafficVessels(vessels)) table.describe(update)
        staticLoadedAt = now
      }
    }
    table.prune(now)

    const listed = await feed('sanctions').catch(() => null)
    const sanctioned =
      listed?.payload.shape === 'vessel-list'
        ? { mmsi: new Set(listed.payload.mmsi), imo: new Set(listed.payload.imo) }
        : { mmsi: new Set<number>(), imo: new Set<number>() }

    return { shape: 'entities', entities: table.view(SEA_BBOX, sanctioned) }
  },
}
