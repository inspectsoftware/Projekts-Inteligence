import { EdgeIndex, type RoadGraph, type Way } from './roads'

/**
 * Puts a route's line on the streets (or tracks) it really runs along: the operators' lines cut
 * corners and drift a few metres off the road; this follows the road graph from OpenStreetMap,
 * one-way streets the right way, and comes out in the right-hand lane of the direction travelled.
 *
 * A hidden Markov model, as map matchers such as OSRM's and Valhalla's are: the line is sampled
 * every SAMPLE_M metres; each sample may lie on any nearby piece of road, each travelled either way
 * it may be; and the chain of pieces picked is the one where the samples lie close to their pieces
 * and the distance driven between two samples is close to the distance between them as the crow flies.
 */

const SAMPLE_M = 20
/** A piece of road further than this from a sample is not where that sample was. */
const RADIUS_M = 30
/** How far a sample usually lies off its road (GPS, drawing), metres. */
const SIGMA_M = 8
/** How much a driven distance may differ from the straight one, metres, before it costs like a sample SIGMA off. */
const BETA_M = 12
/** Lane width, for putting a vehicle in the right-hand lane. */
const LANE_M = 3.2
/** Fewer of the line's samples than this on the graph, and the line is left as the operator drew it. */
const MIN_MATCHED = 0.8

interface State {
  edge: number
  forward: boolean
  /** Metres along the edge in the direction travelled, from where it is entered. */
  at: number
  off: number
  x: number
  y: number
}

export interface MatchedLine {
  /** lon, lat, lon, lat… on the road, in the right-hand lane of the way travelled. */
  points: Float64Array
  /** Where along it, in metres, the traffic signals stand. */
  signals: number[]
}

const metres = (lon1: number, lat1: number, lon2: number, lat2: number) =>
  Math.hypot((lon2 - lon1) * Math.cos(((lat1 + lat2) / 2) * (Math.PI / 180)), lat2 - lat1) * 111_320

/** Points every SAMPLE_M metres along a line, its ends included. */
function samples(line: Float64Array): [number, number][] {
  const out: [number, number][] = [[line[0], line[1]]]
  let carry = 0
  for (let i = 2; i < line.length; i += 2) {
    const [ax, ay, bx, by] = [line[i - 2], line[i - 1], line[i], line[i + 1]]
    const length = metres(ax, ay, bx, by)
    let d = SAMPLE_M - carry
    while (d < length) {
      out.push([ax + ((bx - ax) * d) / length, ay + ((by - ay) * d) / length])
      d += SAMPLE_M
    }
    carry = length - (d - SAMPLE_M)
  }
  out.push([line[line.length - 2], line[line.length - 1]])
  return out
}

export class MapMatcher {
  private readonly index: EdgeIndex

  private readonly graph: RoadGraph

  constructor(graph: RoadGraph) {
    this.graph = graph
    this.index = new EdgeIndex(graph)
  }

  private states(x: number, y: number, kind: Way): State[] {
    const out: State[] = []
    for (const { edge, f, off } of this.index.near(x, y, kind, RADIUS_M)) {
      const e = this.graph.edges[edge]
      const [px, py] = [this.graph.lon[e.from] + f * (this.graph.lon[e.to] - this.graph.lon[e.from]), this.graph.lat[e.from] + f * (this.graph.lat[e.to] - this.graph.lat[e.from])]
      out.push({ edge, forward: true, at: f * e.length, off, x: px, y: py })
      if (e.twoWay) out.push({ edge, forward: false, at: (1 - f) * e.length, off, x: px, y: py })
    }
    // The nearest few are enough, and keep the search small.
    return out.sort((a, b) => a.off - b.off).slice(0, 8)
  }

  private exit(s: State): number {
    const e = this.graph.edges[s.edge]
    return s.forward ? e.to : e.from
  }

  private entry(s: State): number {
    const e = this.graph.edges[s.edge]
    return s.forward ? e.from : e.to
  }

  /**
   * Shortest drives from a state to each vertex within `limit` metres, along the graph's pieces of
   * the same kind, each the right way: the distance and the vertex it was reached from.
   */
  private drives(s: State, kind: Way, limit: number): Map<number, { d: number; prev: number; via: [number, boolean] | null }> {
    const e = this.graph.edges[s.edge]
    const start = this.exit(s)
    const best = new Map<number, { d: number; prev: number; via: [number, boolean] | null }>([[start, { d: e.length - s.at, prev: -1, via: null }]])
    const queue: [number, number][] = [[e.length - s.at, start]]
    while (queue.length) {
      // A small search: a sorted array is quicker here than a heap.
      queue.sort((a, b) => b[0] - a[0])
      const [d, v] = queue.pop()!
      if (d > (best.get(v)?.d ?? Infinity) || d > limit) continue
      for (const [i, forward] of this.graph.out[v]) {
        const edge = this.graph.edges[i]
        if (edge.kind !== kind) continue
        const w = forward ? edge.to : edge.from
        const nd = d + edge.length
        if (nd < (best.get(w)?.d ?? Infinity)) {
          best.set(w, { d: nd, prev: v, via: [i, forward] })
          queue.push([nd, w])
        }
      }
    }
    return best
  }

  /** Metres driven from one state to the next, or Infinity if the next cannot be reached that way. */
  private driven(a: State, b: State, reach: Map<number, { d: number }> | null): number {
    if (a.edge === b.edge && a.forward === b.forward && b.at >= a.at - 1) return Math.max(0, b.at - a.at)
    const to = reach?.get(this.entry(b))
    return to ? to.d + b.at : Infinity
  }

  /** The line on the graph, or null when too little of it lies on the graph for the match to be trusted. */
  match(line: Float64Array, kind: Way): MatchedLine | null {
    const points = samples(line)
    const layers = points.map(([x, y]) => this.states(x, y, kind))
    const matched = layers.filter((layer) => layer.length > 0).length
    if (matched < points.length * MIN_MATCHED) return null

    // Viterbi. A sample with no road near it is stepped over: the drive from the sample before it to
    // the one after it bridges it, if there is one. A step nothing can drive breaks the chain, and the
    // match starts afresh after it, rather than force a wrong turn.
    const cost: number[][] = []
    const back: number[][] = []
    /** For each sample, the sample its states are reached from (-1: none, the chain starts here). */
    const from: number[] = layers.map(() => -1)
    let previous = -1
    let breaks = 0
    for (let i = 0; i < layers.length; i++) {
      cost.push(layers[i].map((s) => (s.off / SIGMA_M) ** 2 / 2))
      back.push(layers[i].map(() => -1))
      if (!layers[i].length) continue
      if (previous >= 0) {
        const straight = metres(points[previous][0], points[previous][1], points[i][0], points[i][1])
        const limit = straight * 3 + 2 * RADIUS_M + 100
        const reaches = layers[previous].map((s) => this.drives(s, kind, limit))
        const best = layers[i].map(() => Infinity)
        layers[i].forEach((s, j) => {
          layers[previous].forEach((p, k) => {
            const d = this.driven(p, s, reaches[k])
            if (!Number.isFinite(d)) return
            const total = cost[previous][k] + Math.abs(d - straight) / BETA_M
            if (total < best[j]) [best[j], back[i][j]] = [total, k]
          })
        })
        if (back[i].some((k) => k >= 0)) {
          from[i] = previous
          layers[i].forEach((_, j) => (cost[i][j] += Number.isFinite(best[j]) ? best[j] : 1e6))
        } else breaks++
      }
      previous = i
    }
    // A line that keeps breaking does not run on this graph: the wrong way down a one-way street, or off it.
    if (breaks > Math.max(1, points.length * 0.1)) return null

    // Walk back from the cheapest end of each chain.
    const chosen: (State | null)[] = layers.map(() => null)
    const linked: boolean[] = layers.map(() => false)
    let i = layers.length - 1
    while (i >= 0) {
      if (!layers[i].length) {
        i--
        continue
      }
      let j = cost[i].indexOf(Math.min(...cost[i]))
      while (i >= 0 && j >= 0) {
        chosen[i] = layers[i][j]
        const k = back[i][j]
        if (k < 0 || from[i] < 0) {
          i--
          break
        }
        linked[i] = true
        // Samples stepped over between the two are bridged by the drive.
        for (let gap = from[i] + 1; gap < i; gap++) linked[gap] = true
        i = from[i]
        j = k
      }
    }

    return this.trace(chosen, linked, points, kind)
  }

  /** The road geometry through the chosen states, shifted into the right-hand lane, with its signals. */
  private trace(chosen: (State | null)[], linked: boolean[], points: [number, number][], kind: Way): MatchedLine {
    // Each stretch as a run of points with the lane offset that applies on it.
    const run: { x: number; y: number; lane: number; signal: boolean }[] = []
    const laneOf = (edge: number) => (kind === 'road' ? ((this.graph.edges[edge].lanes - 1) * LANE_M) / 2 : 0)
    const push = (x: number, y: number, lane: number, signal = false) => {
      const last = run[run.length - 1]
      if (!last || last.x !== x || last.y !== y) run.push({ x, y, lane, signal })
    }
    let p: State | null = null
    let pi = -1
    for (let i = 0; i < chosen.length; i++) {
      const s = chosen[i]
      if (!s) {
        // Off the graph and not bridged: the operator's line, as it is.
        if (!linked[i]) push(points[i][0], points[i][1], 0)
        continue
      }
      if (p && linked[i] && !(p.edge === s.edge && p.forward === s.forward && s.at >= p.at - 1)) {
        const straight = metres(points[pi][0], points[pi][1], points[i][0], points[i][1])
        const reach = this.drives(p, kind, straight * 3 + 2 * RADIUS_M + 100)
        // The vertices driven through, last to first, then in order.
        const way: { v: number; edge: number }[] = []
        let v = this.entry(s)
        let step = reach.get(v)
        while (step && step.via) {
          way.push({ v, edge: step.via[0] })
          v = step.prev
          step = reach.get(v)
        }
        const exit = this.exit(p)
        push(this.graph.lon[exit], this.graph.lat[exit], laneOf(p.edge), this.graph.signals.has(exit))
        for (const { v: w, edge } of way.reverse()) push(this.graph.lon[w], this.graph.lat[w], laneOf(edge), this.graph.signals.has(w))
      }
      push(s.x, s.y, laneOf(s.edge))
      p = s
      pi = i
    }
    return shift(run)
  }
}

/** A run of points moved right by each point's lane offset, and where along it its signals are. */
function shift(run: { x: number; y: number; lane: number; signal: boolean }[]): MatchedLine {
  const out: number[] = []
  const signals: number[] = []
  let walked = 0
  for (let i = 0; i < run.length; i++) {
    const p = run[i]
    if (i > 0) walked += metres(run[i - 1].x, run[i - 1].y, p.x, p.y)
    if (p.signal) signals.push(walked)
    // The direction here: from the point before to the point after, so a corner's offset splits the bend.
    const a = run[Math.max(0, i - 1)]
    const b = run[Math.min(run.length - 1, i + 1)]
    const k = Math.cos(p.y * (Math.PI / 180))
    const [dx, dy] = [(b.x - a.x) * k, b.y - a.y]
    const len = Math.hypot(dx, dy)
    if (len === 0 || p.lane === 0) {
      out.push(p.x, p.y)
      continue
    }
    // Right of the direction of travel: (dy, -dx).
    out.push(p.x + ((dy / len) * p.lane) / (111_320 * k), p.y + ((-dx / len) * p.lane) / 111_320)
  }
  return { points: Float64Array.from(out), signals }
}
