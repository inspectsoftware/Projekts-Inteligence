import type { ExpressionSpecification, LayerSpecification, Map as MapLibreMap, SkySpecification, StyleSpecification } from 'maplibre-gl'
import { TILE_ORIGINS } from '../../shared/origins'
import { lang } from '../i18n'
import { addOwnImages, poiTextColor, OUTSIDE_BALTIC, OWN_SOURCE, OWN_TILES_PATH, ownLayers } from './ownStyle'

/**
 * Dark tactical basemap over OpenFreeMap's vector tiles (OpenMapTiles schema).
 * Deliberately quiet: the data layers drawn on top are what should catch the eye.
 */

const SOURCE = 'omt'

/** Raster imagery is inserted below this layer, so roads, borders and labels stay on top. */
export const FIRST_OVERLAY_LAYER = 'waterway'

/**
 * An air photo shows every street and runway for itself, so it goes in below this layer instead
 * and covers the drawn ones. Where it has nothing, they still show over the satellite mosaic.
 */
export const FIRST_LAYER_OVER_PHOTOS = 'rail'

/**
 * Drawn shapes that a photo already shows for itself: hidden while a raster base is showing.
 * 'building-3d' is the 3D city (src/map/city/layer.ts), added once the style has loaded.
 */
export const DARK_ONLY_LAYERS = ['aeroway-area', 'building', 'building-3d', 'own-building'] as const

const DARK = {
  land: '#0e151c',
  water: '#050b13',
  waterLine: '#0c1c29',
  wood: '#0e1917',
  park: '#0f1b19',
  residential: '#121a22',
  aeroway: '#1a2530',
  runway: '#3a5062',
  building: '#141c25',
  buildingLine: '#1c2733',
  roadMinor: '#18222c',
  roadMid: '#1f2c38',
  roadMajor: '#283847',
  motorway: '#33495b',
  // Footways and paths: little roads, a shade off the ground (map/ownStyle.ts).
  path: '#1c2631',
  pathCasing: '#131b23',
  rail: '#2e3f4c',
  boundary: '#3a5468',
  label: '#93a7b6',
  labelStrong: '#cfdbe4',
  labelDim: '#5d7281',
  labelWater: '#2f4c62',
  labelPoi: '#7da2b3',
  halo: '#05080b',
  towerLow: '#131b24',
  towerMid: '#1b2835',
  towerHigh: '#2a3d4f',
  // Tram tracks, red dashes as a city map draws them (map/ownStyle.ts).
  tram: '#b8564f',
} as const

type Palette = Record<keyof typeof DARK, string>

/**
 * The same map by day, as a city map draws it: near-white land, bright blue water, green parks and
 * woods, beige houses, grey streets (the bigger, the darker), dark lettering.
 */
const LIGHT: Palette = {
  land: '#f6f5f2',
  water: '#8ecbf6',
  waterLine: '#7cbdec',
  wood: '#d3eabd',
  park: '#cbe8ad',
  residential: '#efede8',
  aeroway: '#e6e6ea',
  runway: '#c3c7cf',
  building: '#e8e2d8',
  buildingLine: '#d9d1c4',
  roadMinor: '#dadde2',
  roadMid: '#c9cdd4',
  roadMajor: '#b9bec7',
  motorway: '#a7aeb9',
  path: '#e6e8ec',
  pathCasing: '#cfd3d9',
  rail: '#9aa0a8',
  boundary: '#9b7fb5',
  label: '#3d434a',
  labelStrong: '#15181c',
  labelDim: '#6b737c',
  labelWater: '#2e6ea4',
  labelPoi: '#4a5560',
  halo: '#ffffff',
  towerLow: '#ebe5db',
  towerMid: '#e0d8cb',
  towerHigh: '#cfc6b7',
  tram: '#e2574c',
}

export type MapTheme = 'dark' | 'light'

const isPolygon: ExpressionSpecification = ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false]
const isLine: ExpressionSpecification = ['match', ['geometry-type'], ['LineString', 'MultiLineString'], true, false]
const isPoint: ExpressionSpecification = ['match', ['geometry-type'], ['Point', 'MultiPoint'], true, false]

/** The name in the reader's language where the tiles carry one, else the Latin-script name so neighbouring Cyrillic labels stay readable. */
const NAME: ExpressionSpecification = ['coalesce', ['get', `name:${lang}`], ['get', 'name:latin'], ['get', 'name']]

/** Every layer of the base map, and the label colours that change over imagery, drawn in one palette. */
function styleFor(C: Palette) {
  /** Street names start dim, as one more texture, and come forward once the streets fill the screen. */
  // Street names dark enough to read from zoom 13, as a city map has them.
  const STREET_NAME_COLOR = C.label

  function widthByZoom(stops: readonly (readonly [number, number])[]): ExpressionSpecification {
    return ['interpolate', ['exponential', 1.5], ['zoom'], ...stops.flat()] as ExpressionSpecification
  }

  function road(
    id: string,
    classes: string[],
    minzoom: number,
    color: string,
    width: readonly (readonly [number, number])[],
  ): LayerSpecification {
    return {
      id,
      type: 'line',
      source: SOURCE,
      'source-layer': 'transportation',
      minzoom,
      filter: ['all', isLine, ['match', ['get', 'class'], classes, true, false]],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': color, 'line-width': widthByZoom(width) },
    }
  }

  function placeLabel(
    id: string,
    classes: string[],
    zoom: { min?: number; max?: number },
    font: string,
    size: readonly (readonly [number, number])[],
    color: string,
    extra: Record<string, unknown> = {},
  ): LayerSpecification {
    return {
      id,
      type: 'symbol',
      source: SOURCE,
      'source-layer': 'place',
      ...(zoom.min !== undefined && { minzoom: zoom.min }),
      ...(zoom.max !== undefined && { maxzoom: zoom.max }),
      filter: ['all', isPoint, ['match', ['get', 'class'], classes, true, false]],
      layout: {
        'text-field': NAME,
        'text-font': [font],
        'text-size': ['interpolate', ['linear'], ['zoom'], ...size.flat()] as ExpressionSpecification,
        'text-max-width': 8,
        'symbol-sort-key': ['coalesce', ['get', 'rank'], 99],
        ...extra,
      },
      paint: {
        'text-color': color,
        'text-halo-color': C.halo,
        'text-halo-width': 1.4,
        'text-halo-blur': 0.5,
      },
    }
  }

  const layers: LayerSpecification[] = [
    { id: 'background', type: 'background', paint: { 'background-color': C.land } },
    {
      id: 'landcover-wood',
      type: 'fill',
      source: SOURCE,
      'source-layer': 'landcover',
      filter: ['all', isPolygon, ['==', ['get', 'class'], 'wood']],
      paint: { 'fill-color': C.wood, 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 5, 0.4, 9, 0.9] },
    },
    {
      id: 'landuse-residential',
      type: 'fill',
      source: SOURCE,
      'source-layer': 'landuse',
      filter: ['all', isPolygon, ['==', ['get', 'class'], 'residential']],
      paint: { 'fill-color': C.residential },
    },
    {
      id: 'park',
      type: 'fill',
      source: SOURCE,
      'source-layer': 'park',
      filter: isPolygon,
      paint: { 'fill-color': C.park, 'fill-opacity': 0.6 },
    },
    {
      id: 'water',
      type: 'fill',
      source: SOURCE,
      'source-layer': 'water',
      filter: ['all', isPolygon, ['!=', ['get', 'brunnel'], 'tunnel']],
      paint: { 'fill-color': C.water },
    },
    {
      id: 'waterway',
      type: 'line',
      source: SOURCE,
      'source-layer': 'waterway',
      minzoom: 8,
      filter: isLine,
      paint: { 'line-color': C.waterLine, 'line-width': widthByZoom([[8, 0.5], [14, 2.2]]) },
    },
    {
      id: 'aeroway-area',
      type: 'fill',
      source: SOURCE,
      'source-layer': 'aeroway',
      minzoom: 10,
      filter: isPolygon,
      paint: { 'fill-color': C.aeroway, 'fill-opacity': 0.7 },
    },
    {
      id: 'aeroway-taxiway',
      type: 'line',
      source: SOURCE,
      'source-layer': 'aeroway',
      minzoom: 12,
      filter: ['all', isLine, ['==', ['get', 'class'], 'taxiway']],
      paint: { 'line-color': C.runway, 'line-opacity': 0.6, 'line-width': widthByZoom([[12, 0.6], [16, 6]]) },
    },
    {
      id: 'aeroway-runway',
      type: 'line',
      source: SOURCE,
      'source-layer': 'aeroway',
      minzoom: 9,
      filter: ['all', isLine, ['==', ['get', 'class'], 'runway']],
      paint: { 'line-color': C.runway, 'line-width': widthByZoom([[9, 1], [12, 4], [16, 30]]) },
    },
    {
      id: 'building',
      type: 'fill',
      source: SOURCE,
      'source-layer': 'building',
      minzoom: 13,
      maxzoom: 14,
      paint: { 'fill-color': C.building, 'fill-outline-color': C.buildingLine },
    },
    road('road-path', ['path', 'track', 'service'], 14, C.roadMinor, [[14, 0.4], [18, 3]]),
    {
      id: 'road-footpath',
      type: 'line',
      source: SOURCE,
      'source-layer': 'transportation',
      minzoom: 15,
      // A pedestrian street is a street in all but traffic and stays solid. This picks out the
      // footways, steps and cycle tracks between houses and through parks.
      filter: ['all', isLine, ['==', ['get', 'class'], 'path'], ['!=', ['get', 'subclass'], 'pedestrian']],
      paint: { 'line-color': C.roadMajor, 'line-width': widthByZoom([[15, 0.5], [18, 1.6]]), 'line-dasharray': [2, 1.5] },
    },
    road('road-minor', ['minor'], 11.5, C.roadMinor, [[11.5, 0.3], [14, 1.4], [18, 11]]),
    road('road-mid', ['secondary', 'tertiary'], 8, C.roadMid, [[8, 0.4], [12, 1.5], [14, 3], [18, 16]]),
    road('road-major', ['primary', 'trunk'], 5.5, C.roadMajor, [[5.5, 0.4], [8, 1], [12, 2.3], [14, 4.5], [18, 22]]),
    road('road-motorway', ['motorway'], 4.5, C.motorway, [[4.5, 0.5], [8, 1.3], [12, 2.9], [14, 5.5], [18, 26]]),
    {
      id: 'rail',
      type: 'line',
      source: SOURCE,
      'source-layer': 'transportation',
      minzoom: 7,
      filter: ['all', isLine, ['==', ['get', 'class'], 'rail'], ['!', ['has', 'service']]],
      paint: {
        'line-color': C.rail,
        'line-width': widthByZoom([[7, 0.5], [12, 1.1], [16, 2.6]]),
        'line-dasharray': [4, 2],
      },
    },
    {
      id: 'rail-transit',
      type: 'line',
      source: SOURCE,
      'source-layer': 'transportation',
      minzoom: 13,
      filter: ['all', isLine, ['==', ['get', 'class'], 'transit']],
      paint: { 'line-color': C.rail, 'line-width': widthByZoom([[13, 0.5], [17, 2]]) },
    },
    {
      id: 'boundary-country',
      type: 'line',
      source: SOURCE,
      'source-layer': 'boundary',
      filter: ['all', ['==', ['get', 'admin_level'], 2], ['!=', ['get', 'maritime'], 1]],
      paint: { 'line-color': C.boundary, 'line-width': widthByZoom([[3, 0.6], [8, 1.2], [12, 2]]) },
    },
    {
      id: 'boundary-maritime',
      type: 'line',
      source: SOURCE,
      'source-layer': 'boundary',
      filter: ['all', ['==', ['get', 'admin_level'], 2], ['==', ['get', 'maritime'], 1]],
      paint: { 'line-color': C.boundary, 'line-opacity': 0.5, 'line-width': 0.8, 'line-dasharray': [4, 3] },
    },
    {
      id: 'label-housenumber',
      type: 'symbol',
      source: SOURCE,
      'source-layer': 'housenumber',
      // 16 and no higher. The tiles end at level 14 and are stretched from there, and in testing a
      // layer that started at 17 never drew a single number. First of the labels, so it yields to all.
      minzoom: 16,
      layout: {
        'text-field': ['get', 'housenumber'],
        'text-font': ['Noto Sans Regular'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 16, 8.5, 18, 10.5],
        'text-padding': 4,
      },
      paint: { 'text-color': C.labelDim, 'text-halo-color': C.halo, 'text-halo-width': 1.4 },
    },
    {
      id: 'label-water',
      type: 'symbol',
      source: SOURCE,
      'source-layer': 'water_name',
      filter: isPoint,
      layout: {
        'text-field': NAME,
        'text-font': ['Noto Sans Italic'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 4, 10, 10, 13],
        'text-letter-spacing': 0.18,
        'text-max-width': 7,
      },
      paint: { 'text-color': C.labelWater, 'text-halo-color': C.halo, 'text-halo-width': 1 },
    },
    {
      id: 'label-road',
      type: 'symbol',
      source: SOURCE,
      'source-layer': 'transportation_name',
      minzoom: 13.5,
      filter: isLine,
      layout: {
        'text-field': NAME,
        'text-font': ['Noto Sans Regular'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 13.5, 10, 17, 12.5],
        'symbol-placement': 'line',
        // In capitals, spaced out, as a city map writes its street names.
        'text-transform': 'uppercase',
        'text-letter-spacing': 0.12,
      },
      paint: { 'text-color': STREET_NAME_COLOR, 'text-halo-color': C.halo, 'text-halo-width': 1.2 },
    },
    {
      id: 'label-poi',
      type: 'symbol',
      source: SOURCE,
      'source-layer': 'poi',
      minzoom: 16,
      // Names only, no icons. `rank` orders the places inside each half-kilometre cell, so a low
      // cut-off keeps the map quiet; each level deeper lets a few more in.
      filter: ['all', ['has', 'name'], ['<=', ['get', 'rank'], ['step', ['zoom'], 5, 17, 12, 18, 30]]],
      layout: {
        'text-field': NAME,
        'text-font': ['Noto Sans Regular'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 16, 9.5, 18, 11],
        'text-max-width': 7,
        'text-padding': 6,
        'symbol-sort-key': ['get', 'rank'],
      },
      paint: { 'text-color': C.labelPoi, 'text-halo-color': C.halo, 'text-halo-width': 1.4 },
    },
    placeLabel(
      'label-place-small',
      ['village', 'hamlet', 'suburb', 'neighbourhood', 'quarter'],
      { min: 10.5 },
      'Noto Sans Regular',
      [[10.5, 10], [15, 12]],
      C.labelDim,
    ),
    placeLabel('label-place-town', ['town'], { min: 7.5 }, 'Noto Sans Regular', [[7.5, 10], [12, 13.5]], C.label),
    placeLabel('label-place-city', ['city'], { min: 4 }, 'Noto Sans Bold', [[4, 10.5], [8, 13], [12, 17]], C.labelStrong),
    placeLabel('label-state', ['state', 'province'], { min: 4.5, max: 8 }, 'Noto Sans Regular', [[4.5, 9.5], [8, 12]], C.labelDim, {
      'text-transform': 'uppercase',
      'text-letter-spacing': 0.14,
    }),
    placeLabel('label-country', ['country'], { max: 7.5 }, 'Noto Sans Bold', [[3, 10], [7, 13]], C.labelDim, {
      'text-transform': 'uppercase',
      'text-letter-spacing': 0.28,
    }),
  ]

  const imageryText = [
    ['label-road', STREET_NAME_COLOR, C.labelStrong],
    ['label-housenumber', C.labelDim, C.labelStrong],
    ['label-poi', C.labelPoi, C.labelStrong],
    ['own-label-road', STREET_NAME_COLOR, C.labelStrong],
    ['own-label-housenumber', C.labelDim, C.labelStrong],
    ['own-label-poi', poiTextColor(C), C.labelStrong],
  ] as const
  return { layers: withOwnTiles(layers, C), imageryText }
}

/** OpenFreeMap's layers that our own tiles draw instead inside the Baltic states (map/ownStyle.ts). */
const GIVEN_WAY = new Set(['waterway', 'road-path', 'road-footpath', 'road-minor', 'road-mid', 'road-major', 'road-motorway', 'rail', 'rail-transit', 'label-housenumber', 'label-road', 'label-poi'])

/**
 * The style with our own tiles in it: OpenFreeMap's streets, rails and their names kept to outside
 * the Baltic states, and ours drawn in the same places of the stack. Shapes cannot be told apart
 * by place (a `within` test sees only points and lines), so their land and water are drawn over.
 */
function withOwnTiles(layers: LayerSpecification[], C: Palette): LayerSpecification[] {
  const own = ownLayers(C)
  const out: LayerSpecification[] = []
  for (const layer of layers) {
    if (GIVEN_WAY.has(layer.id) && 'filter' in layer) {
      out.push({ ...layer, filter: layer.filter ? ['all', layer.filter as ExpressionSpecification, OUTSIDE_BALTIC] : OUTSIDE_BALTIC } as LayerSpecification)
    } else if (GIVEN_WAY.has(layer.id)) {
      out.push({ ...layer, filter: OUTSIDE_BALTIC } as LayerSpecification)
    } else out.push(layer)
    if (layer.id === 'water') out.push(...own.ground)
    if (layer.id === 'road-motorway') out.push(...own.roads)
    if (layer.id === 'label-road') out.push(...own.labels)
  }
  return out
}

/**
 * Brings our own tiles into a map already showing the style without them: the source, our layers each
 * where the full style has it, and OpenFreeMap's streets kept to outside the Baltic states. The map
 * opens at once on OpenFreeMap and switches over as soon as the server has said it has the tiles.
 */
export function addOwnTiles(map: MapLibreMap, theme: MapTheme, url: string): void {
  if (map.getSource(OWN_SOURCE)) return
  addOwnImages(map)
  map.addSource(OWN_SOURCE, { type: 'vector', url: `pmtiles://${url}`, attribution: '© OpenStreetMap contributors' })
  const layers = STYLES[theme].layers
  layers.forEach((layer, i) => {
    if (layer.id.startsWith('own-')) {
      // Before the next layer of the full style that the map has: imagery and the 3D city sit in between.
      const before = layers.slice(i + 1).find((next) => !next.id.startsWith('own-') && map.getLayer(next.id))?.id
      if (!map.getLayer(layer.id)) map.addLayer(layer, before)
    } else if (GIVEN_WAY.has(layer.id) && map.getLayer(layer.id) && 'filter' in layer) {
      map.setFilter(layer.id, layer.filter as ExpressionSpecification)
    }
  })
}

/** Whether the server has our own tiles, and their address for the pmtiles protocol. */
export async function ownTilesUrl(): Promise<string | null> {
  try {
    const res = await fetch(OWN_TILES_PATH, { method: 'HEAD' })
    if (!res.ok) return null
    // Named by when the file was built: the browser keeps the pieces it has read for an hour, and a
    // rebuilt file's pieces must never be mixed with the last one's.
    const url = new URL(OWN_TILES_PATH, window.location.href)
    const built = res.headers.get('last-modified')
    if (built) url.searchParams.set('v', String(Date.parse(built) / 1000))
    return url.href
  } catch {
    return null
  }
}

/** The layers of a style without our own tiles: as they were before them. */
const withoutOwnTiles = (layers: LayerSpecification[]): LayerSpecification[] =>
  layers
    .filter((layer) => !layer.id.startsWith('own-'))
    .map((layer) => {
      if (!GIVEN_WAY.has(layer.id) || !('filter' in layer) || !layer.filter) return layer
      const filter = layer.filter as unknown[]
      // Undone as it was done: ['all', the layer's own, OUTSIDE_BALTIC] back to the layer's own, or none.
      if (filter === OUTSIDE_BALTIC) {
        // A layer with no filter of its own: the key goes too, as MapLibre refuses an undefined filter.
        const { filter: _given, ...rest } = layer as LayerSpecification & { filter?: unknown }
        return rest as LayerSpecification
      }
      return { ...layer, filter: filter[1] } as LayerSpecification
    })

const STYLES: Record<MapTheme, ReturnType<typeof styleFor>> = { dark: styleFor(DARK), light: styleFor(LIGHT) }

/**
 * The colour of the street-level labels, as [layer, on the dark base, over imagery]: a dim label
 * is lost on a sunlit roof.
 */
export const IMAGERY_TEXT_COLOR = STYLES.dark.imageryText
/** The same per theme: the plain colour is the theme's own, so leaving the photos does not darken a light map's names. */
export const IMAGERY_TEXT_COLORS: Record<MapTheme, typeof IMAGERY_TEXT_COLOR> = { dark: STYLES.dark.imageryText, light: STYLES.light.imageryText }

/**
 * Place names that can be clicked, each with the scale its place is looked up at: 3 finds the
 * country around a point, 5 the state, 10 the city, 12 the town, 14 the village or quarter.
 */
export const PLACE_LABEL_LEVEL: Record<string, number> = {
  'label-country': 3,
  'label-state': 5,
  'label-place-city': 10,
  'label-place-town': 12,
  'label-place-small': 14,
}

/** Paint values that differ between the two palettes, as [layer, property]: all a change of theme has to touch. */
const THEMED: [string, string][] = STYLES.dark.layers.flatMap((layer, index) => {
  const other = (STYLES.light.layers[index].paint ?? {}) as Record<string, unknown>
  return Object.entries(layer.paint ?? {})
    .filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(other[key]))
    .map(([key]): [string, string] => [layer.id, key])
})

/** The shade that sets the Baltic states apart, their border, the relief shading and the landmarks' names: layers added after the style, in each theme. */
export const MAP_EXTRAS: Record<MapTheme, [string, string, string][]> = {
  dark: [
    ['lv-mask', 'fill-color', '#04070a'],
    ['lv-border-line', 'line-color', '#dff4ff'],
    ['relief-shade', 'hillshade-shadow-color', '#000000'],
    ['relief-shade', 'hillshade-highlight-color', '#8fa9bb'],
    ['landmarks-icon', 'text-color', '#e8edf0'],
    ['landmarks-icon', 'text-halo-color', '#05080b'],
  ],
  light: [
    ['lv-mask', 'fill-color', '#dfe5ea'],
    ['lv-border-line', 'line-color', '#0b2a3a'],
    ['relief-shade', 'hillshade-shadow-color', '#4c5b67'],
    ['relief-shade', 'hillshade-highlight-color', '#ffffff'],
    ['landmarks-icon', 'text-color', '#2b3540'],
    ['landmarks-icon', 'text-halo-color', '#ffffff'],
  ],
}

/**
 * The sky over the horizon, seen once the map is tilted far enough: night over the dark map, day
 * over the light one. Its haze is the colour of the land, so the ground runs into it.
 */
const SKY: Record<MapTheme, SkySpecification> = {
  dark: {
    'sky-color': '#04070b',
    'horizon-color': '#132231',
    'fog-color': DARK.land,
    'sky-horizon-blend': 0.6,
    'horizon-fog-blend': 0.7,
    'fog-ground-blend': 0.6,
    'atmosphere-blend': 0,
  },
  light: {
    'sky-color': '#a8c8e4',
    'horizon-color': '#e6eef3',
    'fog-color': LIGHT.land,
    'sky-horizon-blend': 0.6,
    'horizon-fog-blend': 0.7,
    'fog-ground-blend': 0.6,
    'atmosphere-blend': 0,
  },
}

/**
 * Repaints the base map in a theme without replacing the style, so imagery, relief and every layer
 * added since stay where they are. `overImagery` leaves the street-level label colours alone:
 * the base mode has set those for reading over a photo.
 */
export function applyMapTheme(map: MapLibreMap, theme: MapTheme, overImagery: boolean): void {
  // The properties are named by the style itself, so they are the right ones for their layers.
  const paint = map.setPaintProperty.bind(map) as (id: string, key: string, value: unknown) => void
  const kept = new Set(overImagery ? IMAGERY_TEXT_COLOR.map(([id]) => `${id}|text-color`) : [])
  const byId = new Map(STYLES[theme].layers.map((layer) => [layer.id, (layer.paint ?? {}) as Record<string, unknown>]))
  for (const [id, key] of THEMED) {
    if (!kept.has(`${id}|${key}`) && map.getLayer(id)) paint(id, key, byId.get(id)![key])
  }
  for (const [id, key, value] of MAP_EXTRAS[theme]) if (map.getLayer(id)) paint(id, key, value)
  map.setSky(SKY[theme])
}

/**
 * The base map. `ownTiles`: the address of our own tiles (map/ownStyle.ts) when the server has them,
 * read through the pmtiles protocol; without them, OpenFreeMap draws the Baltic states too, as before.
 */
export function buildStyle(theme: MapTheme = 'dark', ownTiles: string | null = null): StyleSpecification {
  const ofm = TILE_ORIGINS.openFreeMap
  return {
    version: 8,
    name: 'Projekts Inteliģence',
    sources: {
      // The TileJSON resolves to a dated tile path, so always reference it rather than the tiles.
      [SOURCE]: { type: 'vector', url: `${ofm}/planet` },
      ...(ownTiles && { [OWN_SOURCE]: { type: 'vector' as const, url: `pmtiles://${ownTiles}`, attribution: '© OpenStreetMap contributors' } }),
    },
    glyphs: `${ofm}/fonts/{fontstack}/{range}.pbf`,
    sky: SKY[theme],
    layers: ownTiles ? STYLES[theme].layers : withoutOwnTiles(STYLES[theme].layers),
  }
}
