import type { Map as MapLibreMap } from 'maplibre-gl'
import type { BakedLeaf, CityCatalogue, CityLayer, ModelCrs, NodeBox } from './types'

/** The level of the vector tiles the extruded buildings come from: the deepest OpenFreeMap has. */
export const TILE_ZOOM = 14

const EARTH_RADIUS = 6371008.8
const WEB_MERCATOR_HALF = 20037508.342789244
const DEGREE = Math.PI / 180

export interface LngLat {
  lng: number
  lat: number
}

/** Metres east and north from `from` to `to`. Plenty exact over the few kilometres the city spans. */
export function offsetMetres(from: LngLat, to: LngLat): [number, number] {
  return [(to.lng - from.lng) * DEGREE * EARTH_RADIUS * Math.cos(from.lat * DEGREE), (to.lat - from.lat) * DEGREE * EARTH_RADIUS]
}

export function moveMetres(from: LngLat, east: number, north: number): LngLat {
  return { lng: from.lng + east / (DEGREE * EARTH_RADIUS * Math.cos(from.lat * DEGREE)), lat: from.lat + north / (DEGREE * EARTH_RADIUS) }
}

function tileCentre(x: number, y: number): LngLat {
  const n = 2 ** TILE_ZOOM
  const mercY = (y + 0.5) / n
  return { lng: ((x + 0.5) / n) * 360 - 180, lat: (Math.atan(Math.sinh(Math.PI * (1 - 2 * mercY))) * 180) / Math.PI }
}

/**
 * Where the camera stands, projected onto the ground, and which way it looks. The centre of the
 * map is where it looks at; the camera itself is that far back along the bearing.
 */
export function cameraGround(map: MapLibreMap): { at: LngLat; forward: [number, number]; behind: number } {
  const centre = map.getCenter()
  const bearing = map.getBearing() * DEGREE
  const pitch = map.getPitch() * DEGREE
  const forward: [number, number] = [Math.sin(bearing), Math.cos(bearing)]
  const behind = cameraDistanceMetres(map) * Math.sin(pitch)
  return { at: moveMetres(centre, -forward[0] * behind, -forward[1] * behind), forward, behind }
}

/** How far the camera is from the centre of the map, in metres: 1.5 canvas heights in pixels, as MapLibre places it. */
export function cameraDistanceMetres(map: MapLibreMap): number {
  const lat = map.getCenter().lat * DEGREE
  const metresPerPixel = (2 * Math.PI * EARTH_RADIUS * Math.cos(lat)) / (512 * 2 ** map.getZoom())
  return 1.5 * map.getCanvas().clientHeight * metresPerPixel
}

export interface WantedTile {
  key: string
  x: number
  y: number
  distance: number
}

/**
 * The vector tiles under the visible part of the map, nearest the camera first, out to `reach`
 * metres from it. Found by casting rays through a grid of points on the screen onto flat ground:
 * a tilted view's footprint is no rectangle, rays at or above the horizon find no ground, and
 * the relief is left out on purpose, since asking the map would march each ray across it.
 * Seen at a slant the far tiles shrink below the gap between rays, so the tiles beside every hit
 * are taken as well.
 */
export function visibleTiles(map: MapLibreMap, reach: number, limit: number): WantedTile[] {
  const canvas = map.getCanvas()
  const n = 2 ** TILE_ZOOM
  const { at, forward } = cameraGround(map)
  const pitch = map.getPitch() * DEGREE
  const height = cameraDistanceMetres(map) * Math.cos(pitch)
  const tanY = Math.tan((map.getVerticalFieldOfView() * DEGREE) / 2)
  const tanX = (tanY * canvas.clientWidth) / Math.max(1, canvas.clientHeight)
  const ring = pitch > 30 * DEGREE ? 1 : 0
  const seen = new Set<string>()
  const found: WantedTile[] = []
  const consider = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= n || y >= n) return
    const key = `${x}/${y}`
    if (seen.has(key)) return
    seen.add(key)
    const [east, north] = offsetMetres(at, tileCentre(x, y))
    // From the tile's middle; half its diagonal is about 940 m here, so a tile partly in reach counts.
    const distance = Math.max(0, Math.hypot(east, north) - 940)
    if (distance <= reach) found.push({ key, x, y, distance })
  }
  const STEPS = 14
  for (let i = 0; i <= STEPS; i++) {
    for (let j = 0; j <= STEPS; j++) {
      const across = ((2 * i) / STEPS - 1) * tanX
      const up = (1 - (2 * j) / STEPS) * tanY
      // The ray in the camera's own frame: right, ahead along the ground, and up.
      const ahead = Math.sin(pitch) + up * Math.cos(pitch)
      const rise = -Math.cos(pitch) + up * Math.sin(pitch)
      // At or above the horizon, or so near it that the ground it meets is out of reach anyway.
      if (rise >= -1e-3) continue
      const t = height / -rise
      if (Math.hypot(across, ahead) * t > reach + 2000) continue
      const east = (across * forward[1] + ahead * forward[0]) * t
      const north = (-across * forward[0] + ahead * forward[1]) * t
      const { lng, lat } = moveMetres(at, east, north)
      if (Math.abs(lat) > 85) continue
      const x = Math.floor(((lng + 180) / 360) * n)
      const y = Math.floor(((1 - Math.log(Math.tan(lat * DEGREE) + 1 / Math.cos(lat * DEGREE)) / Math.PI) / 2) * n)
      for (let dx = -ring; dx <= ring; dx++) for (let dy = -ring; dy <= ring; dy++) consider(x + dx, y + dy)
    }
  }
  return found.sort((a, b) => a.distance - b.distance).slice(0, limit)
}

/** One leaf of a scene layer: the finest the city publishes for that patch of ground. */
export interface Leaf {
  key: string
  layer: CityLayer
  /** The node's own resource number, which names its geometry and features. */
  resource: number
  obb: NodeBox
  /** Vertices for a building node, trees for a tree node. */
  size: number
  centre: LngLat
  /** How far the node reaches from its centre, metres: the sphere round its box. */
  radius: number
}

interface I3sNode {
  index: number
  children?: number[]
  obb: NodeBox
  mesh?: { geometry: { resource: number; vertexCount?: number; featureCount?: number } }
}

export function boxCentre(obb: NodeBox, crs: ModelCrs): LngLat {
  const [x, y] = obb.center
  if (crs === 4326) return { lng: x, lat: y }
  return { lng: (x / WEB_MERCATOR_HALF) * 180, lat: (2 * Math.atan(Math.exp((y / WEB_MERCATOR_HALF) * Math.PI)) - Math.PI / 2) / DEGREE }
}

/**
 * The radius of the sphere round the box, metres. Not half the diagonal of its first two axes: a
 * box often lies on its side, with its height along the second. Web Mercator metres are longer
 * than ground metres away from the equator.
 */
export function boxRadius(obb: NodeBox, crs: ModelCrs): number {
  return Math.hypot(...obb.halfSize) * (crs === 3857 ? Math.cos(boxCentre(obb, crs).lat * DEGREE) : 1)
}

/**
 * A layer's leaves from its baked index. The index keeps only the centre of each node's box and
 * how far the node reaches: only the centre places the geometry, so an upright box whose corners
 * reach that far stands in for the rest.
 */
export function bakedLeaves(layer: CityLayer, rows: BakedLeaf[]): Leaf[] {
  return rows.map(([resource, lng, lat, z, radius, size]) => {
    // The centre in the layer's own CRS, which the node's vertex offsets start from.
    const center: [number, number, number] =
      layer.crs === 4326 ? [lng, lat, z] : [(lng / 180) * WEB_MERCATOR_HALF, (Math.log(Math.tan(Math.PI / 4 + (lat * DEGREE) / 2)) / Math.PI) * WEB_MERCATOR_HALF, z]
    const half = (radius / Math.SQRT2) * (layer.crs === 3857 ? 1 / Math.cos(lat * DEGREE) : 1)
    return {
      key: `m:${layer.url}#${resource}`,
      layer,
      resource,
      obb: { center, halfSize: [half, half, 0], quaternion: [0, 0, 0, 1] },
      size,
      centre: { lng, lat },
      radius,
    }
  })
}

/** A layer's leaves from its node pages, read one after another. */
async function pageLeaves(layer: CityLayer, kind: 'buildings' | 'trees'): Promise<Leaf[]> {
  const nodes: I3sNode[] = []
  // Pages hold 64 nodes; a shorter one is the last.
  for (let page = 0; ; page++) {
    const res = await fetch(`${layer.url}/nodepages/${page}`)
    // Past the last page tiles.arcgis.com answers 404, and the city's own services 200 with an
    // error in place of nodes. Every layer has a root node, so either answer for the first page is
    // a failure, tried again later.
    if (res.status === 404 && page > 0) break
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const { nodes: some } = (await res.json()) as { nodes?: I3sNode[] }
    if (!Array.isArray(some)) {
      if (page === 0) throw new Error('no nodes')
      break
    }
    nodes.push(...some)
    if (some.length < 64) break
  }
  const leaves: Leaf[] = []
  for (const node of nodes) {
    if (!node.mesh || node.children?.length) continue
    const { resource, vertexCount = 0, featureCount = 0 } = node.mesh.geometry
    leaves.push({
      key: `${kind === 'buildings' ? 'm' : 't'}:${layer.url}#${resource}`,
      layer,
      resource,
      obb: node.obb,
      size: kind === 'buildings' ? vertexCount : featureCount,
      centre: boxCentre(node.obb, layer.crs),
      radius: boxRadius(node.obb, layer.crs),
    })
  }
  return leaves
}

/**
 * The catalogue of the city models and the leaves of each of their layers, each read once and
 * only when the camera first comes near. A layer whose leaves fail is asked again after a minute.
 */
export class CityModel {
  catalogue: CityCatalogue | null = null
  private asked = false
  private leaves = new Map<string, Leaf[]>()
  private pending = new Map<string, number>()
  private readonly onChange: () => void

  constructor(onChange: () => void) {
    this.onChange = onChange
  }

  /** Starts reading the catalogue the first time it is needed. */
  load(): void {
    if (this.asked) return
    this.asked = true
    fetch('/data/city-3d.json')
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((catalogue: CityCatalogue) => {
        this.catalogue = catalogue
        this.onChange()
      })
      .catch((err) => {
        console.warn('[city] catalogue unavailable:', err)
        setTimeout(() => (this.asked = false), 60_000)
      })
  }

  /** The leaves of the layers that reach within `reach` metres of `at`, as far as they are read yet. */
  leavesNear(kind: 'buildings' | 'trees', at: LngLat, reach: number): Leaf[] {
    if (!this.catalogue) return []
    const near: Leaf[] = []
    for (const layer of this.catalogue[kind]) {
      if (!boxNear(layer.bbox, at, reach)) continue
      const leaves = this.leaves.get(layer.url)
      if (leaves) near.push(...leaves)
      else this.readLeaves(layer, kind)
    }
    return near
  }

  private readLeaves(layer: CityLayer, kind: 'buildings' | 'trees'): void {
    const since = this.pending.get(layer.url)
    if (since !== undefined && Date.now() - since < 60_000) return
    this.pending.set(layer.url, Date.now())
    void (async () => {
      let leaves: Leaf[]
      if (layer.leaves) {
        const res = await fetch(layer.leaves)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        leaves = bakedLeaves(layer, await res.json())
      } else leaves = await pageLeaves(layer, kind)
      this.leaves.set(layer.url, leaves)
      this.pending.delete(layer.url)
      this.onChange()
    })().catch((err) => console.warn(`[city] ${layer.name}: leaves unavailable:`, err))
  }
}

function boxNear([west, south, east, north]: [number, number, number, number], at: LngLat, reach: number): boolean {
  const nearest = { lng: Math.min(Math.max(at.lng, west), east), lat: Math.min(Math.max(at.lat, south), north) }
  const [dx, dy] = offsetMetres(at, nearest)
  return Math.hypot(dx, dy) <= reach
}
