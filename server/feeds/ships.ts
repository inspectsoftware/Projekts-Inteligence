import { parseVesselRisks } from '../../shared/adapters/sanctions'
import {
  VesselTable,
  parseAisStreamMessage,
  parseDigitrafficLocations,
  parseDigitrafficVessels,
} from '../../shared/adapters/ships'
import { WARSHIPS } from '../../shared/data/warships'
import type { BBox } from '../../shared/region'
import { LazyStream } from '../core/stream'
import type { FeedDef } from './types'

const HOUR = 60 * 60 * 1000

/** The eastern Baltic: the Gulf of Rīga, the Irbe Strait, the open coast down to Klaipėda, and the Gulf of Finland to Helsinki and past Tallinn. */
const SEA_BBOX: BBox = [18.5, 55.3, 26.5, 60.3]

const OPEN_SANCTIONS = { label: 'OpenSanctions (CC BY-NC)', href: 'https://www.opensanctions.org/datasets/maritime/' }

/**
 * Vessels under sanctions or listed as shadow fleet, by IMO number and MMSI, from OpenSanctions'
 * maritime list. A 5 MB download reduced to four lists of numbers, refreshed daily and kept on disk.
 */
export const sanctionsFeed: FeedDef = {
  id: 'sanctions',
  title: 'Sanctioned vessels',
  origins: ['https://data.opensanctions.org'],
  ttlMs: 24 * HOUR,
  staleMs: 14 * 24 * HOUR,
  timeoutMs: 45_000,
  persist: true,
  attribution: [OPEN_SANCTIONS],
  async load({ http }) {
    const csv = await http.text('https://data.opensanctions.org/datasets/latest/maritime/maritime.csv', {
      maxBytes: 16 * 1024 * 1024,
      timeoutMs: 40_000,
    })
    return { shape: 'vessel-list', ...parseVesselRisks(csv) }
  },
}

const DIGITRAFFIC = 'https://meri.digitraffic.fi/api/ais/v1'
// Digitraffic asks callers to name themselves in this header.
const DIGITRAFFIC_HEADERS = { 'Digitraffic-User': 'ProjektsInteligence' }
/** Circles asked for positions, km: the Gulf of Rīga and Latvia's coast, and the Gulf of Finland. */
const DIGITRAFFIC_AREAS = ['latitude=57.6&longitude=22.2&radius=260', 'latitude=59.6&longitude=24.6&radius=150']
/** Ship names and types change rarely; the whole list is small, so it is simply re-read now and then. */
const STATIC_REFRESH_MS = 6 * HOUR

const AISSTREAM_URL = 'wss://stream.aisstream.io/v0/stream'
const KEY_NAME = 'AISSTREAM_API_KEY'

const table = new VesselTable()
let staticLoadedAt = 0
/** The names and types Digitraffic last listed, by MMSI. */
const knownVessels = new Map<number, ReturnType<typeof parseDigitrafficVessels>[number]>()
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
    // What the ships are checked against: the sanctions lists, the navy list, the edge of Latvian waters.
    OPEN_SANCTIONS,
    { label: 'Wikidata (CC0)', href: 'https://www.wikidata.org' },
    { label: 'Marine Regions (CC BY)', href: 'https://www.marineregions.org' },
  ],
  async load({ http, env, now, feed }) {
    apiKey = env[KEY_NAME] ?? ''
    // Never fatal: with the socket still connecting (or no key at all) the open data alone is served.
    if (apiKey) await aisStream.ready(1500).catch(() => undefined)

    // Two circles: the Gulf of Rīga and its approaches, and the Gulf of Finland, where the Tallinn–Helsinki ferries run.
    const asked = await Promise.allSettled(
      DIGITRAFFIC_AREAS.map((area) =>
        http
          .json(`${DIGITRAFFIC}/locations?${area}`, { headers: DIGITRAFFIC_HEADERS, timeoutMs: 8000 })
          .then((data) => parseDigitrafficLocations(data as Parameters<typeof parseDigitrafficLocations>[0], Date.now())),
      ),
    )
    // Without a key this is the only source, so both failing is the feed's failure.
    const failed = asked.find((result) => result.status === 'rejected')
    if (!apiKey && failed && asked.every((result) => result.status === 'rejected')) throw failed.reason
    for (const result of asked) if (result.status === 'fulfilled') for (const position of result.value) table.position(position)

    if (now - staticLoadedAt > STATIC_REFRESH_MS) {
      const vessels = await http
        .json(`${DIGITRAFFIC}/vessels`, { headers: DIGITRAFFIC_HEADERS, timeoutMs: 8000 })
        .catch((err: unknown) => {
          console.warn('[pwh] ships: Digitraffic vessel list unavailable:', err instanceof Error ? err.message : err)
          return null
        })
      if (Array.isArray(vessels)) {
        for (const update of parseDigitrafficVessels(vessels)) knownVessels.set(update.mmsi, update)
        staticLoadedAt = now
      }
    }
    // Every time, not only when the list arrives: a ship that came into range since is named too.
    for (const update of knownVessels.values()) table.describe(update)
    table.prune(now)

    // Without the list (or with a copy kept from before it carried the shadow fleet) nothing is flagged.
    const listed = await feed('sanctions').catch(() => null)
    const risks = listed?.payload.shape === 'vessel-list' ? listed.payload : null

    return {
      shape: 'entities',
      entities: table.view(SEA_BBOX, {
        sanctioned: { mmsi: new Set(risks?.mmsi), imo: new Set(risks?.imo) },
        shadow: { mmsi: new Set(risks?.shadowMmsi), imo: new Set(risks?.shadowImo) },
        warships: WARSHIPS,
      }),
    }
  },
}
