import type { Map as MapLibreMap } from 'maplibre-gl'
import { inside } from './mesh'
import type { BakedLeaf, CityCatalogue, CityLayer, ModelCrs, NodeBox, Polygon } from './types'

/** The level of the vector tiles the extruded buildings come from: the deepest OpenFreeMap has. */
export const TILE_ZOOM = 14

const EARTH_RADIUS = 6371008.8
const WEB_MERCATOR_HALF = 20037508.342789244
const DEGREE = Math.PI / 180

export interface LngLat {
  lng: number
  lat: number
}

/** Mercator y of a latitude, 0 at the top of the world and 1 at the bottom. */
function mercatorYOf(lat: number): number {
  return (1 - Math.log(Math.tan(lat * DEGREE) + 1 / Math.cos(lat * DEGREE)) / Math.PI) / 2
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
  lodThreshold?: number
  mesh?: { geometry: { resource: number; vertexCount?: number; featureCount?: number }; material?: { resource?: number; texelCountHint?: number } }
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

/** Below and above a mesh node's box, room to draw it once set down by the terrain and raised again by the relief, metres. ponytail: Rīga lies within 30 m of the sea; widen for a hillier city. */
const MESH_HEIGHT_MARGIN = 60

/** One node of a photographed city as the traversal needs it, in Mercator units throughout. */
export interface MeshNode {
  key: string
  children: number[]
  obb: NodeBox
  /** The middle of its box: x, y and height. */
  centre: [number, number, number]
  /** The sphere round its box. */
  radius: number
  /**
   * The box round its turned box, as outside() takes boxes, with room above and below for the
   * terrain. It does not hold the sphere.
   */
  box: number[]
  /** Wholly inside a cut of its scene: nothing of it is drawn, nor of the nodes under it. */
  gone?: boolean
  /** Past this area on screen, in pixels squared, its children are drawn in its place (I3S lodThreshold, maxScreenThresholdSQ). */
  threshold: number
  /** Its layer's rank: drawn in place of a higher one where both are. */
  rank: number
  /**
   * Where its geometry and its photo are, how large they are, what its vertices carry, and what of
   * it its scene cuts out; null where the node has none.
   */
  content: { geometry: string; photo: string; vertices: number; texels: number; attributes?: string[]; cuts?: Polygon[] } | null
}

/** A cut of a mesh layer, with the same in Mercator, rings of x, y one after another, and the box round it: west, north, east, south. */
export interface MeshCut {
  box: number[]
  polygon: Polygon
  rings: number[][]
}

/** A mesh layer's cut in Mercator, as meshNode takes it. */
export function meshCut(polygon: Polygon): MeshCut {
  const rings = polygon.map((ring) => ring.flatMap(([lon, lat]) => [(lon + 180) / 360, mercatorYOf(lat)]))
  const xs = rings.flatMap((ring) => ring.filter((_, i) => i % 2 === 0))
  const ys = rings.flatMap((ring) => ring.filter((_, i) => i % 2 === 1))
  return { box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], polygon, rings }
}

/** Whether a ring's edges meet a Mercator box (as outside() takes boxes) anywhere, seen from above. */
function ringMeets(ring: number[], box: number[]): boolean {
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    // The share of the edge from j to i inside the box, side by side (Liang and Barsky).
    const [x, y, dx, dy] = [ring[j], ring[j + 1], ring[i] - ring[j], ring[i + 1] - ring[j + 1]]
    let [low, high] = [0, 1]
    for (const [p, q] of [
      [-dx, x - box[0]],
      [dx, box[3] - x],
      [-dy, y - box[1]],
      [dy, box[4] - y],
    ]) {
      if (p === 0) {
        if (q < 0) high = -1
      } else if (p < 0) low = Math.max(low, q / p)
      else high = Math.min(high, q / p)
    }
    if (low <= high) return true
  }
  return false
}

/** The camera as the traversal sees it. A sphere of radius r at a distance d spans r · focal / d pixels, r and d in the same units. */
export interface MeshView {
  eye: [number, number, number]
  focal: number
  /** Pixels along the longer side a node's photo is shrunk to. */
  photo: number
  /** How far the point the camera looks at is from it. */
  near: number
  /** Whether anything in a Mercator box may show, the view widened a little so a turn finds it there. */
  shows: (box: number[]) => boolean
  /** Whether anything in a Mercator box is on the screen itself. */
  onScreen: (box: number[]) => boolean
}

/** What the traversal picks of the mesh layers. */
export interface MeshPick {
  /** The nodes at the detail the view asks for, ready or not. */
  targets: MeshNode[]
  /** What to draw now: the targets that are ready, and stand-ins for those that are not. */
  draw: MeshNode[]
}

/**
 * A node as the traversal needs it. Its box is Web Mercator metres across and metres up, turned
 * by a quaternion. Up is stretched as Mercator stretches the ground there, so the sphere round
 * the box is round in the space the camera is measured in. Web Mercator layers only: the bake
 * keeps no other. Of the layer's `cuts`, the node keeps those whose edges cross its box; one that
 * holds all its box leaves nothing of it.
 */
export function meshNode(layer: CityLayer, node: I3sNode, cuts: readonly MeshCut[] = []): MeshNode {
  const world = 2 * WEB_MERCATOR_HALF
  const [x, y, z] = node.obb.center
  const stretch = 1 / Math.cos(boxCentre(node.obb, 3857).lat * DEGREE)
  const [qx, qy, qz, qw] = node.obb.quaternion
  const [hx, hy, hz] = node.obb.halfSize
  // The box's three half axes, turned: the columns of the quaternion's rotation, each times its half size.
  const axes = [
    [(1 - 2 * (qy * qy + qz * qz)) * hx, 2 * (qx * qy + qz * qw) * hx, 2 * (qx * qz - qy * qw) * hx * stretch],
    [2 * (qx * qy - qz * qw) * hy, (1 - 2 * (qx * qx + qz * qz)) * hy, 2 * (qy * qz + qx * qw) * hy * stretch],
    [2 * (qx * qz + qy * qw) * hz, 2 * (qy * qz - qx * qw) * hz, (1 - 2 * (qx * qx + qy * qy)) * hz * stretch],
  ]
  let reach = 0
  for (const a of [-1, 1]) {
    for (const b of [-1, 1]) {
      for (const c of [-1, 1]) reach = Math.max(reach, Math.hypot(...[0, 1, 2].map((k) => a * axes[0][k] + b * axes[1][k] + c * axes[2][k])))
    }
  }
  const radius = reach / world
  const centre: [number, number, number] = [(x + WEB_MERCATOR_HALF) / world, (WEB_MERCATOR_HALF - y) / world, (z * stretch) / world]
  // The box round the turned box itself, far closer than a cube round its sphere where it lies long
  // and thin. Each child's lies inside its parent's, so a parent out of view hides no child in it.
  const [across, along, high] = [0, 1, 2].map((k) => (Math.abs(axes[0][k]) + Math.abs(axes[1][k]) + Math.abs(axes[2][k])) / world)
  const up = high + (MESH_HEIGHT_MARGIN * stretch) / world
  const box = [centre[0] - across, centre[1] - along, centre[2] - up, centre[0] + across, centre[1] + along, centre[2] + up]
  const geometry = node.mesh?.geometry
  const material = node.mesh?.material
  // A cut whose edges miss the box holds all of it or none of it: the node's triangles lie inside its box.
  const reaching: Polygon[] = []
  let gone = false
  for (const cut of cuts) {
    if (cut.box[0] > box[3] || cut.box[2] < box[0] || cut.box[1] > box[4] || cut.box[3] < box[1]) continue
    if (cut.rings.some((ring) => ringMeets(ring, box))) reaching.push(cut.polygon)
    else if (inside(box[0], box[1], cut.rings)) gone = true
  }
  return {
    key: `i:${layer.url}#${node.index}`,
    children: node.children ?? [],
    obb: node.obb,
    centre,
    radius,
    box,
    ...(gone && { gone }),
    threshold: node.lodThreshold ?? 0,
    rank: layer.rank ?? 1,
    content: geometry
      ? {
          geometry: `${layer.url}/nodes/${geometry.resource}/geometries/0`,
          photo: `${layer.url}/nodes/${material?.resource ?? geometry.resource}/textures/0`,
          vertices: geometry.vertexCount ?? 0,
          texels: material?.texelCountHint ?? 0,
          attributes: layer.attributes,
          ...(reaching.length && { cuts: reaching }),
        }
      : null,
  }
}

/** Node pages held of all mesh layers together before those not reached for a minute are let go: about 70 KB each. */
const MESH_PAGES = 300

/**
 * The nodes of one mesh layer, read a page at a time as the traversal first reaches them: Rīga's
 * blocks run to a hundred pages and more, of which only those round the camera are wanted. A page
 * that fails is asked for again after a minute.
 */
export class MeshTree {
  readonly layer: CityLayer
  /** The layer's ground in Mercator, as outside() takes boxes: from below the terrain it is set down by to above the TV tower. */
  readonly box: number[]
  private readonly onChange: () => void
  private readonly cuts: MeshCut[]
  private nodes = new Map<number, MeshNode>()
  private asked = new Map<number, number>()
  /** When each page was last reached. */
  private reached = new Map<number, number>()

  constructor(layer: CityLayer, onChange: () => void) {
    this.layer = layer
    this.onChange = onChange
    const [west, south, east, north] = layer.bbox
    const metre = 1 / (2 * Math.PI * EARTH_RADIUS * Math.cos(((south + north) / 2) * DEGREE))
    this.box = [(west + 180) / 360, mercatorYOf(north), -MESH_HEIGHT_MARGIN * metre, (east + 180) / 360, mercatorYOf(south), 450 * metre]
    this.cuts = (layer.cuts ?? []).map(meshCut)
  }

  /** A node, or undefined while its page is on its way. */
  node(index: number): MeshNode | undefined {
    const node = this.known(index)
    if (!node) this.readPage(Math.floor(index / 64))
    return node
  }

  /** A node already read, or undefined; asks for nothing. */
  known(index: number): MeshNode | undefined {
    this.reached.set(Math.floor(index / 64), Date.now())
    return this.nodes.get(index)
  }

  /** Pages reached so far and not let go. */
  get pages(): number {
    return this.reached.size
  }

  /** Lets go of the pages not reached since `since`: one reached again comes from the browser's cache. */
  forget(since: number): void {
    for (const [page, at] of this.reached) {
      if (at >= since) continue
      this.reached.delete(page)
      this.asked.delete(page)
      for (let index = page * 64; index < page * 64 + 64; index++) this.nodes.delete(index)
    }
  }

  private readPage(page: number): void {
    const since = this.asked.get(page)
    if (since !== undefined && Date.now() - since < 60_000) return
    this.asked.set(page, Date.now())
    fetch(`${this.layer.url}/nodepages/${page}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then(({ nodes }: { nodes?: I3sNode[] }) => {
        // Only pages of nodes that exist are asked for, so an error in place of nodes is a failure.
        if (!Array.isArray(nodes)) throw new Error('no nodes')
        for (const node of nodes) this.nodes.set(node.index, meshNode(this.layer, node, this.cuts))
        this.reached.set(page, Date.now())
        this.onChange()
      })
      .catch((err) => console.warn(`[city] ${this.layer.name}: node page ${page} unavailable:`, err))
  }
}

/**
 * A node's photo pixels once shrunk to `side` along its longer side. The photos are powers of two,
 * square or twice as wide as high.
 */
export function shrunkTexels(texels: number, side: number): number {
  const long = 2 ** Math.ceil(Math.log2(Math.max(1, texels)) / 2)
  const shrink = Math.min(1, side / long)
  return texels * shrink * shrink
}

/**
 * Screen pixels across a node's sphere per photo pixel across its photo below which it is never
 * refined: about where most blocks ask for it. A few ask for finer nodes while their photos are
 * still twice as sharp as the screen, which costs four times the pieces and shows nothing more.
 */
const MESH_LEAST_SPAN = 0.8

/** The nodes of a mesh layer: `node` asks for a node's page where it is not read yet, `known` asks for nothing. */
export interface MeshNodes {
  node(index: number): MeshNode | undefined
  known(index: number): MeshNode | undefined
}

/**
 * Picks what of a mesh layer to draw, by I3S's node switching: a node in view whose sphere covers
 * more of the screen than its threshold gives way to its children, and is never drawn with any of
 * them. Past the point the camera looks at, nodes are taken as smaller than they look, the further
 * the smaller, so the far city, hazed anyway, does not crowd out the near. A target that is not
 * ready yet has stand-ins meanwhile: the finer pieces under it still loaded from nearer, else a ready
 * ancestor in place of all its children; where there is neither, what lay there before shows
 * through. A node `hidden` says another mesh shows in its place, or one its scene cuts out whole,
 * is passed over like one out of view. Returns whether everything of the node in view is drawn.
 */
export function selectMesh(
  nodes: MeshNodes,
  index: number,
  view: MeshView,
  ready: (node: MeshNode) => boolean,
  pick: MeshPick,
  hidden: (node: MeshNode) => boolean = () => false,
): boolean {
  const node = nodes.node(index)
  if (!node) return false
  if (!view.shows(node.box) || node.gone || hidden(node)) return true
  const distance = Math.hypot(node.centre[0] - view.eye[0], node.centre[1] - view.eye[1], node.centre[2] - view.eye[2])
  const focal = view.focal * Math.min(1, view.near / distance)
  // From inside its sphere a node fills the screen.
  const area = distance <= node.radius ? Infinity : Math.PI * ((node.radius * focal) / distance) ** 2
  const least = node.content ? (Math.PI / 4) * MESH_LEAST_SPAN ** 2 * shrunkTexels(node.content.texels, view.photo) : 0
  if (!node.children.length || area <= Math.max(node.threshold, least)) {
    if (!node.content) return true
    pick.targets.push(node)
    if (ready(node)) {
      pick.draw.push(node)
      return true
    }
    return standIns(nodes, node, view, ready, pick.draw, hidden)
  }
  const mark = pick.draw.length
  let whole = true
  for (const child of node.children) whole = selectMesh(nodes, child, view, ready, pick, hidden) && whole
  if (whole || !node.content || !ready(node)) return whole
  // A ready node stands in for all its children until every one of them has come.
  pick.draw.splice(mark)
  pick.draw.push(node)
  return true
}

/** Draws the ready pieces nearest the top under a node, among those already read. Returns whether they cover all of it in view. */
function standIns(nodes: MeshNodes, node: MeshNode, view: MeshView, ready: (node: MeshNode) => boolean, draw: MeshNode[], hidden: (node: MeshNode) => boolean): boolean {
  if (!node.children.length) return false
  let whole = true
  for (const index of node.children) {
    const child = nodes.known(index)
    if (!child) whole = false
    else if (!view.shows(child.box) || child.gone || hidden(child)) continue
    else if (child.content && ready(child)) draw.push(child)
    else whole = standIns(nodes, child, view, ready, draw, hidden) && whole
  }
  return whole
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
  private meshes = new Map<string, MeshTree>()
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

  /** The mesh layers that reach within `reach` metres of `at`, each reading its nodes as they are first asked for. */
  meshesNear(at: LngLat, reach: number): MeshTree[] {
    const near: MeshTree[] = []
    for (const layer of this.catalogue?.meshes ?? []) {
      if (!boxNear(layer.bbox, at, reach)) continue
      let tree = this.meshes.get(layer.url)
      if (!tree) {
        tree = new MeshTree(layer, this.onChange)
        this.meshes.set(layer.url, tree)
      }
      near.push(tree)
    }
    // A long walk reads page after page, and keeps every one: past MESH_PAGES, those not reached for a minute go.
    let held = 0
    for (const tree of this.meshes.values()) held += tree.pages
    if (held > MESH_PAGES) for (const tree of this.meshes.values()) tree.forget(Date.now() - 60_000)
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
