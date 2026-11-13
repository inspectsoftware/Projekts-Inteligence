import type { Feature, FeatureCollection } from 'geojson'
import type { ExpressionSpecification, GeoJSONSource, LayerSpecification, Map as MapLibreMap } from 'maplibre-gl'
import type { MapTheme } from './style'

/**
 * Close in, the streets as they lie on the ground, built lane by lane on our server from the roads
 * of the Baltic states (server/streets/detailed.ts): each carriageway as wide as its lanes, the
 * paint on it (lane lines, block lines beside slip-road lanes, double centre lines, stop lines,
 * zebras, turn arrows), junctions paved across with their kerbs rounded and dotted guides over
 * them, the wedges where slip roads leave and join, the islands and hatched areas mappers drew,
 * and bridges with their shadows. Drawn as a detailed city map draws them: one grey, thin paint.
 * Fetched a z15 tile at a time (about 670 m square) for the tiles in view; the map's own street
 * lines stay underneath, so a street not yet built still shows.
 */
export const STREETS_SOURCE = 'streets'
/** The asphalt from this zoom in; tiles are fetched a little before. */
export const STREETS_ZOOM = 16
/** The paint from this zoom in, as on a detailed city map: further out it is noise. */
export const PAINT_ZOOM = 17
const TILE_ZOOM = 15
/** Tiles kept in hand at most; the least lately seen go first. */
const KEEP = 12

export interface StreetsPalette {
  asphalt: string
  bridge: string
  shadow: string
  paint: string
  island: string
  grass: string
  kerb: string
  pavement: string
  kerbLine: string
  parapet: string
}

export const STREETS_PALETTES: Record<MapTheme, StreetsPalette> = {
  light: { asphalt: '#b4b4b4', bridge: '#bdbdbd', shadow: 'rgba(60,60,50,0.3)', paint: '#ffffff', island: '#cdcdcd', grass: '#c6ea96', kerb: '#c2c2c2', pavement: '#e4e3dd', kerbLine: '#c9c8c1', parapet: '#8c8c8c' },
  dark: { asphalt: '#2c3844', bridge: '#33414e', shadow: 'rgba(0,0,0,0.55)', paint: '#c5d1dc', island: '#2a3542', grass: '#1f3a2c', kerb: '#4a5868', pavement: '#1c2530', kerbLine: '#34404d', parapet: '#56626f' },
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

/** Screen pixels a metre takes at zoom 15 in the Baltic states (latitude 57; the map's tiles are 512 px). */
const PX_PER_M_Z15 = (512 * 2 ** 15) / (40_075_016.686 * Math.cos((57 * Math.PI) / 180))
/** A width of so many metres on the ground, at every zoom; never thinner than `min` pixels. */
export function metres(m: number, min = 0): ExpressionSpecification {
  const stops = [15, 16, 17, 18, 19, 20, 21, 22].flatMap((z) => [z, Math.max(m * PX_PER_M_Z15 * 2 ** (z - 15), min)])
  return ['interpolate', ['exponential', 2], ['zoom'], ...stops] as ExpressionSpecification
}

type Ex = ExpressionSpecification
const kind = (...k: string[]): Ex => ['in', ['get', 'kind'], ['literal', k]]
const dash = (d: string): Ex => ['==', ['get', 'dash'], d]
const level = (above: boolean): Ex => (above ? ['>=', ['get', 'layer'], 1] : ['==', ['get', 'layer'], 0])
const all = (...xs: Ex[]): Ex => ['all', ...xs] as Ex
const any = (...xs: Ex[]): Ex => ['any', ...xs] as Ex

/**
 * The layers, bottom to top, on the ground and then again on bridges: asphalt; the wedges, hatching
 * and islands; the paint; the arrows. A bridge first throws its shadow.
 */
export function streetsLayers(theme: MapTheme): LayerSpecification[] {
  const C = STREETS_PALETTES[theme]
  const asphalt = { source: STREETS_SOURCE, minzoom: STREETS_ZOOM } as const
  const paint = { source: STREETS_SOURCE, minzoom: PAINT_ZOOM } as const
  const set = (above: boolean): LayerSpecification[] => {
    const at = level(above)
    const sfx = above ? '-bridge' : ''
    const road = above ? C.bridge : C.asphalt
    const lines = (id: string, filter: Ex, width: Ex, dasharray?: number[], opacity = 0.9): LayerSpecification =>
      ({ id: `streets-${id}${sfx}`, type: 'line', ...paint, filter: all(at, filter), paint: { 'line-color': C.paint, 'line-width': width, 'line-opacity': opacity, ...(dasharray ? { 'line-dasharray': dasharray } : {}) } }) as LayerSpecification
    return [
      // The shade a bridge casts on what runs under it: soft, wide, off to one side.
      ...(above ? [{ id: 'streets-bridge-shade', type: 'line', ...asphalt, filter: all(at, kind('carriageway')), paint: { 'line-color': C.shadow, 'line-width': metres(8, 4), 'line-blur': metres(6, 3), 'line-translate': ['literal', [3, 4]], 'line-translate-anchor': 'map' } } as LayerSpecification] : []),
      ...(above ? [{ id: 'streets-bridge-shadow', type: 'fill', ...asphalt, filter: all(at, kind('carriageway')), paint: { 'fill-color': C.shadow, 'fill-translate': ['interpolate', ['exponential', 2], ['zoom'], 16, ['literal', [1, 1.5]], 20, ['literal', [10, 14]]], 'fill-translate-anchor': 'map' } } as LayerSpecification] : []),
      { id: `streets-asphalt${sfx}`, type: 'fill', ...asphalt, filter: all(at, kind('carriageway', 'junction')), paint: { 'fill-color': road } } as LayerSpecification,
      ...(above
        ? []
        : ([
            // Where a slip road leaves or joins: the wedge between the two, asphalt edged in paint, its chevrons
            // drawn with the paint (just asphalt where mappers drew the hatching or island there themselves).
            { id: 'streets-gore', type: 'fill', ...asphalt, filter: kind('gore'), paint: { 'fill-color': C.asphalt } },
            { id: 'streets-gore-edge', type: 'line', ...paint, filter: all(kind('gore'), ['!', ['get', 'paved']], ['!=', ['get', 'open'], true]), layout: { 'line-join': 'round' }, paint: { 'line-color': C.paint, 'line-width': metres(0.15, 0.8) } },
            // Where no car may go: the hatching inside a painted outline; the islands, kerbed (green where grass).
            { id: 'streets-hatch', type: 'fill', ...asphalt, filter: kind('hatch'), paint: { 'fill-pattern': `streets-hatch-${theme}` } },
            { id: 'streets-hatch-edge', type: 'line', ...paint, filter: kind('hatch'), layout: { 'line-join': 'round' }, paint: { 'line-color': C.paint, 'line-width': metres(0.15, 0.8) } },
            { id: 'streets-island', type: 'fill', ...asphalt, filter: kind('island'), paint: { 'fill-color': ['case', ['get', 'grass'], C.grass, C.island] } },
            { id: 'streets-island-kerb', type: 'line', ...asphalt, filter: kind('island'), layout: { 'line-join': 'round' }, paint: { 'line-color': C.kerb, 'line-width': metres(0.2, 0.6) } },
          ] as LayerSpecification[])),
      // Dash lengths are in line widths: 3 m paint and 3 m gap on a 0.15 m line, 4 and 4 on fast roads.
      lines('lane-short', all(kind('lane-line', 'centre-line'), dash('short')), metres(0.15, 0.8), [20, 20]),
      lines('lane-long', all(kind('lane-line'), dash('long')), metres(0.15, 0.8), [27, 27]),
      lines('lane-solid', any(all(kind('lane-line'), dash('solid')), kind('edge-line')), metres(0.15, 0.8)),
      lines('lane-block', all(kind('lane-line'), dash('block')), metres(0.4, 1.5), [2.5, 2.5]),
      lines('centre-double', all(kind('centre-line'), dash('double')), metres(0.45, 2.2), undefined, 1),
      // The gap down the middle of a double line: the road showing through.
      { id: `streets-centre-gap${sfx}`, type: 'line', ...paint, filter: all(at, kind('centre-line'), dash('double')), paint: { 'line-color': road, 'line-width': metres(0.15, 0.7) } } as LayerSpecification,
      // A bridge's parapets, drawn over its edges.
      { id: `streets-parapet${sfx}`, type: 'line', ...asphalt, filter: all(at, kind('parapet')), layout: { 'line-cap': 'round' }, paint: { 'line-color': C.parapet, 'line-width': metres(0.5, 1.2) } } as LayerSpecification,
      lines('guide', kind('guide'), metres(0.12, 0.7), [5, 12], 0.7),
      lines('stop', kind('stop-line'), metres(0.4, 1.5)),
      // The chevrons in a gore and the stripes across an island where a lane opens or closes.
      lines('chevron', kind('chevron'), metres(0.5, 1.2)),
      { id: `streets-zebra${sfx}`, type: 'fill', ...paint, filter: all(at, kind('zebra')), paint: { 'fill-color': C.paint, 'fill-opacity': 0.9 } } as LayerSpecification,
      // Turn arrows painted 5 m long, turned the way their lane goes; one image per set of turns (arrowImage).
      {
        id: `streets-arrows${sfx}`,
        type: 'symbol',
        source: STREETS_SOURCE,
        minzoom: PAINT_ZOOM + 0.5,
        filter: all(at, kind('arrow')),
        layout: { 'icon-image': ['get', 'icon'], 'icon-rotate': ['get', 'bearing'], 'icon-rotation-alignment': 'map', 'icon-pitch-alignment': 'map', 'icon-allow-overlap': true, 'icon-ignore-placement': true, 'icon-size': metres(5 / ARROW_PX) },
        paint: { 'icon-color': C.paint, 'icon-opacity': 0.9 },
      } as LayerSpecification,
    ]
  }
  // Tunnels and underpasses first, faint: under the ground, seen through it.
  const tunnels = { id: 'streets-tunnel', type: 'fill', ...asphalt, filter: all(['<', ['get', 'layer'], 0], kind('carriageway', 'junction')), paint: { 'fill-color': C.asphalt, 'fill-opacity': 0.4 } } as LayerSpecification
  return [tunnels, ...set(false), ...set(true)]
}

/** An arrow image's height in pixels: 5 m of road at icon-size 1/… (see the arrows layer). */
const ARROW_PX = 64

/**
 * A turn arrow as paint has it, pointing up, white on clear for the map to colour: a shaft and a
 * head for each way the lane goes (arrow-left+through, arrow-right…).
 */
export function arrowImage(name: string): ImageData | null {
  if (typeof document === 'undefined') return null
  const H = ARROW_PX, W = 48
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const g = canvas.getContext('2d')
  if (!g) return null
  g.strokeStyle = g.fillStyle = '#fff'
  g.lineWidth = 4
  g.lineCap = 'round'
  const cx = W / 2, split = H * 0.55
  g.beginPath()
  g.moveTo(cx, H - 2)
  g.lineTo(cx, split)
  g.stroke()
  const ANGLES: Record<string, number> = { through: 0, slight_left: -0.5, left: -1.45, slight_right: 0.5, right: 1.45, reverse: -2.6 }
  for (const turn of name.replace(/^arrow-/, '').split('+')) {
    const a = ANGLES[turn] ?? 0
    const len = turn === 'through' ? split - 14 : 16
    const ex = cx + Math.sin(a) * len, ey = split - Math.cos(a) * len
    g.beginPath()
    g.moveTo(cx, split)
    g.lineTo(ex, ey)
    g.stroke()
    g.save()
    g.translate(ex, ey)
    g.rotate(a)
    g.beginPath()
    g.moveTo(0, -12)
    g.lineTo(-7, 1)
    g.lineTo(7, 1)
    g.closePath()
    g.fill()
    g.restore()
  }
  return g.getImageData(0, 0, W, H)
}

let map: MapLibreMap | null = null
let theme: MapTheme = 'dark'
let on = true
/** Whether the server has the roads to build streets from: until it answers with one, nothing is hidden. */
let served = false
const tiles = new Map<string, Feature[]>()
const asked = new Set<string>()

/** The map's own street lines (src/map/ownStyle.ts), which ours replace from STREETS_ZOOM in. */
export const BASE_ROADS = ['own-road-minor', 'own-road-mid', 'own-road-major', 'own-road-motorway']

/** Close in, the map's own street lines go where ours are drawn, so none shows wider beneath them. */
function hideBaseRoads(): void {
  if (!map) return
  const hide = on && served
  for (const id of BASE_ROADS) {
    // Pedestrian streets and busways are not built as carriageways: they keep their line.
    if (map.getLayer(id)) map.setPaintProperty(id, 'line-opacity', hide ? ['step', ['zoom'], 1, STREETS_ZOOM, ['match', ['get', 'class'], ['pedestrian', 'busway'], 1, 0]] : 1)
  }
}

function draw(): void {
  if (!map) return
  if (!served) {
    served = true
    hideBaseRoads()
  }
  const features = [...tiles.values()].flat()
  // Each set of turns the arrows in hand need, made the first time it is seen.
  for (const f of features) {
    const icon = f.properties?.icon as string | undefined
    if (!icon || map.hasImage(icon)) continue
    const image = arrowImage(icon)
    if (image) map.addImage(icon, image, { sdf: true })
  }
  ;(map.getSource(STREETS_SOURCE) as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features })
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
      // Not there now: asked again on a later move.
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
  hideBaseRoads()
}

/** Over a photo the streets lane by lane come in from this zoom, so further out the photo is left clear. */
export const PHOTO_STREETS_ZOOM = 17

/**
 * Over a photo: the streets from PHOTO_STREETS_ZOOM in, so the lanes and the lines between them (the
 * oncoming side's too) read on the photo. Their asphalt stays solid: see-through, the photo's own paint
 * would show a little beside ours, and pieces overlapping at junctions would show their seams.
 */
export function setStreetsOverPhoto(photo: boolean): void {
  if (!map) return
  for (const layer of streetsLayers(theme)) {
    if (!map.getLayer(layer.id)) continue
    const min = layer.minzoom ?? 0
    map.setLayerZoomRange(layer.id, photo ? Math.max(min, PHOTO_STREETS_ZOOM) : min, 24)
  }
}

/** Whether the streets lane by lane are drawn at all. */
export function setStreetsOn(next: boolean): void {
  on = next
  if (!map) return
  for (const layer of streetsLayers(theme)) if (map.getLayer(layer.id)) map.setLayoutProperty(layer.id, 'visibility', on ? 'visible' : 'none')
  hideBaseRoads()
  void refresh()
}

// The map holds this module's layers: a change reloads the page rather than losing hold of them.
import.meta.hot?.accept(() => window.location.reload())
