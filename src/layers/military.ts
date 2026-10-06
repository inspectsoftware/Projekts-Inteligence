import type { LayerSpecification, Map as MapLibreMap } from 'maplibre-gl'
import { t } from '../i18n'
import { formatLat, formatLon } from '../lib/coords'
import { getMap } from '../map/instance'
import { isLayerOn, useLayers } from '../state/layers'
import { useSelection } from '../state/selection'
import type { LayerDef, NativeLayer, StaticSelection } from './types'

/**
 * Standing military geography, baked into public/data/ by scripts/bake-military.mjs: where
 * the bases, training areas and radar sites are, and which stretches of sea are set aside
 * for exercises. Reference only; what is active today is in the zone layers.
 */
const MIL = '#ff8a3d'

export const SITES_URL = '/data/mil-sites.json'
const SEA_AREAS_URL = '/data/sea-exercise-areas.json'

/** One entry of mil-sites.json. Every word of it is backed by the page at `source`. */
export interface SiteProperties {
  name: string
  country: string
  kind: keyof typeof SITE_KINDS
  operator?: string
  note: string
  source: string
  /** The marker stands on the town or area the source names, not on the site itself. */
  approx?: boolean
}

export const SITE_KINDS = {
  air: t('Air base'),
  naval: t('Naval base'),
  army: t('Army base'),
  training: t('Training area'),
  sensor: t('Radar or radio site'),
  other: t('Other'),
} as const

export const COUNTRY_NAMES: Record<string, string> = {
  LV: t('Latvia'),
  LT: t('Lithuania'),
  EE: t('Estonia'),
  PL: t('Poland'),
  SE: t('Sweden'),
  FI: t('Finland'),
  RU: t('Russia'),
  BY: t('Belarus'),
}

const text = (value: unknown): string | undefined => (typeof value === 'string' && value ? value : undefined)
/** Only ever a link to the open web: the data is baked by us, but a link is still checked before it is shown. */
const webLink = (label: string, value: unknown) => (/^https?:\/\//.test(text(value) ?? '') ? [{ label, href: value as string }] : [])

const SOURCE_NAMES: Record<string, string> = {
  'en.wikipedia.org': 'Wikipedia',
  'www.wikidata.org': 'Wikidata',
  'www.openstreetmap.org': 'OpenStreetMap',
}

/** A site as the inspector shows it. Takes loose properties, because the map hands them back that way. */
export function siteSelection(p: Record<string, unknown>, lon: number, lat: number): StaticSelection {
  const source = text(p.source) ?? ''
  const host = /^https?:\/\/([^/]+)/.exec(source)?.[1] ?? ''
  return {
    lon,
    lat,
    model: {
      kicker: SITE_KINDS[p.kind as keyof typeof SITE_KINDS] ?? t('Military site'),
      title: text(p.name) ?? t('Military site'),
      subtitle: COUNTRY_NAMES[text(p.country) ?? ''],
      badges: p.approx ? [{ text: t('Marker is approximate'), tone: 'warn' }] : [],
      rows: [
        ...(text(p.operator) ? [{ label: t('Operator'), value: text(p.operator)! }] : []),
        { label: t('What the source says'), value: text(p.note) ?? '' },
        { label: t('Position'), value: `${formatLat(lat)}  ${formatLon(lon)}` },
      ],
      links: webLink(t('Source: {name}', { name: SOURCE_NAMES[host] ?? host }), source),
    },
  }
}

/** A native layer over one baked GeoJSON file. With `under`, it goes in beneath the layers whose ids start that way. */
function bakedLayer(
  source: string,
  url: string,
  specs: readonly LayerSpecification[],
  interactive: readonly string[],
  pick: NonNullable<NativeLayer['pick']>,
  under?: string,
): NativeLayer {
  let map: MapLibreMap | null = null
  return {
    interactive,
    pick,
    show(target) {
      map = target
      if (!target.getSource(source)) target.addSource(source, { type: 'geojson', data: url })
      const above = under ? target.getLayersOrder().find((id) => id.startsWith(under)) : undefined
      for (const spec of specs) if (!target.getLayer(spec.id)) target.addLayer(spec, above)
    },
    hide() {
      for (const spec of specs) if (map?.getLayer(spec.id)) map.removeLayer(spec.id)
      if (map?.getSource(source)) map.removeSource(source)
      map = null
    },
  }
}

const LABEL_PAINT = { 'text-halo-color': '#05080b', 'text-halo-width': 1.4, 'text-halo-blur': 0.4 }

export const militarySitesLayer: LayerDef = {
  id: 'military-sites',
  group: 'reference',
  label: t('Military sites'),
  hint: t('Bases, training areas and radar sites around the Baltic, each with the public source it rests on. Markers on a town are approximate'),
  defaultOn: false,
  swatch: MIL,
  feeds: [],
  attribution: [
    { label: 'Wikipedia (CC BY-SA 4.0)', href: 'https://en.wikipedia.org/wiki/Wikipedia:Copyrights' },
    { label: 'Wikidata (CC0)', href: 'https://www.wikidata.org' },
    { label: '© OpenStreetMap contributors', href: 'https://www.openstreetmap.org/copyright' },
  ],
  build: () => [],
  native: bakedLayer(
    'mil-sites',
    SITES_URL,
    [
      {
        id: 'mil-sites-mark',
        type: 'circle',
        source: 'mil-sites',
        paint: {
          'circle-radius': 5,
          // Hollow where the marker only stands for a town.
          'circle-color': ['case', ['has', 'approx'], '#05080b', MIL],
          'circle-stroke-color': ['case', ['has', 'approx'], MIL, '#05080b'],
          'circle-stroke-width': 1.5,
        },
      },
      {
        id: 'mil-sites-label',
        type: 'symbol',
        source: 'mil-sites',
        minzoom: 6,
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['Noto Sans Regular'],
          'text-size': 10.5,
          'text-offset': [0, 1],
          'text-anchor': 'top',
          'text-max-width': 9,
          'text-optional': true,
        },
        paint: { ...LABEL_PAINT, 'text-color': MIL },
      },
    ],
    ['mil-sites-mark'],
    siteSelection,
  ),
}

export const seaExerciseAreasLayer: LayerDef = {
  id: 'sea-exercise-areas',
  group: 'reference',
  label: t('Sea exercise areas'),
  hint: t('Stretches of sea each coastal state has set aside for its forces: firing and exercise areas and defence zones, from national maritime plans. Standing outlines, not activations'),
  defaultOn: false,
  swatch: MIL,
  feeds: [],
  attribution: [{ label: 'EMODnet Human Activities (CC BY 4.0)', href: 'https://emodnet.ec.europa.eu/en/human-activities' }],
  build: () => [],
  native: bakedLayer(
    'sea-exercise-areas',
    SEA_AREAS_URL,
    [
      { id: 'sea-exercise-areas-fill', type: 'fill', source: 'sea-exercise-areas', paint: { 'fill-color': MIL, 'fill-opacity': 0.06 } },
      {
        id: 'sea-exercise-areas-outline',
        type: 'line',
        source: 'sea-exercise-areas',
        paint: { 'line-color': MIL, 'line-opacity': 0.5, 'line-width': 0.8, 'line-dasharray': [1, 2] },
      },
    ],
    ['sea-exercise-areas-fill'],
    (p, lon, lat) => ({
      lon,
      lat,
      model: {
        kicker: t('Sea exercise area'),
        title: text(p.type) ?? t('Military area'),
        subtitle: text(p.country),
        badges: [],
        rows: [
          { label: t('Status'), value: text(p.status) ?? t('Unknown') },
          ...(typeof p.km2 === 'number' ? [{ label: t('Area'), value: `${p.km2} km²` }] : []),
        ],
        links: [...webLink(t('National source'), p.source), { label: 'EMODnet Human Activities', href: 'https://emodnet.ec.europa.eu/en/human-activities' }],
      },
    }),
    // A click inside both a standing area and a zone announced for today (src/layers/zones.ts) must reach the zone.
    'zones-',
  ),
}

/** Switches the sites layer on, flies to a site and opens it in the inspector. */
export function showSite(properties: SiteProperties, lon: number, lat: number): void {
  const { visible, toggle } = useLayers.getState()
  if (!isLayerOn(visible, militarySitesLayer.id, false)) toggle(militarySitesLayer.id, false)
  useSelection.getState().selectFeature(siteSelection({ ...properties }, lon, lat))
  const map = getMap()
  map?.flyTo({ center: [lon, lat], zoom: Math.max(map.getZoom(), 8.5), duration: 1400 })
}
