import type { ExpressionSpecification, LayerSpecification, StyleSpecification } from 'maplibre-gl'
import { TILE_ORIGINS } from '../../shared/origins'

/**
 * Dark tactical basemap over OpenFreeMap's vector tiles (OpenMapTiles schema).
 * Deliberately quiet: the data layers drawn on top are what should catch the eye.
 */

const SOURCE = 'omt'

/** Raster imagery is inserted below this layer, so roads, borders and labels stay on top. */
export const FIRST_OVERLAY_LAYER = 'waterway'

/** Flat fills that are hidden while a raster base is showing. */
export const DARK_ONLY_LAYERS = ['aeroway-area', 'building', 'building-3d'] as const

const C = {
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
  rail: '#2e3f4c',
  boundary: '#3a5468',
  label: '#93a7b6',
  labelStrong: '#cfdbe4',
  labelDim: '#5d7281',
  labelWater: '#2f4c62',
  halo: '#05080b',
} as const

const isPolygon: ExpressionSpecification = ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false]
const isLine: ExpressionSpecification = ['match', ['geometry-type'], ['LineString', 'MultiLineString'], true, false]
const isPoint: ExpressionSpecification = ['match', ['geometry-type'], ['Point', 'MultiPoint'], true, false]

/** Prefers the Latin-script name so neighbouring Cyrillic labels stay readable. */
const NAME: ExpressionSpecification = ['coalesce', ['get', 'name:latin'], ['get', 'name']]

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
    id: 'building-3d',
    type: 'fill-extrusion',
    source: SOURCE,
    'source-layer': 'building',
    minzoom: 14,
    filter: ['!=', ['get', 'hide_3d'], true],
    paint: {
      'fill-extrusion-color': [
        'interpolate',
        ['linear'],
        ['coalesce', ['get', 'render_height'], 6],
        0,
        '#131b24',
        30,
        '#1b2835',
        120,
        '#2a3d4f',
      ],
      'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 14, 0, 15, ['coalesce', ['get', 'render_height'], 6]],
      'fill-extrusion-base': ['interpolate', ['linear'], ['zoom'], 14, 0, 15, ['coalesce', ['get', 'render_min_height'], 0]],
      'fill-extrusion-opacity': 0.92,
    },
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
      'text-size': 10,
      'symbol-placement': 'line',
      'text-letter-spacing': 0.05,
    },
    paint: { 'text-color': C.labelDim, 'text-halo-color': C.halo, 'text-halo-width': 1.2 },
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
  placeLabel('label-country', ['country'], { max: 7.5 }, 'Noto Sans Bold', [[3, 10], [7, 13]], C.labelDim, {
    'text-transform': 'uppercase',
    'text-letter-spacing': 0.28,
  }),
]

export function buildStyle(): StyleSpecification {
  const ofm = TILE_ORIGINS.openFreeMap
  return {
    version: 8,
    name: 'White Hornet dark',
    // The TileJSON resolves to a dated tile path, so always reference it rather than the tiles.
    sources: { [SOURCE]: { type: 'vector', url: `${ofm}/planet` } },
    glyphs: `${ofm}/fonts/{fontstack}/{range}.pbf`,
    layers,
  }
}
