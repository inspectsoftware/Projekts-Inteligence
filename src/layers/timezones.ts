import type { Map as MapLibreMap } from 'maplibre-gl'
import { locale, t } from '../i18n'
import { serverNow } from '../runtime/clock'
import type { LayerDef, StaticSelection } from './types'

const SOURCE = 'timezones'
const LINE = 'timezones-line'
const LABEL = 'timezones-label'

const CLOCK = { weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false } as const

/**
 * The time in a zone right now. A zone that names a tz database region gets that region's time,
 * daylight saving included; the others (stretches of sea, mostly) get the fixed offset drawn on the map.
 */
export function localTime(now: number, offsetHours: number, iana?: string): string {
  if (iana) {
    try {
      return new Intl.DateTimeFormat(locale, { ...CLOCK, timeZone: iana }).format(now)
    } catch {
      // A region this browser does not know: the offset is still right outside daylight saving.
    }
  }
  return new Intl.DateTimeFormat(locale, { ...CLOCK, timeZone: 'UTC' }).format(now + offsetHours * 3600_000)
}

let shownOn: MapLibreMap | null = null

function describe(properties: Record<string, unknown>, lon: number, lat: number): StaticSelection | null {
  const offset = Number(properties.offset)
  if (!Number.isFinite(offset)) return null
  const iana = typeof properties.iana === 'string' ? properties.iana : undefined
  const rows = [{ label: t('Time there now'), value: localTime(serverNow(), offset, iana) }]
  if (typeof properties.places === 'string' && properties.places) rows.push({ label: t('Covers'), value: properties.places })
  if (iana) rows.push({ label: t('Region'), value: iana })
  return { lon, lat, model: { kicker: t('Time zone'), title: String(properties.label), badges: [], rows, links: [] } }
}

/** Time zone boundaries with their offset from UTC. Standard time only: the lines do not move with daylight saving. */
export const timezonesLayer: LayerDef = {
  id: 'timezones',
  group: 'reference',
  label: t('Time zones'),
  hint: t('Time zone boundaries and their offset from UTC. Click a boundary or a label for the time there now'),
  defaultOn: false,
  swatch: '#b78cff',
  feeds: [],
  attribution: [{ label: 'Natural Earth', href: 'https://www.naturalearthdata.com' }],
  build: () => [],
  native: {
    // The lines and the labels, not the zones' whole area: a click on open map must stay free for whatever lies there.
    interactive: [LINE, LABEL],
    show(map) {
      shownOn = map
      if (!map.getSource(SOURCE)) map.addSource(SOURCE, { type: 'geojson', data: '/data/timezones.json' })
      if (!map.getLayer(LINE)) {
        map.addLayer({ id: LINE, type: 'line', source: SOURCE, paint: { 'line-color': '#b78cff', 'line-opacity': 0.55, 'line-width': 1, 'line-dasharray': [4, 3] } })
      }
      if (!map.getLayer(LABEL)) {
        map.addLayer({
          id: LABEL,
          type: 'symbol',
          source: SOURCE,
          layout: { 'text-field': ['get', 'label'], 'text-font': ['Noto Sans Bold'], 'text-size': ['interpolate', ['linear'], ['zoom'], 2, 10, 6, 13], 'text-letter-spacing': 0.08 },
          paint: { 'text-color': '#b78cff', 'text-halo-color': '#05080b', 'text-halo-width': 1.4 },
        })
      }
    },
    hide() {
      for (const id of [LABEL, LINE]) if (shownOn?.getLayer(id)) shownOn.removeLayer(id)
      shownOn = null
    },
    pick: describe,
  },
}
