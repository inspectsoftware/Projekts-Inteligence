import type { ExpressionSpecification, LayerSpecification, Map as MapLibreMap } from 'maplibre-gl'
import { type Timetable, formatClock, nextDepartures } from '../../shared/adapters/timetable'
import type { TransitMode } from '../../shared/adapters/transit'
import { t } from '../i18n'
import { serverNow } from '../runtime/clock'
import { MODE_LABEL } from './transit'
import type { InspectorModel, LayerDef } from './types'

/**
 * Rīgas satiksme publishes its timetable but not where its vehicles are, so Rīga is drawn
 * as routes and stops, baked by scripts/bake-riga-transit.ts, and a stop answers with the
 * scheduled departures instead of a moving icon.
 */
const SOURCE = 'riga-transit'
const MODES: readonly TransitMode[] = ['bus', 'tram', 'trolleybus']
// The colours of the live vehicles in transit.ts, so a tram line and a tram look alike.
const MODE_COLOR: ExpressionSpecification = ['match', ['get', 'mode'], 'tram', '#ff80aa', 'trolleybus', '#7ec8ff', '#ffc460']
const classIs = (name: string): ExpressionSpecification => ['==', ['get', 'class'], name]

const SPECS = [
  {
    id: 'riga-route',
    type: 'line',
    minzoom: 9,
    filter: classIs('route'),
    paint: { 'line-color': MODE_COLOR, 'line-opacity': 0.55, 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 0.6, 14, 2] },
  },
  {
    id: 'riga-stop',
    type: 'circle',
    minzoom: 12.5,
    filter: classIs('stop'),
    paint: { 'circle-radius': 3, 'circle-color': '#05080b', 'circle-stroke-color': '#ffc460', 'circle-stroke-width': 1.2 },
  },
  {
    id: 'riga-stop-label',
    type: 'symbol',
    minzoom: 14.5,
    filter: classIs('stop'),
    layout: {
      'text-field': ['get', 'name'],
      'text-font': ['Noto Sans Regular'],
      'text-size': 10.5,
      'text-offset': [0, 0.9],
      'text-anchor': 'top',
      'text-max-width': 8,
      'text-optional': true,
    },
    paint: { 'text-color': '#ffc460', 'text-halo-color': '#05080b', 'text-halo-width': 1.4, 'text-halo-blur': 0.4 },
  },
] as const

let shownOn: MapLibreMap | null = null
let timetable: Timetable | null = null
let asked = false

const text = (value: unknown): string | undefined => (typeof value === 'string' && value ? value : undefined)

function describeStop(p: Record<string, unknown>): InspectorModel {
  const rows = MODES.flatMap((mode) => (text(p[mode]) ? [{ label: MODE_LABEL[mode], value: text(p[mode])! }] : []))
  if (timetable) {
    const lines = nextDepartures(timetable, String(p.id), serverNow())
    for (const line of lines) rows.push({ label: `${MODE_LABEL[line.mode]} ${line.route} → ${line.headsign}`, value: line.times.map(formatClock).join(' · ') })
    if (lines.length === 0) rows.push({ label: t('Departures'), value: t('None in the next 3 hours') })
  }
  return {
    kicker: t('Public transport stop'),
    title: text(p.name) ?? t('Public transport stop'),
    subtitle: 'Rīgas satiksme',
    badges: [{ text: t('Timetable, not live'), tone: 'info' }, ...(p.request ? [{ text: t('Request stop'), tone: 'info' as const }] : [])],
    rows,
    links: [{ label: t('Timetable (saraksti.lv)'), href: `https://saraksti.lv/#stop/${encodeURIComponent(String(p.id))}` }],
  }
}

function describeRoute(p: Record<string, unknown>): InspectorModel {
  // Only a link the baker took from the operator's own file is offered.
  const url = text(p.url)?.startsWith('https://saraksti.lv/') ? text(p.url)! : 'https://saraksti.lv'
  return {
    kicker: MODE_LABEL[p.mode as TransitMode] ?? MODE_LABEL.bus,
    title: t('Route {route}', { route: String(p.ref) }),
    subtitle: text(p.name),
    badges: [],
    rows: [],
    links: [{ label: t('Timetable (saraksti.lv)'), href: url }],
  }
}

export const rigaTransitLayer: LayerDef = {
  id: 'riga-transit',
  group: 'land',
  label: t('Rīga routes and stops'),
  hint: t('Routes, stops and timetables of Rīgas satiksme buses, trams and trolleybuses. Scheduled times, not live positions'),
  defaultOn: false,
  swatch: '#ffc460',
  feeds: [],
  attribution: [{ label: t('Rīgas satiksme open data (CC0)'), href: 'https://data.gov.lv/dati/lv/dataset/marsrutu-saraksti-rigas-satiksme-sabiedriskajam-transportam' }],
  build: () => [],
  native: {
    interactive: ['riga-stop', 'riga-route'],
    show(map) {
      shownOn = map
      if (!map.getSource(SOURCE)) map.addSource(SOURCE, { type: 'geojson', data: '/data/riga-transit.json' })
      for (const spec of SPECS) {
        if (!map.getLayer(spec.id)) map.addLayer({ ...spec, source: SOURCE } as unknown as LayerSpecification)
      }
      // Only those who switch the layer on pay for the timetable. Without it a stop still lists its lines.
      if (!asked) {
        asked = true
        fetch('/data/riga-timetable.json')
          .then((res) => (res.ok ? res.json() : null))
          .then((loaded: Timetable | null) => {
            timetable = loaded
          })
          .catch(() => {
            asked = false
          })
      }
    },
    hide() {
      for (const spec of SPECS) if (shownOn?.getLayer(spec.id)) shownOn.removeLayer(spec.id)
      shownOn = null
    },
    pick(properties, lon, lat) {
      return { lon, lat, model: properties.class === 'stop' ? describeStop(properties) : describeRoute(properties) }
    },
  },
}
