/**
 * The streets and tracks of a town, from OpenStreetMap, as a graph public transport is matched to:
 * which way each piece may be driven, how many lanes it has each way, where its traffic signals and
 * pedestrian crossings are. Built from an Overpass answer (`out tags geom`): ways whose points meet
 * at the same coordinates are joined there, as OSM joins them at a shared node.
 */

/** What runs on a piece of the graph: buses, trolleybuses and minibuses on roads, trams and trains on their tracks. */
export type Way = 'road' | 'tram' | 'rail'

export interface Edge {
  from: number
  to: number
  kind: Way
  length: number
  /** May it be driven from `to` back to `from`? */
  twoWay: boolean
  /** Lanes in all, both ways together (OSM `lanes`, else a guess from the kind of road). */
  lanes: number
}

export interface RoadGraph {
  lon: number[]
  lat: number[]
  edges: Edge[]
  /** For each vertex, the edges that may be driven away from it, as [edge, forward]. */
  out: [number, boolean][][]
  /** Vertices with traffic signals (OSM highway=traffic_signals, crossing=traffic_signals). */
  signals: Set<number>
  /** Pedestrian crossings, for drawing: points and the short ways across the road. */
  crossings: { points: [number, number][]; ways: [number, number][][] }
}

interface OverpassElement {
  type: 'node' | 'way'
  lat?: number
  lon?: number
  tags?: Record<string, string>
  geometry?: { lat: number; lon: number }[]
}

const ROAD_LANES: Record<string, number> = { motorway: 4, trunk: 4, primary: 4, secondary: 2, tertiary: 2 }

/**
 * A one-way road's lanes by what they are for, from OSM's `turn:lanes` ("left|through|through|right"),
 * left to right: those only for turning left, those going on, those only for turning right (or
 * ending, "merge_to_left"). Without the tag, every lane goes on.
 */
export function turnLanes(tags: Record<string, string | undefined>, total: number): { left: number; through: number; right: number } {
  const lanes = (tags['turn:lanes'] ?? tags['turn:lanes:forward'] ?? '').split('|')
  if (lanes.length !== total) return { left: 0, through: total, right: 0 }
  const goesOn = (lane: string) => lane === '' || lane === 'none' || lane.split(';').includes('through')
  let left = 0
  while (left < total && !goesOn(lanes[left]) && /left/.test(lanes[left])) left++
  let right = 0
  while (right < total - left && !goesOn(lanes[total - 1 - right]) && /right|merge/.test(lanes[total - 1 - right])) right++
  // A road with no lane going on is all turning: drawn as it is, every lane on.
  return left + right >= total ? { left: 0, through: total, right: 0 } : { left, through: total - left - right, right }
}

function kindOf(tags: Record<string, string>): Way | null {
  if (tags.railway === 'tram') return 'tram'
  if (tags.railway === 'rail' || tags.railway === 'light_rail') return 'rail'
  if (tags.highway && tags.footway !== 'crossing') return 'road'
  return null
}

/** -1: drivable only against the way's drawing direction, 1: only along it, 0: both. */
function oneway(tags: Record<string, string>): -1 | 0 | 1 {
  const value = tags.oneway
  if (value === '-1') return -1
  if (value === 'yes' || value === '1' || value === 'true') return 1
  if (value === 'no') return 0
  if (tags.junction === 'roundabout' || tags.junction === 'circular' || tags.highway === 'motorway' || tags.highway === 'motorway_link') return 1
  return 0
}

const metres = (lon1: number, lat1: number, lon2: number, lat2: number) =>
  Math.hypot((lon2 - lon1) * Math.cos(((lat1 + lat2) / 2) * (Math.PI / 180)), lat2 - lat1) * 111_320

export function buildRoadGraph(elements: readonly OverpassElement[]): RoadGraph {
  const lon: number[] = []
  const lat: number[] = []
  const ids = new Map<string, number>()
  const vertex = (x: number, y: number) => {
    const key = `${x.toFixed(7)},${y.toFixed(7)}`
    let id = ids.get(key)
    if (id === undefined) {
      id = lon.length
      ids.set(key, id)
      lon.push(x)
      lat.push(y)
    }
    return id
  }

  const edges: Edge[] = []
  const crossings: RoadGraph['crossings'] = { points: [], ways: [] }
  const signalPoints: [number, number][] = []
  for (const element of elements) {
    const tags = element.tags ?? {}
    if (element.type === 'node' && element.lon !== undefined && element.lat !== undefined) {
      if (tags.highway === 'traffic_signals' || tags.crossing === 'traffic_signals') signalPoints.push([element.lon, element.lat])
      if (tags.highway === 'crossing') crossings.points.push([element.lon, element.lat])
      continue
    }
    if (element.type !== 'way' || !element.geometry || element.geometry.length < 2) continue
    if (tags.footway === 'crossing') {
      crossings.ways.push(element.geometry.map((point) => [point.lon, point.lat]))
      continue
    }
    const kind = kindOf(tags)
    if (!kind) continue
    const direction = kind === 'road' ? oneway(tags) : tags.oneway === 'yes' ? 1 : 0
    const total = Number(tags.lanes) || (direction !== 0 ? 1 : (ROAD_LANES[tags.highway] ?? 2))
    // A bus going on keeps to the lanes going on, not to a turning lane beside them (lanes.ts draws them so).
    const lanes = direction !== 0 && kind === 'road' ? turnLanes(tags, total).through : total
    const points = direction === -1 ? [...element.geometry].reverse() : element.geometry
    for (let i = 1; i < points.length; i++) {
      const from = vertex(points[i - 1].lon, points[i - 1].lat)
      const to = vertex(points[i].lon, points[i].lat)
      if (from === to) continue
      edges.push({ from, to, kind, length: metres(lon[from], lat[from], lon[to], lat[to]), twoWay: direction === 0, lanes })
    }
  }

  const out: RoadGraph['out'] = lon.map(() => [])
  edges.forEach((edge, i) => {
    out[edge.from].push([i, true])
    if (edge.twoWay) out[edge.to].push([i, false])
  })
  // A signal mapped as its own node beside the road still holds up whatever passes it.
  const signals = new Set<number>()
  for (const [x, y] of signalPoints) {
    const id = ids.get(`${x.toFixed(7)},${y.toFixed(7)}`)
    if (id !== undefined) signals.add(id)
  }
  return { lon, lat, edges, out, signals, crossings }
}

/** Edges near a point, found through a grid of about 100 m cells. */
export class EdgeIndex {
  private readonly cells = new Map<string, number[]>()
  private static readonly CELL = 0.001

  private readonly graph: RoadGraph

  constructor(graph: RoadGraph) {
    this.graph = graph
    graph.edges.forEach((edge, i) => {
      const [x1, y1, x2, y2] = [graph.lon[edge.from], graph.lat[edge.from], graph.lon[edge.to], graph.lat[edge.to]]
      const c = EdgeIndex.CELL
      for (let gx = Math.floor(Math.min(x1, x2) / c); gx <= Math.floor(Math.max(x1, x2) / c); gx++) {
        for (let gy = Math.floor(Math.min(y1, y2) / c); gy <= Math.floor(Math.max(y1, y2) / c); gy++) {
          const key = `${gx},${gy}`
          const list = this.cells.get(key)
          if (list) list.push(i)
          else this.cells.set(key, [i])
        }
      }
    })
  }

  /** Edges of this kind within `radius` metres, each with the nearest point on it. */
  near(x: number, y: number, kind: Way, radius: number): { edge: number; f: number; off: number }[] {
    const c = EdgeIndex.CELL
    const seen = new Set<number>()
    const found: { edge: number; f: number; off: number }[] = []
    const k = Math.cos(y * (Math.PI / 180))
    const reach = Math.ceil(radius / (c * 111_320 * k))
    const [gx, gy] = [Math.floor(x / c), Math.floor(y / c)]
    for (let dx = -reach; dx <= reach; dx++) {
      for (let dy = -reach; dy <= reach; dy++) {
        for (const i of this.cells.get(`${gx + dx},${gy + dy}`) ?? []) {
          if (seen.has(i)) continue
          seen.add(i)
          const edge = this.graph.edges[i]
          if (edge.kind !== kind) continue
          const [ax, ay, bx, by] = [this.graph.lon[edge.from] * k, this.graph.lat[edge.from], this.graph.lon[edge.to] * k, this.graph.lat[edge.to]]
          const [px, py] = [x * k, y]
          const len = (bx - ax) ** 2 + (by - ay) ** 2
          const f = len === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / len))
          const off = Math.hypot(px - (ax + f * (bx - ax)), py - (ay + f * (by - ay))) * 111_320
          if (off <= radius) found.push({ edge: i, f, off })
        }
      }
    }
    return found
  }
}
