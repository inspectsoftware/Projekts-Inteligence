import type { Feature, FeatureCollection } from 'geojson'
import type { ExpressionSpecification, FilterSpecification, GeoJSONSource, LayerSpecification, Map as MapLibreMap } from 'maplibre-gl'
import type { MapTheme } from './style'

/**
 * Close in, the streets lane by lane, as osm2streets builds them from OpenStreetMap on our server
 * (server/streets/detailed.ts): every lane as a shape coloured by what it is for, the junctions'
 * own areas, the paint between the lanes and the arrows in them, the pavements, the islands and
 * hatched areas mappers have drawn, and bridges over the roads beneath. Fetched a z15 tile at a
 * time (about 670 m square) for the tiles in view; the map's own street lines stay underneath, so
 * a street not yet built still shows.
 */
export const STREETS_SOURCE = 'streets'
/** Drawn from this zoom in; tiles are fetched a little before. */
export const STREETS_ZOOM = 16
const TILE_ZOOM = 15
/** Tiles kept in hand at most; the least lately seen go first. */
const KEEP = 12

export interface StreetsPalette {
  asphalt: string
  bus: string
  bike: string
  parking: string
  pavement: string
  paint: string
  bridge: string
  casing: string
  island: string
  grass: string
  kerb: string
}

export const STREETS_PALETTES: Record<MapTheme, StreetsPalette> = {
  light: { asphalt: '#a3a8b0', bus: '#c79d97', bike: '#d4a29e', parking: '#b8bcc3', pavement: '#e9ebee', paint: '#ffffff', bridge: '#adb2ba', casing: '#7a8089', island: '#e2e5e9', grass: '#cbe8ad', kerb: '#878d96' },
  dark: { asphalt: '#2c3844', bus: '#4b3639', bike: '#4c3a3b', parking: '#33404c', pavement: '#1d2631', paint: '#c5d1dc', bridge: '#33414e', casing: '#05080b', island: '#1f2934', grass: '#14231f', kerb: '#3f4b59' },
}

/** The hatching, a tile of it: the paint's stripes slanting over the asphalt, at twice the screen's pixels. */
export function hatchImage(C: StreetsPalette): { width: number; height: number; data: Uint8Array } {
  const size = 16
  const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
  const [paint, asphalt] = [rgb(C.paint), rgb(C.asphalt)]
  const data = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) data.set([...((x + y) % size < 5 ? paint : asphalt), 255], (y * size + x) * 4)
  return { width: size, height: size, data }
}

/** The z15 tiles a view's bounds reach into, at most 16 (a wider view is too far out to draw them). */
export function tilesInView([west, south, east, north]: [number, number, number, number]): [number, number][] {
  const n = 2 ** TILE_ZOOM
  const tx = (lon: number) => Math.floor(((lon + 180) / 360) * n)
  const ty = (lat: number) => {
    const r = (Math.max(-85, Math.min(85, lat)) * Math.PI) / 180
    return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n)
  }
  const out: [number, number][] = []
  for (let x = tx(west); x <= tx(east); x++) for (let y = ty(north); y <= ty(south); y++) out.push([x, y])
  return out.length > 16 ? [] : out
}

const kind = (k: string): FilterSpecification => ['==', ['get', 'kind'], k]
const level = (above: boolean): ExpressionSpecification => (above ? ['>=', ['get', 'layer'], 1] : ['==', ['get', 'layer'], 0])
const PAVEMENT = ['Sidewalk', 'Footway', 'SharedUse']

/**
 * The layers, bottom to top: pavements, asphalt, paint, the hatched areas and the islands on the
 * ground; then a bridge's casing, asphalt and paint.
 */
export function streetsLayers(theme: MapTheme): LayerSpecification[] {
  const C = STREETS_PALETTES[theme]
  const common = { source: STREETS_SOURCE, minzoom: STREETS_ZOOM } as const
  // A lane's colour by what it is for; a junction's area is asphalt.
  const laneColour = (asphalt: string): ExpressionSpecification => ['match', ['get', 'type'], 'Bus', C.bus, 'Biking', C.bike, 'Parking', C.parking, asphalt]
  const ground = (above: boolean): LayerSpecification[] => {
    const at = level(above)
    const sfx = above ? '-bridge' : ''
    return [
      { id: `streets-pavement${sfx}`, type: 'fill', ...common, filter: ['all', at, ['any', ['all', kind('lane'), ['in', ['get', 'type'], ['literal', PAVEMENT]]], kind('corner')]], paint: { 'fill-color': C.pavement } },
      { id: `streets-asphalt${sfx}`, type: 'fill', ...common, filter: ['all', at, ['any', kind('junction'), ['all', kind('lane'), ['!', ['in', ['get', 'type'], ['literal', PAVEMENT]]]]]], paint: { 'fill-color': laneColour(above ? C.bridge : C.asphalt) } },
      { id: `streets-paint${sfx}`, type: 'fill', ...common, filter: ['all', at, kind('mark')], paint: { 'fill-color': C.paint } },
    ] as LayerSpecification[]
  }
  const edge = (at16: number, at20: number): ExpressionSpecification => ['interpolate', ['exponential', 2], ['zoom'], 16, at16, 20, at20]
  return [
    ...ground(false),
    // Where no car may go: the hatching, edged in paint; the islands, kerbed (green where grass).
    { id: 'streets-hatch', type: 'fill', ...common, filter: kind('hatch'), paint: { 'fill-pattern': `streets-hatch-${theme}` } },
    { id: 'streets-hatch-edge', type: 'line', ...common, filter: kind('hatch'), layout: { 'line-join': 'round' }, paint: { 'line-color': C.paint, 'line-width': edge(0.5, 3) } },
    { id: 'streets-island', type: 'fill', ...common, filter: kind('island'), paint: { 'fill-color': ['match', ['get', 'type'], 'grass', C.grass, C.island] } },
    { id: 'streets-island-kerb', type: 'line', ...common, filter: kind('island'), layout: { 'line-join': 'round' }, paint: { 'line-color': C.kerb, 'line-width': edge(0.5, 2.5) } },
    // A bridge's dark edge, under its own surface: only the outer part shows.
    { id: 'streets-bridge-casing', type: 'line', ...common, filter: ['all', level(true), ['any', kind('lane'), kind('junction')]], layout: { 'line-join': 'round' }, paint: { 'line-color': C.casing, 'line-width': ['interpolate', ['exponential', 2], ['zoom'], 16, 1.5, 20, 8] } } as LayerSpecification,
    ...ground(true),
  ]
}

let map: MapLibreMap | null = null
let theme: MapTheme = 'dark'
let on = true
const tiles = new Map<string, Feature[]>()
const asked = new Set<string>()

function draw(): void {
  ;(map?.getSource(STREETS_SOURCE) as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: [...tiles.values()].flat() })
}

/** Fetch the tiles in view not yet in hand; drop the least lately seen past KEEP. */
async function refresh(): Promise<void> {
  if (!map || !on || map.getZoom() < STREETS_ZOOM - 0.5) return
  const b = map.getBounds()
  const wanted = tilesInView([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()])
  for (const [x, y] of wanted) {
    const key = `${x}/${y}`
    const have = tiles.get(key)
    if (have) {
      // Seen again: to the back of the queue.
      tiles.delete(key)
      tiles.set(key, have)
      continue
    }
    if (asked.has(key)) continue
    asked.add(key)
    void fetch(`/api/streets/${TILE_ZOOM}/${key}`)
      .then((res) => (res.ok ? (res.json() as Promise<FeatureCollection>) : null))
      .then((fc) => {
        if (!fc) return
        tiles.set(key, fc.features)
        while (tiles.size > KEEP) tiles.delete(tiles.keys().next().value!)
        draw()
      })
      .catch(() => {})
      // Not there now (Overpass busy): asked again on a later move.
      .finally(() => asked.delete(key))
  }
}

export function addStreets(target: MapLibreMap, before: string): void {
  if (target.getSource(STREETS_SOURCE)) return
  map = target
  target.addSource(STREETS_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, tolerance: 0.2 })
  for (const t of ['light', 'dark'] as const) if (!target.hasImage(`streets-hatch-${t}`)) target.addImage(`streets-hatch-${t}`, hatchImage(STREETS_PALETTES[t]), { pixelRatio: 2 })
  for (const layer of streetsLayers(theme)) target.addLayer({ ...layer, layout: { ...layer.layout, visibility: on ? 'visible' : 'none' } } as LayerSpecification, target.getLayer(before) ? before : undefined)
  target.on('moveend', () => void refresh())
  void refresh()
}

export function setStreetsTheme(next: MapTheme): void {
  theme = next
  if (!map) return
  for (const layer of streetsLayers(theme)) {
    for (const [key, value] of Object.entries(layer.paint ?? {})) {
      if ((key.endsWith('color') || key.endsWith('pattern')) && map.getLayer(layer.id)) map.setPaintProperty(layer.id, key as Parameters<MapLibreMap['setPaintProperty']>[1], value)
    }
  }
}

/** On the drawn map only: over the photos their own streets show. */
export function setStreetsOn(next: boolean): void {
  on = next
  if (!map) return
  for (const layer of streetsLayers(theme)) if (map.getLayer(layer.id)) map.setLayoutProperty(layer.id, 'visibility', on ? 'visible' : 'none')
  void refresh()
}

// The map holds this module's layers: a change reloads the page rather than losing hold of them.
import.meta.hot?.accept(() => window.location.reload())
