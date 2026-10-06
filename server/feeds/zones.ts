import { EANS_PAGE, LGS_PAGE, type UasZones, normaliseEansZones, parseLgsNotams } from '../../shared/adapters/airspace'
import {
  ESTONIAN_PAGE,
  type EstonianWarnings,
  NAVTEX_PAGE,
  mergeSeaWarnings,
  normaliseEstonianWarnings,
  parseNavtex,
} from '../../shared/adapters/navwarn'
import { sortZones } from '../../shared/adapters/zones'
import { LV_AIRSPACE } from '../../shared/data/lvAirspace'
import type { Zone } from '../../shared/feeds'
import { UpstreamError } from '../core/upstream'
import type { FeedDef } from './types'

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const KB = 1024

/** What each source delivered, or nothing for one that failed. All of them failing is a failed refresh. */
function served(results: PromiseSettledResult<Zone[]>[]): Zone[][] {
  const failed = results.find((result) => result.status === 'rejected')
  if (failed && results.every((result) => result.status === 'rejected')) throw failed.reason
  return results.map((result) => (result.status === 'fulfilled' ? result.value : []))
}

const ESTONIAN_LAYERS = 'https://gis.transpordiamet.ee/arcgis/rest/services/navigatsioonihoiatused/nav_hoiatused_avalik/MapServer'
// Only the fields that are shown: the layers also carry the names of the staff who entered each warning.
const ESTONIAN_QUERY = 'query?where=1%3D1&outFields=warning_number,date_from,date_to,ntfct_title_eng,ntfct_text_eng,area_eng&f=geojson'

/**
 * Navigational warnings in force at sea: where a navy says it will exercise or fire, where
 * something is dangerous, and the everyday business of lights and buoys. Sweden broadcasts
 * them for the whole Baltic, Russian exercise areas included; Estonia adds outlines for its own.
 */
export const navwarnFeed: FeedDef = {
  id: 'navwarn',
  title: 'Sea warnings',
  origins: ['https://navvarn.sjofartsverket.se', 'https://gis.transpordiamet.ee'],
  // The page changes a few times a day.
  ttlMs: 15 * MINUTE,
  staleMs: 6 * HOUR,
  timeoutMs: 25_000,
  persist: true,
  attribution: [
    { label: 'Swedish Maritime Administration (BALTICO)', href: NAVTEX_PAGE },
    { label: 'Estonian Transport Administration', href: ESTONIAN_PAGE },
  ],
  async load({ http, now }) {
    const [navtex, estonian] = served(
      await Promise.allSettled([
        http.text(NAVTEX_PAGE, { maxBytes: 1024 * KB, timeoutMs: 15_000 }).then((html) => {
          // There is always something in force somewhere: a page without a single warning has changed its markup.
          if (!/NAV\s+WARN/.test(html)) throw new UpstreamError('bad-body', 'The BALTICO page no longer reads as it did')
          return parseNavtex(html, now)
        }),
        // Points, lines and areas are three layers of the same service.
        Promise.all(
          [7, 8, 9].map((layer) =>
            http.json<EstonianWarnings>(`${ESTONIAN_LAYERS}/${layer}/${ESTONIAN_QUERY}`, { maxBytes: 512 * KB, timeoutMs: 15_000 }),
          ),
        ).then((layers) => normaliseEstonianWarnings(layers, now)),
      ]),
    )
    return { shape: 'zones', zones: mergeSeaWarnings(navtex, estonian) }
  },
}

/**
 * Airspace closed, reserved or declared dangerous by NOTAM: activated military training areas,
 * firing ranges, temporary restrictions. Estonia publishes its own with outlines; Latvia's
 * NOTAMs only name an area, so its outline is looked up in the table baked from the AIP.
 * Lithuania publishes nothing that can be read without a browser.
 */
export const airspaceFeed: FeedDef = {
  id: 'airspace',
  title: 'Airspace restrictions',
  origins: ['https://utm.eans.ee', 'https://ais.lgs.lv'],
  // Activations are published hours ahead, and the Estonian file is 5 MB a time: no need to hurry.
  ttlMs: 15 * MINUTE,
  staleMs: 3 * HOUR,
  timeoutMs: 40_000,
  persist: true,
  attribution: [
    { label: 'LGS (Latvijas gaisa satiksme) AIS', href: 'https://ais.lgs.lv' },
    { label: 'EANS (Estonian Air Navigation Services)', href: EANS_PAGE },
  ],
  async load({ http, now }) {
    const zones = served(
      await Promise.allSettled([
        // Every drone zone in Estonia comes in this one file. Only the handful a NOTAM switched on leaves this function.
        http
          .json<UasZones>('https://utm.eans.ee/avm/utm/uas.geojson', { maxBytes: 8 * 1024 * KB, timeoutMs: 35_000 })
          .then((file) => {
            if (!Array.isArray(file.features)) throw new UpstreamError('bad-body', 'The EANS zone file no longer reads as it did')
            return normaliseEansZones(file, now)
          }),
        http.text(LGS_PAGE, { maxBytes: 2 * 1024 * KB, timeoutMs: 20_000 }).then((html) => {
          if (!html.includes('<h6>')) throw new UpstreamError('bad-body', 'The LGS NOTAM page no longer reads as it did')
          return parseLgsNotams(html, LV_AIRSPACE, now)
        }),
      ]),
    )
    return { shape: 'zones', zones: sortZones(zones.flat()) }
  },
}
