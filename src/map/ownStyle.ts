import type { ExpressionSpecification, LayerSpecification } from 'maplibre-gl'
import { lang } from '../i18n'
import { BALTIC_OUTLINE } from './balticOutline'

/**
 * The Baltic states drawn from our own vector tiles (tiles/baltic.pmtiles, schema in
 * scripts/tiles/baltic.yml), in the base map's palette: land, water, buildings, streets and their
 * names. Close in, a road is drawn as wide as its lanes, with a line between each lane and down the
 * middle of a two-way street, so a vehicle drawn in its lane is plainly on its own side.
 * OpenFreeMap still draws the sea, the coast and every country round about.
 */
export const OWN_SOURCE = 'baltic'
export const OWN_TILES_PATH = '/tiles/baltic.pmtiles'

/** Inside the Baltic states: where OpenFreeMap's streets and their names give way to ours. */
export const IN_BALTIC: ExpressionSpecification = ['within', BALTIC_OUTLINE as unknown as GeoJSON.MultiPolygon] as unknown as ExpressionSpecification
export const OUTSIDE_BALTIC: ExpressionSpecification = ['!', IN_BALTIC]

/** The base map's colours this needs (map/style.ts Palette). */
export interface OwnPalette {
  wood: string
  park: string
  residential: string
  water: string
  waterLine: string
  building: string
  buildingLine: string
  roadMinor: string
  roadMid: string
  roadMajor: string
  motorway: string
  path: string
  pathCasing: string
  rail: string
  label: string
  labelDim: string
  labelPoi: string
  halo: string
  tram: string
}

/**
 * Places by what they are, each kind a coloured disc with a white pictogram, as a city map marks
 * them: food, shops, money, health, lodging, fuel, schools, culture, stations, parks, the rest.
 * The name is written in its kind's colour, the rest in the map's.
 */
const POI_KINDS = {
  food: { color: '#f27a1a', glyph: 'M6 2h1.4v6h1.2V2H10v6h1.2V2h1.4v7.2a2.6 2.6 0 0 1-2 2.5V22H8.6V11.7a2.6 2.6 0 0 1-2.6-2.5zM15.5 2c2 0 3.5 2.5 3.5 7v4h-2v9h-1.5z' },
  shop: { color: '#1a9bd7', glyph: 'M5.5 8h13l1 13h-15zM8.6 8V6.6a3.4 3.4 0 0 1 6.8 0V8h-1.7V6.6a1.7 1.7 0 0 0-3.4 0V8z' },
  money: { color: '#5b62e6', glyph: 'M2.5 6h19v12h-19zm0 3v2.2h19V9zm2.5 5v1.6h5.5V14z' },
  health: { color: '#5fb336', glyph: 'M9.5 4h5v5.5H20v5h-5.5V20h-5v-5.5H4v-5h5.5z' },
  lodging: { color: '#5b62e6', glyph: 'M3 5h2v8h14a2 2 0 0 1 2 2v4.5h-2V17H5v2.5H3zM6.5 10a2 2 0 1 0 4 0 2 2 0 1 0-4 0zM12 8.5h5a2 2 0 0 1 2 2V12h-7z' },
  fuel: { color: '#56616e', glyph: 'M4.5 3.5H14v17H4.5zM6.5 5.5V10H12V5.5zM15 9.5h1.5A1.5 1.5 0 0 1 18 11v5.5a.75.75 0 0 0 1.5 0V8.6l-2.6-2.6 1-1L21 8.1v8.4a2.25 2.25 0 0 1-4.5 0V11H15z' },
  education: { color: '#a8782f', glyph: 'M12 4l11 5-11 5L1 9zM5.5 12.3v4.2c0 1.8 2.9 3.2 6.5 3.2s6.5-1.4 6.5-3.2v-4.2L12 15.2z' },
  culture: { color: '#1fa36a', glyph: 'M12 3l9 5v1.5H3V8zM5 11h2.5v6H5zm5.75 0h2.5v6h-2.5zM16.5 11H19v6h-2.5zM3 18.5h18V21H3z' },
  transport: { color: '#3a6fd4', glyph: 'M7.5 3h9A2.5 2.5 0 0 1 19 5.5V15a3 3 0 0 1-2.4 2.9l2 3.1h-2.4l-1.9-3h-4.6l-1.9 3H5.4l2-3.1A3 3 0 0 1 5 15V5.5A2.5 2.5 0 0 1 7.5 3zM7 6v5h10V6z' },
  park: { color: '#3c9a48', glyph: 'M12 2a5 5 0 0 1 4.7 6.8A4.6 4.6 0 0 1 14 17h-1v4h-2v-4h-1a4.6 4.6 0 0 1-2.7-8.2A5 5 0 0 1 12 2z' },
  other: { color: '#8a939c', glyph: 'M8.5 12a3.5 3.5 0 1 0 7 0 3.5 3.5 0 1 0-7 0z' },
} as const
type PoiKind = keyof typeof POI_KINDS

const SUB: ExpressionSpecification = ['get', 'subclass']
/** A place's kind from its OSM class and subclass (scripts/tiles/baltic.yml, layer poi). */
const POI_KIND: ExpressionSpecification = [
  'case',
  ['==', ['get', 'class'], 'shop'],
  'shop',
  ['==', ['get', 'class'], 'railway'],
  'transport',
  ['==', ['get', 'class'], 'leisure'],
  'park',
  [
    'match',
    SUB,
    ['restaurant', 'cafe', 'fast_food', 'bar', 'pub', 'biergarten', 'ice_cream', 'food_court'],
    'food',
    ['bank', 'atm', 'bureau_de_change'],
    'money',
    ['pharmacy', 'hospital', 'clinic', 'doctors', 'dentist', 'veterinary'],
    'health',
    ['hotel', 'hostel', 'guest_house', 'motel', 'apartment', 'camp_site', 'chalet'],
    'lodging',
    ['fuel', 'charging_station'],
    'fuel',
    ['school', 'kindergarten', 'university', 'college', 'library'],
    'education',
    ['museum', 'theatre', 'cinema', 'arts_centre', 'attraction', 'gallery', 'viewpoint', 'zoo', 'theme_park'],
    'culture',
    ['bus_station', 'ferry_terminal'],
    'transport',
    'other',
  ],
]

/** A place's name in its kind's colour; the rest in the map's. */
export function poiTextColor(C: Pick<OwnPalette, 'labelPoi'>): ExpressionSpecification {
  const kinds = (Object.keys(POI_KINDS) as PoiKind[]).filter((k) => k !== 'other')
  return ['match', POI_KIND, ...kinds.flatMap((k) => [k, POI_KINDS[k].color]), C.labelPoi] as unknown as ExpressionSpecification
}

const RATIO = 2
/** A disc of `side` CSS pixels with a white rim and the 24-unit pictogram in white. */
function poiBadge(kind: PoiKind, side: number): ImageData {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = side * RATIO
  const ctx = canvas.getContext('2d')!
  ctx.scale(RATIO, RATIO)
  const c = side / 2
  ctx.shadowColor = 'rgba(0,0,0,0.3)'
  ctx.shadowBlur = 1.5
  ctx.shadowOffsetY = 0.5
  ctx.fillStyle = '#ffffff'
  ctx.beginPath()
  ctx.arc(c, c, c - 1, 0, Math.PI * 2)
  ctx.fill()
  ctx.shadowColor = 'transparent'
  ctx.fillStyle = POI_KINDS[kind].color
  ctx.beginPath()
  ctx.arc(c, c, c - 2.2, 0, Math.PI * 2)
  ctx.fill()
  const scale = (side * 0.56) / 24
  ctx.translate(c - 12 * scale, c - 12 * scale)
  ctx.scale(scale, scale)
  ctx.fillStyle = '#ffffff'
  ctx.fill(new Path2D(POI_KINDS[kind].glyph), 'evenodd')
  return ctx.getImageData(0, 0, side * RATIO, side * RATIO)
}

/** A road number's red plate, stretched round its text (icon-text-fit). */
function shield(): { data: ImageData; options: { pixelRatio: number; stretchX: [number, number][]; stretchY: [number, number][]; content: [number, number, number, number] } } {
  const w = 20
  const h = 16
  const canvas = document.createElement('canvas')
  canvas.width = w * RATIO
  canvas.height = h * RATIO
  const ctx = canvas.getContext('2d')!
  ctx.scale(RATIO, RATIO)
  ctx.fillStyle = '#ffffff'
  ctx.beginPath()
  ctx.roundRect(0.5, 0.5, w - 1, h - 1, 3.5)
  ctx.fill()
  ctx.fillStyle = '#d6372b'
  ctx.beginPath()
  ctx.roundRect(1.6, 1.6, w - 3.2, h - 3.2, 2.6)
  ctx.fill()
  return {
    data: ctx.getImageData(0, 0, w * RATIO, h * RATIO),
    options: { pixelRatio: RATIO, stretchX: [[5 * RATIO, 15 * RATIO]], stretchY: [[5 * RATIO, 11 * RATIO]], content: [3 * RATIO, 2 * RATIO, 17 * RATIO, 14 * RATIO] },
  }
}

/** The pictures our labels use: the places' discs and the road numbers' plate. */
export function addOwnImages(map: { hasImage(id: string): boolean; addImage(id: string, image: ImageData, options?: object): void }): void {
  for (const kind of Object.keys(POI_KINDS) as PoiKind[]) {
    if (!map.hasImage(`poi-${kind}`)) map.addImage(`poi-${kind}`, poiBadge(kind, kind === 'other' ? 12 : 18), { pixelRatio: RATIO })
  }
  if (!map.hasImage('road-shield')) {
    const { data, options } = shield()
    map.addImage('road-shield', data, options)
  }
}

const LANE_M = 3.2
/** CSS pixels per metre at zoom z, at the Baltic's middle latitude (57° N). */
const PX = (z: number) => (512 * 2 ** z) / (40_075_016.686 * Math.cos((57 * Math.PI) / 180))
/** From this zoom in a road is drawn as wide as its lanes. */
const LANES_ZOOM = 16

const cls = (...classes: string[]): ExpressionSpecification => ['match', ['get', 'class'], classes, true, false]
const isOneWay: ExpressionSpecification = ['any', ['==', ['get', 'oneway'], 'yes'], ['==', ['get', 'oneway'], '1'], ['==', ['get', 'oneway'], '-1'], cls('motorway', 'motorway_link')]
const notTunnel: ExpressionSpecification = ['!', ['has', 'tunnel']]

// Lanes each way as Valhalla counts them, for how wide a road is drawn close in: lanes:forward and
// :backward where both are tagged; else a one-way street's lanes, half a two-way street's each way
// (rounded down, at least one); one if untagged.
const TAGGED_BOTH: ExpressionSpecification = ['all', ['has', 'lanes_fw'], ['has', 'lanes_bw']]
const HALF: ExpressionSpecification = ['max', 1, ['floor', ['/', ['coalesce', ['get', 'lanes'], 1], 2]]]
const FORWARD: ExpressionSpecification = ['case', TAGGED_BOTH, ['get', 'lanes_fw'], isOneWay, ['coalesce', ['get', 'lanes'], 1], HALF]
const BACKWARD: ExpressionSpecification = ['case', TAGGED_BOTH, ['get', 'lanes_bw'], isOneWay, 0, HALF]
/** Lanes in all. */
const LANES: ExpressionSpecification = ['+', FORWARD, BACKWARD]

/**
 * A road's width: the class's from afar, its lanes' in metres close in, at every zoom the wider of
 * the two, so it grows evenly as the map zooms rather than jumping where one takes over.
 */
function roadWidth(stops: readonly (readonly [number, number])[]): ExpressionSpecification {
  // The class's width at zoom z, between its stops as the map interpolates them; the last one past them.
  const classAt = (z: number): number => {
    const next = stops.findIndex(([at]) => at >= z)
    if (next === -1) return stops.at(-1)![1]
    if (next === 0) return stops[0][1]
    const [[z0, w0], [z1, w1]] = [stops[next - 1], stops[next]]
    return w0 + ((w1 - w0) * (2 ** (z - z0) - 1)) / (2 ** (z1 - z0) - 1)
  }
  const zooms = [...new Set([...stops.map(([z]) => z), 12, 13, 14, 15, LANES_ZOOM, 22])].filter((z) => z >= stops[0][0]).sort((a, b) => a - b)
  const metric = (z: number): ExpressionSpecification => ['*', ['+', ['*', LANES, LANE_M], 0.8], PX(z)]
  return ['interpolate', ['exponential', 2], ['zoom'], ...zooms.flatMap((z) => [z, z < 12 ? classAt(z) : ['max', classAt(z), metric(z)]])] as ExpressionSpecification
}

const MAIN = cls('motorway', 'trunk', 'primary', 'secondary')

const NAME: ExpressionSpecification = ['coalesce', ['get', `name_${lang}`], ['get', 'name']]

export function ownLayers(C: OwnPalette): { ground: LayerSpecification[]; roads: LayerSpecification[]; labels: LayerSpecification[] } {
  const src = { source: OWN_SOURCE } as const
  const road = (id: string, classes: string[], minzoom: number, color: string, stops: readonly (readonly [number, number])[]): LayerSpecification => ({
    id,
    type: 'line',
    ...src,
    'source-layer': 'road',
    minzoom,
    filter: ['all', cls(...classes), notTunnel],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': color, 'line-width': roadWidth(stops) },
  })

  const ground: LayerSpecification[] = [
    { id: 'own-wood', type: 'fill', ...src, 'source-layer': 'landcover', filter: cls('forest', 'wood'), paint: { 'fill-color': C.wood } },
    { id: 'own-residential', type: 'fill', ...src, 'source-layer': 'landcover', filter: cls('residential'), paint: { 'fill-color': C.residential } },
    {
      id: 'own-park',
      type: 'fill',
      ...src,
      'source-layer': 'landcover',
      filter: cls('park', 'garden', 'grass', 'meadow', 'cemetery', 'village_green', 'recreation_ground', 'pitch', 'playground', 'golf_course'),
      paint: { 'fill-color': C.park, 'fill-opacity': 0.7 },
    },
    { id: 'own-water', type: 'fill', ...src, 'source-layer': 'water', paint: { 'fill-color': C.water } },
    {
      id: 'own-waterway',
      type: 'line',
      ...src,
      'source-layer': 'waterway',
      paint: { 'line-color': C.waterLine, 'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 8, ['match', ['get', 'class'], 'river', 0.8, 0.3], 16, ['match', ['get', 'class'], 'river', 6, 'canal', 4, 1.5]] },
    },
    { id: 'own-building', type: 'fill', ...src, 'source-layer': 'building', minzoom: 13, maxzoom: 14, paint: { 'fill-color': C.building, 'fill-outline-color': C.buildingLine } },
  ]

  const roads: LayerSpecification[] = [
    road('own-road-path', ['service', 'track'], 14, C.roadMinor, [[14, 0.4], [15, 1.5]]),
    // Footways, paths, cycle tracks and steps as little roads of their own: light grey, edged a shade
    // darker so they read on bare ground and on grass alike.
    {
      id: 'own-road-footpath-casing',
      type: 'line',
      ...src,
      'source-layer': 'road',
      minzoom: 15,
      filter: cls('footway', 'path', 'cycleway', 'steps'),
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': C.pathCasing, 'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 15, 1.4, 18, 6, 20, 12] },
    },
    {
      id: 'own-road-footpath',
      type: 'line',
      ...src,
      'source-layer': 'road',
      minzoom: 15,
      filter: cls('footway', 'path', 'cycleway', 'steps'),
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': C.path, 'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 15, 0.8, 18, 4.5, 20, 10] },
    },
    road('own-road-minor', ['residential', 'unclassified', 'living_street', 'pedestrian', 'busway'], 11.5, C.roadMinor, [[11.5, 0.3], [14, 1.4], [15, 3]]),
    road('own-road-mid', ['secondary', 'secondary_link', 'tertiary', 'tertiary_link'], 8, C.roadMid, [[8, 0.4], [12, 1.5], [14, 3], [15, 5]]),
    road('own-road-major', ['primary', 'primary_link', 'trunk', 'trunk_link'], 5.5, C.roadMajor, [[5.5, 0.4], [8, 1], [12, 2.3], [14, 4.5], [15, 7]]),
    road('own-road-motorway', ['motorway', 'motorway_link'], 4.5, C.motorway, [[4.5, 0.5], [8, 1.3], [12, 2.9], [14, 5.5], [15, 8]]),
    {
      id: 'own-rail',
      type: 'line',
      ...src,
      'source-layer': 'rail',
      filter: cls('rail', 'narrow_gauge'),
      paint: { 'line-color': C.rail, 'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 7, 0.5, 12, 1.1, 16, 2.6], 'line-dasharray': [4, 2] },
    },
    {
      id: 'own-rail-transit',
      type: 'line',
      ...src,
      'source-layer': 'rail',
      minzoom: 13,
      filter: cls('light_rail', 'subway'),
      paint: { 'line-color': C.rail, 'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 13, 0.5, 17, 2] },
    },
    {
      id: 'own-rail-tram',
      type: 'line',
      ...src,
      'source-layer': 'rail',
      minzoom: 13,
      filter: cls('tram'),
      paint: { 'line-color': C.tram, 'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 13, 0.8, 17, 2.2], 'line-dasharray': [3, 2] },
    },
  ]

  // Not drawn: the map keeps only the parts of a tile some layer of its style uses, and the traffic
  // lights and stops are drawn standing up by map/furniture.ts, which reads them from the tiles.
  const kept = (sourceLayer: string): LayerSpecification => ({
    id: `own-keep-${sourceLayer}`,
    type: 'circle',
    ...src,
    'source-layer': sourceLayer,
    minzoom: 15.5,
    paint: { 'circle-radius': 1, 'circle-opacity': 0 },
  })
  roads.push(kept('traffic_signal'), kept('stop'), kept('crossing'), kept('tree'))

  const labels: LayerSpecification[] = [
    {
      id: 'own-label-housenumber',
      type: 'symbol',
      ...src,
      'source-layer': 'housenumber',
      minzoom: 16,
      layout: { 'text-field': ['get', 'number'], 'text-font': ['Noto Sans Regular'], 'text-size': ['interpolate', ['linear'], ['zoom'], 16, 8.5, 18, 10.5], 'text-padding': 4 },
      paint: { 'text-color': C.labelDim, 'text-halo-color': C.halo, 'text-halo-width': 1.4 },
    },
    {
      id: 'own-label-road',
      type: 'symbol',
      ...src,
      'source-layer': 'road',
      minzoom: 13,
      filter: ['has', 'name'],
      layout: {
        // Every street's name from 13 (the tiles have the smaller streets from 14), the main ones larger.
        'text-field': ['get', 'name'],
        'text-font': ['Noto Sans Regular'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 13, ['case', MAIN, 10.5, 9.5], 17, ['case', MAIN, 13, 12]],
        'symbol-placement': 'line',
        'symbol-sort-key': ['match', ['get', 'class'], ['motorway', 'trunk', 'primary'], 0, ['secondary', 'tertiary'], 1, 2],
        'text-transform': 'uppercase',
        'text-letter-spacing': 0.12,
      },
      paint: { 'text-color': C.label, 'text-halo-color': C.halo, 'text-halo-width': 1.4 },
    },
    {
      // The road's number on a red plate: A1, P5, E67…
      id: 'own-label-shield',
      type: 'symbol',
      ...src,
      'source-layer': 'road',
      minzoom: 7,
      filter: ['all', ['has', 'ref'], cls('motorway', 'trunk', 'primary', 'secondary')],
      layout: {
        'text-field': ['get', 'ref'],
        'text-font': ['Noto Sans Bold'],
        'text-size': 10,
        'symbol-placement': 'line',
        'symbol-spacing': 420,
        'text-rotation-alignment': 'viewport',
        'icon-rotation-alignment': 'viewport',
        'icon-image': 'road-shield',
        'icon-text-fit': 'both',
        'icon-text-fit-padding': [1, 3, 1, 3],
        'text-padding': 30,
      },
      paint: { 'text-color': '#ffffff' },
    },
    {
      id: 'own-label-poi',
      type: 'symbol',
      ...src,
      'source-layer': 'poi',
      minzoom: 16,
      // The rest (offices, toilets, benches with a name…) only from 17.
      filter: ['any', ['!=', POI_KIND, 'other'], ['>=', ['zoom'], 17]],
      layout: {
        'icon-image': ['concat', 'poi-', POI_KIND],
        'icon-padding': 2,
        // Names from 16.5, to the right of the disc (left when there is no room).
        'text-field': ['step', ['zoom'], '', 16.5, NAME],
        'text-font': ['Noto Sans Regular'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 16.5, 10.5, 19, 12],
        'text-max-width': 8,
        'text-variable-anchor': ['left', 'right'],
        'text-radial-offset': 1,
        'text-justify': 'auto',
        'text-optional': true,
        'symbol-sort-key': ['match', POI_KIND, 'other', 2, ['food', 'shop'], 1, 0],
      },
      paint: {
        'text-color': poiTextColor(C),
        'text-halo-color': C.halo,
        'text-halo-width': 1.4,
      },
    },
  ]
  return { ground, roads, labels }
}
