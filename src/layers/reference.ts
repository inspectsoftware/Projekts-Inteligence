import type { ExpressionSpecification, LayerSpecification, Map as MapLibreMap } from 'maplibre-gl'
import { formatLat, formatLon, formatMgrs } from '../lib/coords'
import type { InspectorModel, LayerDef, NativeLayer, StaticSelection } from './types'

/**
 * Fixed reference layers, baked from OpenStreetMap and official boundaries into
 * public/data/ and drawn by the map itself. They change over months, not minutes,
 * so nothing here polls anything.
 */
const OSM_ATTRIBUTION = [{ label: '© OpenStreetMap contributors', href: 'https://www.openstreetmap.org/copyright' }]

const SOURCES = {
  infrastructure: '/data/lv-infrastructure.json',
  municipalities: '/data/lv-municipalities.json',
} as const

const LABEL_PAINT = { 'text-halo-color': '#05080b', 'text-halo-width': 1.4, 'text-halo-blur': 0.4 }
const classIs = (name: string): ExpressionSpecification => ['==', ['get', 'class'], name]

/** A style layer minus its source, which staticLayer() fills in. */
interface RefSpec {
  id: string
  type: 'line' | 'circle' | 'symbol'
  minzoom?: number
  filter?: ExpressionSpecification
  layout?: Record<string, unknown>
  paint?: Record<string, unknown>
}

type Describe = (properties: Record<string, unknown>) => Pick<InspectorModel, 'kicker' | 'title' | 'subtitle' | 'badges' | 'rows'>

const text = (value: unknown): string | undefined => (typeof value === 'string' && value ? value : undefined)

/** A native layer made of style layers over one of the baked GeoJSON files. */
function staticLayer(
  source: keyof typeof SOURCES,
  specs: readonly RefSpec[],
  describe?: Describe,
): NativeLayer {
  let shownOn: MapLibreMap | null = null
  const sourceId = `ref-${source}`

  return {
    interactive: describe ? specs.map((spec) => spec.id) : undefined,
    show(map) {
      shownOn = map
      if (!map.getSource(sourceId)) map.addSource(sourceId, { type: 'geojson', data: SOURCES[source] })
      for (const spec of specs) {
        if (!map.getLayer(spec.id)) map.addLayer({ ...spec, source: sourceId } as LayerSpecification)
      }
    },
    hide() {
      // The source stays: other reference layers may share it, and it is only a few hundred kilobytes.
      for (const spec of specs) if (shownOn?.getLayer(spec.id)) shownOn.removeLayer(spec.id)
      shownOn = null
    },
    pick(properties, lon, lat): StaticSelection | null {
      if (!describe) return null
      const model = describe(properties)
      return {
        lon,
        lat,
        model: {
          ...model,
          rows: [
            ...model.rows,
            { label: 'Position', value: `${formatLat(lat)}  ${formatLon(lon)}` },
            { label: 'MGRS', value: formatMgrs(lon, lat) },
          ],
          links: [
            {
              label: 'OpenStreetMap',
              href: `https://www.openstreetmap.org/#map=14/${lat.toFixed(5)}/${lon.toFixed(5)}`,
            },
          ],
        },
      }
    },
  }
}

function referenceLayer(def: Pick<LayerDef, 'id' | 'label' | 'hint' | 'swatch' | 'defaultOn'>, native: NativeLayer): LayerDef {
  return { ...def, group: 'reference', feeds: [], attribution: OSM_ATTRIBUTION, native, build: () => [] }
}

const SOURCE_LABEL: Record<string, string> = {
  hydro: 'Hydroelectric',
  gas: 'Gas',
  wind: 'Wind',
  solar: 'Solar',
  biomass: 'Biomass',
  biogas: 'Biogas',
  coal: 'Coal',
  oil: 'Oil',
  waste: 'Waste',
}

export const municipalitiesLayer: LayerDef = {
  ...referenceLayer(
    {
      id: 'municipalities',
      label: 'Municipalities',
      hint: 'The 36 municipalities and 7 state cities (official boundaries, 2026)',
      swatch: '#6f8696',
      defaultOn: false,
    },
    staticLayer('municipalities', [
      {
        id: 'ref-municipalities-line',
        type: 'line',
        paint: { 'line-color': '#6f8696', 'line-opacity': 0.55, 'line-width': 0.8, 'line-dasharray': [3, 2] },
      },
      {
        id: 'ref-municipalities-label',
        type: 'symbol',
        minzoom: 6.8,
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['Noto Sans Regular'],
          'text-size': 10.5,
          'text-letter-spacing': 0.12,
          'text-transform': 'uppercase',
          'text-max-width': 7,
        },
        paint: { ...LABEL_PAINT, 'text-color': '#7f95a4' },
      },
    ]),
  ),
  attribution: [{ label: 'Boundaries: data.gov.lv (CC0)', href: 'https://data.gov.lv' }],
}

export const powerLayer = referenceLayer(
  {
    id: 'power',
    label: 'Power grid',
    hint: 'Transmission lines of 110 kV and above, their substations, and power plants',
    swatch: '#ffcc66',
    defaultOn: false,
  },
  staticLayer(
    'infrastructure',
    [
      {
        id: 'ref-power-line',
        type: 'line',
        filter: classIs('power-line'),
        paint: {
          'line-color': ['case', ['>=', ['get', 'kv'], 330], '#ffcc66', '#a8813a'],
          'line-opacity': 0.75,
          'line-width': ['case', ['>=', ['get', 'kv'], 330], 1.6, 0.8],
        },
      },
      {
        id: 'ref-power-substation',
        type: 'circle',
        minzoom: 7,
        filter: classIs('substation'),
        paint: {
          'circle-radius': ['case', ['>=', ['get', 'kv'], 330], 4, 2.5],
          'circle-color': '#05080b',
          'circle-stroke-color': '#ffcc66',
          'circle-stroke-width': 1.2,
        },
      },
      {
        id: 'ref-power-plant',
        type: 'circle',
        filter: classIs('power-plant'),
        paint: {
          // Area, not radius, follows the rated output: a 900 MW dam is not ten times a 90 MW wind farm wide.
          'circle-radius': ['interpolate', ['linear'], ['sqrt', ['coalesce', ['get', 'mw'], 1]], 1, 3, 10, 6, 30, 11],
          'circle-color': [
            'match',
            ['get', 'source'],
            'hydro',
            '#5aa9ff',
            'wind',
            '#6fe0d0',
            'solar',
            '#ffe066',
            'gas',
            '#ff9a5a',
            'biomass',
            '#8fd66b',
            'biogas',
            '#8fd66b',
            '#c9d6e0',
          ],
          'circle-stroke-color': '#05080b',
          'circle-stroke-width': 1.5,
        },
      },
      {
        id: 'ref-power-plant-label',
        type: 'symbol',
        minzoom: 6,
        // The big stations are named from the national view; the rest once there is room.
        filter: ['all', classIs('power-plant'), ['any', ['>=', ['zoom'], 8.5], ['>=', ['coalesce', ['get', 'mw'], 0], 100]]],
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['Noto Sans Regular'],
          'text-size': 10.5,
          'text-offset': [0, 1.2],
          'text-anchor': 'top',
          'text-max-width': 8,
          'text-optional': true,
          'symbol-sort-key': ['-', ['coalesce', ['get', 'mw'], 0]],
        },
        paint: { ...LABEL_PAINT, 'text-color': '#ffcc66' },
      },
    ],
    (p) => {
      if (p.class === 'power-plant') {
        const source = text(p.source)
        return {
          kicker: 'Power plant',
          title: text(p.name) ?? 'Unnamed power plant',
          subtitle: source ? (SOURCE_LABEL[source] ?? source) : undefined,
          badges: [],
          rows: typeof p.mw === 'number' ? [{ label: 'Rated output', value: `${p.mw} MW` }] : [],
        }
      }
      if (p.class === 'substation') {
        return {
          kicker: 'Substation',
          title: text(p.name) ?? 'Substation',
          badges: [],
          rows: [{ label: 'Voltage', value: `${p.kv} kV` }],
        }
      }
      return { kicker: 'Transmission line', title: `${p.kv} kV line`, badges: [], rows: [] }
    },
  ),
)

export const aerodromesLayer = referenceLayer(
  {
    id: 'aerodromes',
    label: 'Airfields',
    hint: 'Airports and airfields, from the international airport down to grass strips',
    swatch: '#9fd3ff',
    defaultOn: true,
  },
  staticLayer(
    'infrastructure',
    [
      {
        id: 'ref-aerodrome',
        type: 'circle',
        filter: classIs('aerodrome'),
        paint: {
          'circle-radius': ['case', ['has', 'international'], 6, 3.5],
          'circle-color': '#05080b',
          'circle-stroke-color': ['case', ['has', 'military'], '#ff8a3d', '#9fd3ff'],
          'circle-stroke-width': ['case', ['has', 'international'], 2, 1.3],
        },
      },
      {
        id: 'ref-aerodrome-label',
        type: 'symbol',
        filter: ['all', classIs('aerodrome'), ['any', ['has', 'icao'], ['has', 'international']]],
        minzoom: 6.5,
        layout: {
          'text-field': ['coalesce', ['get', 'icao'], ['get', 'name']],
          'text-font': ['Noto Sans Bold'],
          'text-size': 10,
          'text-offset': [0, 1],
          'text-anchor': 'top',
          'text-letter-spacing': 0.1,
          'text-optional': true,
        },
        paint: { ...LABEL_PAINT, 'text-color': ['case', ['has', 'military'], '#ff8a3d', '#9fd3ff'] },
      },
    ],
    (p) => ({
      kicker: p.military ? 'Military airfield' : 'Airfield',
      title: text(p.name) ?? 'Airfield',
      subtitle: [text(p.icao), text(p.iata)].filter(Boolean).join(' · ') || undefined,
      badges: p.military ? [{ text: 'Military', tone: 'mil' as const }] : [],
      rows: [],
    }),
  ),
)

export const portsLayer: LayerDef = {
  ...referenceLayer(
    {
      id: 'ports',
      label: 'Ports',
      hint: "Latvia's ten sea ports: the three large ones (Rīga, Ventspils, Liepāja) and seven small harbours",
      swatch: '#5fb0ff',
      defaultOn: true,
    },
    staticLayer(
      'infrastructure',
      [
        {
          id: 'ref-port',
          type: 'circle',
          filter: classIs('port'),
          paint: {
            'circle-radius': ['case', ['has', 'major'], 5.5, 3.5],
            'circle-color': '#5fb0ff',
            'circle-stroke-color': '#05080b',
            'circle-stroke-width': 1.5,
          },
        },
        {
          id: 'ref-port-label',
          type: 'symbol',
          minzoom: 6,
          filter: ['all', classIs('port'), ['any', ['>=', ['zoom'], 7.5], ['has', 'major']]],
          layout: {
            'text-field': ['get', 'name'],
            'text-font': ['Noto Sans Regular'],
            'text-size': 10.5,
            'text-offset': [0, 1],
            'text-anchor': 'top',
            'text-optional': true,
          },
          paint: { ...LABEL_PAINT, 'text-color': '#5fb0ff' },
        },
      ],
      (p) => ({
        kicker: p.major ? 'Major port' : 'Small port',
        title: text(p.name) ?? 'Port',
        badges: [],
        rows: [],
      }),
    ),
  ),
  // A short hand-kept list, not map data.
  attribution: [],
}

export const defenceLayer = referenceLayer(
  {
    id: 'defence',
    label: 'Defence sites',
    hint: 'Areas mapped as military land in OpenStreetMap: bases, ranges and training grounds',
    swatch: '#ff8a3d',
    defaultOn: false,
  },
  staticLayer(
    'infrastructure',
    [
      {
        id: 'ref-defence',
        type: 'circle',
        filter: classIs('defence'),
        paint: {
          'circle-radius': ['case', ['has', 'name'], 4.5, 3],
          'circle-color': 'rgba(255, 138, 61, 0.18)',
          'circle-stroke-color': '#ff8a3d',
          'circle-stroke-width': 1.3,
        },
      },
      {
        id: 'ref-defence-label',
        type: 'symbol',
        minzoom: 8,
        filter: ['all', classIs('defence'), ['has', 'name']],
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['Noto Sans Regular'],
          'text-size': 10.5,
          'text-offset': [0, 1],
          'text-anchor': 'top',
          'text-optional': true,
        },
        paint: { ...LABEL_PAINT, 'text-color': '#ff8a3d' },
      },
    ],
    (p) => ({
      kicker: 'Defence site',
      title: text(p.name) ?? 'Military area',
      subtitle: text(p.kind)?.replaceAll('_', ' '),
      badges: [],
      rows: [],
    }),
  ),
)

export const borderCrossingsLayer = referenceLayer(
  {
    id: 'border-crossings',
    label: 'Border crossings',
    hint: 'Border control points. Live queue lengths are published at lvborder.lv',
    swatch: '#e6f6ff',
    defaultOn: false,
  },
  staticLayer(
    'infrastructure',
    [
      {
        id: 'ref-crossing',
        type: 'circle',
        filter: classIs('border-crossing'),
        paint: {
          'circle-radius': 4,
          'circle-color': '#e6f6ff',
          'circle-stroke-color': '#05080b',
          'circle-stroke-width': 1.5,
        },
      },
      {
        id: 'ref-crossing-label',
        type: 'symbol',
        minzoom: 7,
        filter: ['all', classIs('border-crossing'), ['has', 'name']],
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['Noto Sans Regular'],
          'text-size': 10.5,
          'text-offset': [0, 1],
          'text-anchor': 'top',
          'text-optional': true,
        },
        paint: { ...LABEL_PAINT, 'text-color': '#e6f6ff' },
      },
    ],
    (p) => ({ kicker: 'Border crossing', title: text(p.name) ?? 'Border control point', badges: [], rows: [] }),
  ),
)

const UNDERSEA_KIND: Record<string, string> = {
  telecom: 'Telecom cable',
  power: 'Power cable',
  pipeline: 'Pipeline',
}

export const underseaLayer = referenceLayer(
  {
    id: 'undersea',
    label: 'Undersea cables',
    hint: 'Named telecom cables, power links and pipelines on the Baltic seabed, as mapped in OpenStreetMap',
    swatch: '#c08cff',
    defaultOn: true,
  },
  staticLayer(
    'infrastructure',
    [
      {
        id: 'ref-undersea',
        type: 'line',
        filter: classIs('undersea'),
        paint: {
          'line-color': ['match', ['get', 'kind'], 'power', '#ffcc66', 'pipeline', '#ff7a6e', '#c08cff'],
          'line-opacity': 0.85,
          'line-width': 1.4,
          'line-dasharray': [4, 2],
        },
      },
    ],
    (p) => ({
      kicker: UNDERSEA_KIND[text(p.kind) ?? ''] ?? 'Undersea line',
      title: text(p.name) ?? UNDERSEA_KIND[text(p.kind) ?? ''] ?? 'Undersea line',
      subtitle: text(p.operator),
      badges: [],
      rows: [
        ...(text(p.substance) ? [{ label: 'Carries', value: text(p.substance)! }] : []),
        ...(text(p.rating) ? [{ label: 'Rating', value: text(p.rating)! }] : []),
      ],
    }),
  ),
)

export const REFERENCE_LAYERS: readonly LayerDef[] = [
  municipalitiesLayer,
  underseaLayer,
  powerLayer,
  defenceLayer,
  borderCrossingsLayer,
  portsLayer,
  aerodromesLayer,
]
