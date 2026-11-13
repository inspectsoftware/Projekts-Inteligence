// The lane builder: roads as they lie on the ground, from what OSM knows of their lanes, by the
// rules a road is laid out by (right-hand traffic, as in the Baltic states):
//  - a carriageway keeps one edge straight where a lane is added or ends; the lane opens or closes
//    on the other side over a taper, not by both edges moving in to the middle;
//  - which side: the turn lanes say (a left-turn lane opens on the left, a right-turn one on the
//    right); a slip road leaves and joins on its own side; else the right, where a lane ends on a
//    Baltic road (sign 1.20 / "joslu sašaurināšanās");
//  - where a slip road leaves or joins, a light wedge between it and the main road (a gore), and the
//    lane that leaves or joins kept apart by a block line;
//  - junctions paved across with rounded kerbs, the lanes carried over them by dotted guides; stop
//    lines at signals; zebras at crossings; turn arrows before a junction; solid lane lines on the
//    approach to it;
//  - a road OSM gives no lanes for drawn plain, as wide as such a street is, with no lines made up;
//  - the islands and hatched areas mapped in OSM on top.
// The look follows the detailed city maps (2GIS at high zoom): one grey, thin paint.
// Input: ways and tagged nodes as scripts/extract-roads.mjs writes them (roads/, read by roads.ts).
// Output: GeoJSON features in lon/lat, each with its kind (carriageway, junction, lane-line, arrow…).

// Lane widths as Baltic city and main roads are built (Latvian design rules: 3.5 m on main streets, 3.25-3.5 m on
// the others, wider single-lane slip roads), metres.
const LANE = { motorway: 3.75, trunk: 3.75, primary: 3.5, secondary: 3.5, tertiary: 3.5, link: 4.25, minor: 3.25 }
/** Kerb to kerb is a little more than the lanes: the gutters along the kerbs, metres. */
const GUTTERS = 0.5
const TAPER = { fast: 60, city: 30, minor: 18 }
/** How far a carriageway takes to drift back to the middle of its OSM line after a lane change, m. */
const SETTLE = 160
const STEP = 2

const MAJOR = /^(motorway|trunk)(_link)?$/
const cls = (h) => (h?.endsWith('_link') ? 'link' : h)

// ---- geometry -------------------------------------------------------------------------------

export function projector([w, s, e, n]) {
  const lon0 = (w + e) / 2, lat0 = (s + n) / 2
  const kx = 111320 * Math.cos((lat0 * Math.PI) / 180), ky = 110540
  return {
    to: ([lon, lat]) => [(lon - lon0) * kx, (lat - lat0) * ky],
    from: ([x, y]) => [Math.round((x / kx + lon0) * 1e7) / 1e7, Math.round((y / ky + lat0) * 1e7) / 1e7],
  }
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]]
const len = (a) => Math.hypot(a[0], a[1])
const lerp = (a, b, t) => a + (b - a) * t
const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t))

/** A line sampled every STEP metres: points, unit tangents, and the distance of each along it. */
function sample(pts) {
  const out = { p: [], t: [], s: [] }
  let total = 0
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1], d = sub(b, a), l = len(d)
    if (l < 1e-6) continue
    const u = [d[0] / l, d[1] / l]
    for (let x = 0; x < l; x += STEP) {
      out.p.push([a[0] + u[0] * x, a[1] + u[1] * x]); out.t.push(u); out.s.push(total + x)
    }
    total += l
  }
  const last = pts[pts.length - 1]
  out.p.push(last); out.t.push(out.t[out.t.length - 1] ?? [1, 0]); out.s.push(total)
  // Tangents smoothed over the neighbours, so a bend's offset lines do not kink.
  out.t = out.t.map((_, i) => {
    let x = 0, y = 0
    for (let j = Math.max(0, i - 2); j <= Math.min(out.t.length - 1, i + 2); j++) {
      x += out.t[j][0]
      y += out.t[j][1]
    }
    const l = Math.hypot(x, y) || 1
    return [x / l, y / l]
  })
  out.length = total
  return out
}
/** The point `off` metres right of a sampled line at sample i. */
const right = (sm, i, off) => [sm.p[i][0] + sm.t[i][1] * off, sm.p[i][1] - sm.t[i][0] * off]
const heading = (a, b) => Math.atan2(b[1] - a[1], b[0] - a[0])
const turn = (h1, h2) => {
  let d = h2 - h1
  while (d > Math.PI) d -= 2 * Math.PI
  while (d < -Math.PI) d += 2 * Math.PI
  return d
}

// ---- lanes from tags --------------------------------------------------------------------------

const num = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v))
function laneWidth(tags) {
  const w = num(tags.width), n = num(tags.lanes)
  if (w && n && w / n > 2.5 && w / n < 4.5) return w / n
  const c = cls(tags.highway)
  return LANE[c] ?? LANE.minor
}
/** How wide a street OSM gives no lanes for is, kerb to kerb, two-way; and one-way. Metres. */
const PLAIN = { primary: 10, secondary: 9, tertiary: 8, unclassified: 6.5, residential: 6.5, living_street: 5, road: 6, service: 4, trunk: 10, primary_link: 7, secondary_link: 7, tertiary_link: 6.5, trunk_link: 7, motorway_link: 7 }
const PLAIN_ONEWAY = { primary: 7.5, secondary: 7, tertiary: 6.5, unclassified: 4.5, residential: 4.5, living_street: 4, service: 3.5, primary_link: 5, secondary_link: 5, tertiary_link: 5, trunk_link: 5, motorway_link: 5, trunk: 8 }
const parseTurns = (v) => (v ? v.split('|').map((l) => (l || 'none').split(';')) : null)

/** The two directions a way is driven in, or one: lanes, turn lanes and placement for each. */
function halvesOf(seg) {
  const t = seg.tags
  const roundabout = t.junction === 'roundabout' || t.junction === 'circular'
  let oneway = t.oneway === 'yes' || t.oneway === '1' || t.oneway === '-1' || roundabout || /^motorway(_link)?$/.test(t.highway)
  if (t.oneway === 'no') oneway = false
  const lanes = num(t.lanes)
  const both = num(t['lanes:both_ways']) ?? 0
  // Whether OSM says anything of its lanes: a road it does not is drawn plain, with no lines made up,
  // and as wide as such a street is (a yard road is not two 3 m lanes).
  const known = lanes != null || t['lanes:forward'] != null || t['lanes:backward'] != null || !!(t['turn:lanes'] ?? t['turn:lanes:forward'] ?? t['turn:lanes:backward'])
  const plainWidth = num(t.width) ?? PLAIN[t.highway] ?? 6
  const w = known ? laneWidth(t) : oneway ? Math.min(plainWidth, PLAIN_ONEWAY[t.highway] ?? 3.5) : plainWidth / 2
  const out = []
  if (oneway) {
    // No lane count but turn lanes: as many lanes as those.
    // Turn lanes say more than a lane count: where they count more lanes, they are right (the count was left behind when a lane was added).
    const turnCount = t['turn:lanes'] ? t['turn:lanes'].split('|').length : 0
    const n = Math.max(lanes ?? (turnCount || (t.highway === 'motorway' ? 2 : 1)), turnCount)
    const reverse = t.oneway === '-1'
    out.push({ dir: reverse ? -1 : 1, n: Math.max(1, n), w, turns: parseTurns(t['turn:lanes']), twoWay: false, centre: 0, placement: t.placement })
  } else {
    let f = num(t['lanes:forward']) ?? (lanes == null && t['turn:lanes:forward'] ? t['turn:lanes:forward'].split('|').length : null)
    let b = num(t['lanes:backward']) ?? (lanes == null && t['turn:lanes:backward'] ? t['turn:lanes:backward'].split('|').length : null)
    const total = lanes != null ? lanes - both : null
    if (f == null && b == null) f = b = total != null ? Math.max(1, Math.floor(total / 2)) : 1
    else if (f == null) f = Math.max(1, (total ?? b * 2) - b)
    else if (b == null) b = Math.max(1, (total ?? f * 2) - f)
    // Each direction to the right of the line, the shared turn lane (if any) between them.
    out.push({ dir: 1, n: f, w, turns: parseTurns(t['turn:lanes:forward'] ?? (t['turn:lanes'] && !b ? t['turn:lanes'] : null)), twoWay: true, centre: both ? w / 2 : 0, opposite: b })
    out.push({ dir: -1, n: b, w, turns: parseTurns(t['turn:lanes:backward']), twoWay: true, centre: both ? w / 2 : 0, opposite: f })
  }
  for (const h of out) {
    h.seg = seg
    h.tags = t
    h.known = known
    h.roundabout = roundabout
    h.pts = h.dir === 1 ? seg.pts : [...seg.pts].reverse()
    h.nodes = h.dir === 1 ? seg.nodes : [...seg.nodes].reverse()
    h.from = h.nodes[0]
    h.to = h.nodes[h.nodes.length - 1]
    h.sm = sample(h.pts)
    // Where the carriageway lies, before any lane change: its middle off the line, and its width.
    // Kerb to kerb: the lanes, and the gutters at the kerbs (half each side for a two-way road's half).
    h.width = h.n * h.w + (h.known ? (h.twoWay ? GUTTERS / 2 : GUTTERS) : 0)
    if (h.twoWay) h.mid = h.centre + h.width / 2
    else {
      h.mid = 0
      // placement=right_of:1 etc.: the line is at that lane's edge, not the carriageway's middle.
      const m = /^(left_of|right_of|middle_of):(\d+)$/.exec(h.placement ?? '')
      if (m) {
        const k = Number(m[2])
        const at = m[1] === 'left_of' ? (k - 1) * h.w : m[1] === 'right_of' ? k * h.w : (k - 0.5) * h.w
        h.mid = h.width / 2 - at
      }
    }
    h.hStart = heading(h.pts[0], h.pts[Math.min(1, h.pts.length - 1)])
    h.hEnd = heading(h.pts[h.pts.length - 2] ?? h.pts[0], h.pts[h.pts.length - 1])
    h.start = null // {left, width, anchor: -1|1} the carriageway must start with
    h.end = null
    h.trim0 = 0
    h.trim1 = 0
  }
  return out
}

/** Ways cut at every node another way shares, so each piece runs junction to junction. */
function split(ways) {
  const uses = new Map()
  for (const w of ways) for (const n of w.nodes) uses.set(n, (uses.get(n) ?? 0) + 1)
  const segs = []
  for (const w of ways) {
    let a = 0
    for (let i = 1; i < w.nodes.length; i++) {
      if (i === w.nodes.length - 1 || uses.get(w.nodes[i]) > 1) {
        segs.push({ id: `${w.id}:${a}`, tags: w.tags, nodes: w.nodes.slice(a, i + 1), pts: w.xy.slice(a, i + 1), lonlat: w.coords.slice(a, i + 1) })
        a = i
      }
    }
  }
  return segs
}

// ---- the rules at each node -----------------------------------------------------------------------

/** How many of a direction's lanes are only for turning left, counted from the left; and right, from the right. */
function turnOnly(turns) {
  if (!turns) return { left: 0, right: 0 }
  const isL = (d) => d.every((x) => /left|reverse/.test(x))
  const isR = (d) => d.every((x) => /right/.test(x))
  let left = 0, right = 0
  while (left < turns.length && isL(turns[left])) left++
  while (right < turns.length && isR(turns[turns.length - 1 - right])) right++
  return { left, right }
}

/** Left and right edge of a half where it meets a node, from its own lanes: [left, right], right positive. */
const edgesAt = (h) => [h.mid - h.width / 2, h.mid + h.width / 2]

function rules(halves, nodeTags) {
  const into = new Map(), outOf = new Map()
  for (const h of halves) {
    if (!into.has(h.to)) into.set(h.to, [])
    if (!outOf.has(h.from)) outOf.set(h.from, [])
    into.get(h.to).push(h)
    outOf.get(h.from).push(h)
  }
  const nodes = new Set([...into.keys(), ...outOf.keys()])
  const junctions = []
  const gores = []
  for (const node of nodes) {
    const ins = (into.get(node) ?? []).filter((h) => h.nodes.length > 1)
    const outs = (outOf.get(node) ?? []).filter((h) => h.nodes.length > 1)
    const segs = new Set([...ins, ...outs].map((h) => h.seg))
    if (segs.size < 2) continue
    // Which goes on from which: the least turn, and not back along itself.
    const pairs = []
    for (const a of ins) for (const b of outs) {
      if (a.seg === b.seg) continue
      const d = Math.abs(turn(a.hEnd, b.hStart))
      pairs.push({ a, b, d, name: (a.tags.name ?? a.tags.ref) === (b.tags.name ?? b.tags.ref) })
    }
    pairs.sort((p, q) => p.d - q.d + (q.name - p.name) * 0.2)
    const usedA = new Set(), usedB = new Set(), cont = []
    for (const p of pairs) {
      if (p.d > (35 * Math.PI) / 180 || usedA.has(p.a) || usedB.has(p.b)) continue
      usedA.add(p.a); usedB.add(p.b); cont.push(p)
    }
    const oneWayOnly = [...ins, ...outs].every((h) => !h.twoWay)
    const sharp = [...ins, ...outs].some((h) => !cont.some((p) => p.a === h || p.b === h))
    const ring = [...ins, ...outs].some((h) => h.roundabout)

    // A slip road leaving: one in, the main road on, the slip road off to its side at a small angle.
    if (oneWayOnly && ins.length === 1 && outs.length === 2 && !ring) {
      const a = ins[0]
      const [m, r] = outs.sort((p, q) => Math.abs(turn(a.hEnd, p.hStart)) - Math.abs(turn(a.hEnd, q.hStart)))
      if (Math.abs(turn(a.hEnd, r.hStart)) < (60 * Math.PI) / 180) {
        const side = turn(m.hStart, r.hStart) < 0 ? 1 : -1 // the slip road to the right of the main one: +1
        const [L, R] = edgesAt(a)
        const nm = Math.min(m.n, a.n), nr = Math.max(0, a.n - nm)
        // The lane that leaves with the slip road is kept apart by a block line before it goes.
        if (nr) a.block = { kLeft: side > 0 ? nm : nr, at: 'end' }
        if (side > 0) {
          m.start = { left: L, width: nm * m.w, anchor: -1 }
          r.start = { left: L + nm * a.w, width: (nr || r.n) * r.w, anchor: -1 }
        } else {
          m.start = { left: R - nm * m.w, width: nm * m.w, anchor: 1 }
          r.start = { left: R - nm * a.w - (nr || r.n) * r.w, width: (nr || r.n) * r.w, anchor: 1 }
        }
        gores.push({ kind: 'diverge', main: m, slip: r, side })
        continue
      }
    }
    // A slip road joining: the mirror of the above.
    if (oneWayOnly && ins.length === 2 && outs.length === 1 && !ring) {
      const b = outs[0]
      const [m, r] = ins.sort((p, q) => Math.abs(turn(p.hEnd, b.hStart)) - Math.abs(turn(q.hEnd, b.hStart)))
      if (Math.abs(turn(r.hEnd, b.hStart)) < (60 * Math.PI) / 180) {
        // A slip road joining from the right comes in turned left of the main road (anticlockwise): +1.
        const side = turn(m.hEnd, r.hEnd) > 0 ? 1 : -1
        const [L, R] = edgesAt(b)
        const nm = Math.min(m.n, b.n), nr = Math.max(0, b.n - nm)
        // The joining traffic's lane, beside the main road after the merge, behind a block line.
        b.block = { kLeft: side > 0 ? nm : nr || r.n, at: 'start' }
        if (side > 0) {
          m.end = { left: L, width: nm * m.w, anchor: -1 }
          r.end = { left: L + nm * b.w, width: (nr || r.n) * r.w, anchor: -1 }
          // No lane of its own after the merge: the joining traffic's lane opens beside the main road and closes on its right.
          if (!nr) b.start = { left: L, width: b.width + r.n * r.w, anchor: -1 }
        } else {
          m.end = { left: R - nm * m.w, width: nm * m.w, anchor: 1 }
          r.end = { left: R - nm * b.w - (nr || r.n) * r.w, width: (nr || r.n) * r.w, anchor: 1 }
          if (!nr) b.start = { left: L - r.n * r.w, width: b.width + r.n * r.w, anchor: 1 }
        }
        gores.push({ kind: 'merge', main: m, slip: r, side })
        continue
      }
    }
    // A road going on with more or fewer lanes: one edge straight, the lane opens or closes on the other.
    if (!sharp && cont.length && segs.size === 2) {
      for (const { a, b } of cont) {
        if (a.n === b.n || a.twoWay !== b.twoWay) continue
        const [La, Ra] = edgesAt(a)
        // Which side the change is on: the wider piece's turn lanes, else the right.
        const wide = b.n > a.n ? b : a
        const extra = Math.abs(b.n - a.n)
        const t = turnOnly(wide.turns)
        const side = a.twoWay ? 1 : t.left >= extra && t.right < extra ? -1 : 1
        const anchor = -side
        if (b.n > a.n) b.start = { left: anchor < 0 ? La : Ra - a.width, width: a.width, anchor }
        else {
          a.end = { left: anchor < 0 ? La : Ra - b.n * a.w, width: b.n * b.w, anchor }
          b.start = { left: anchor < 0 ? La : Ra - b.width, width: b.width, anchor }
        }
      }
      continue
    }
    if (segs.size === 2 && !sharp) continue
    // A junction: every road into it cut back to the edge of the widest crossing it, the middle paved.
    const ends = [...ins.map((h) => ({ h, at: 1 })), ...outs.map((h) => ({ h, at: 0 }))]
    const halfWidth = (h) => (h.twoWay ? h.centre + Math.max(h.width, h.opposite * h.w) : h.width / 2 + Math.abs(h.mid))
    for (const e of ends) {
      if (e.h.roundabout) continue
      let d = 0
      for (const o of ends) {
        if (o.h.seg === e.h.seg) continue
        const ang = Math.abs(Math.sin(turn(e.at ? e.h.hEnd : e.h.hStart, o.at ? o.h.hEnd : o.h.hStart)))
        if (ang < 0.25) continue
        d = Math.max(d, halfWidth(o.h) / Math.max(ang, 0.5) + 1.5)
      }
      d = Math.min(d, 30, e.h.sm.length * 0.45)
      if (e.at) e.h.trim1 = Math.max(e.h.trim1, d)
      else e.h.trim0 = Math.max(e.h.trim0, d)
    }
    junctions.push({ node, ends, cont, signals: nodeTags.get(node)?.highway === 'traffic_signals' })
  }
  return { junctions, gores }
}

// ---- the carriageway along a half ------------------------------------------------------------------

/** Left edge and width at every sample, honouring what the ends must meet. */
function profile(h) {
  const { sm } = h
  const L = h.tags.highway && MAJOR.test(h.tags.highway) ? TAPER.fast : /^(primary|secondary)/.test(h.tags.highway) ? TAPER.city : TAPER.minor
  const total = sm.length
  const taper = Math.min(L, total * 0.6)
  const settle = Math.min(SETTLE, total * 0.8)
  const base = { left: h.mid - h.width / 2, width: h.width }
  const left = [], width = []
  for (let i = 0; i < sm.p.length; i++) {
    const s = sm.s[i]
    let W = base.width, edgeS = null, edgeE = null
    if (h.start) W += (h.start.width - base.width) * (1 - smooth(s / taper))
    if (h.end) W += (h.end.width - base.width) * (1 - smooth((total - s) / taper))
    // The edge that is held: where the end says, settling back to the line's middle slowly.
    if (h.start) {
      const held = h.start.anchor < 0 ? h.start.left : h.start.left + h.start.width
      const own = h.start.anchor < 0 ? base.left : base.left + base.width
      edgeS = { anchor: h.start.anchor, at: own + (held - own) * (1 - smooth(s / settle)) }
    }
    if (h.end) {
      const held = h.end.anchor < 0 ? h.end.left : h.end.left + h.end.width
      const own = h.end.anchor < 0 ? base.left : base.left + base.width
      edgeE = { anchor: h.end.anchor, at: own + (held - own) * (1 - smooth((total - s) / settle)) }
    }
    const fromEdge = (e) => (e.anchor < 0 ? e.at : e.at - W)
    let l
    if (edgeS && edgeE) l = lerp(fromEdge(edgeS), fromEdge(edgeE), smooth(s / total))
    else if (edgeS) l = fromEdge(edgeS)
    else if (edgeE) l = fromEdge(edgeE)
    else l = base.left
    left.push(l)
    width.push(W)
  }
  h.left = left
  h.W = width
  h.anchorSide = h.start?.anchor ?? h.end?.anchor ?? -1
}

// ---- output ----------------------------------------------------------------------------------------

function polyline(sm, i0, i1, off) {
  const pts = []
  for (let i = i0; i <= i1; i++) pts.push(right(sm, i, typeof off === 'function' ? off(i) : off))
  return pts
}
const idxAt = (sm, s) => {
  let i = 0
  while (i < sm.s.length - 1 && sm.s[i] < s) i++
  return i
}

export function buildRoads(ways, nodeTagsList, bbox) {
  const P = projector(bbox)
  for (const w of ways) w.xy = w.coords.map(P.to)
  const nodeTags = new Map(nodeTagsList.map((n) => [n.node, n.tags]))
  const roads = ways.filter((w) => w.tags.highway && w.tags.highway !== 'busway' && !w.tags['area:highway'] && w.tags.area !== 'yes' && w.tags.service !== 'parking_aisle' && w.tags.service !== 'driveway')
  const segs = split(roads)
  const halves = segs.flatMap(halvesOf)
  const { junctions, gores } = rules(halves, nodeTags)
  for (const h of halves) profile(h)
  // The islands and hatched areas mappers drew are drawn where they are on the ground: a
  // carriageway beside one takes its edge from it rather than from its lanes' width.
  const areas = ways.filter((w) => (w.tags['area:highway'] === 'traffic_island' || w.tags['area:highway'] === 'prohibited' || w.tags.traffic_calming === 'island') && w.nodes[0] === w.nodes[w.nodes.length - 1])
  fitToAreas(halves, areas.map((w) => w.xy))

  const F = []
  const feat = (kind, geom, props = {}) => F.push({ type: 'Feature', properties: { kind, ...props }, geometry: geom })
  const line = (pts) => ({ type: 'LineString', coordinates: pts.map(P.from) })
  const poly = (ring) => ({ type: 'Polygon', coordinates: [[...ring, ring[0]].map(P.from)] })
  // Its level: above ground on a bridge, below in a tunnel (or an underpass), else on the ground.
  const level = (h) => Number(h.tags.layer ?? (h.tags.bridge && h.tags.bridge !== 'no' ? 1 : h.tags.tunnel && h.tags.tunnel !== 'no' ? -1 : 0)) || 0

  // Every carriageway's outline first, so paint that would fall on another one (where OSM draws one
  // street as several ways side by side) is left out instead of crossing it.
  const GRID = 60
  const cells = new Map()
  const cellKey = (x, y) => `${Math.floor(x / GRID)},${Math.floor(y / GRID)}`
  for (const h of halves) {
    const i0 = idxAt(h.sm, h.trim0), i1 = idxAt(h.sm, h.sm.length - h.trim1)
    if (i1 - i0 < 1) continue
    const ring = [...polyline(h.sm, i0, i1, (i) => h.left[i]), ...polyline(h.sm, i0, i1, (i) => h.left[i] + h.W[i]).reverse()]
    // A sliver left between two junctions close together (under 2 m²) is covered by them: not drawn.
    let area = 0
    for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) area += (ring[b][0] + ring[a][0]) * (ring[b][1] - ring[a][1])
    if (Math.abs(area / 2) < 2) continue
    h.ring = ring
    const xs = h.ring.map((p) => p[0]), ys = h.ring.map((p) => p[1])
    h.box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
    for (let gx = Math.floor(h.box[0] / GRID); gx <= Math.floor(h.box[2] / GRID); gx++) {
      for (let gy = Math.floor(h.box[1] / GRID); gy <= Math.floor(h.box[3] / GRID); gy++) {
        const k = `${gx},${gy}`
        if (!cells.has(k)) cells.set(k, [])
        cells.get(k).push(h)
      }
    }
  }
  const covered = (p, h) => {
    for (const o of cells.get(cellKey(p[0], p[1])) ?? []) {
      if (o.seg === h.seg || level(o) !== level(h)) continue
      if (p[0] < o.box[0] || p[0] > o.box[2] || p[1] < o.box[1] || p[1] > o.box[3]) continue
      if (inRing(p, o.ring)) return true
    }
    return false
  }

  for (const h of halves) {
    const { sm } = h
    if (!h.ring) continue
    const i0 = idxAt(sm, h.trim0), i1 = idxAt(sm, sm.length - h.trim1)
    const lv = level(h)
    const major = MAJOR.test(h.tags.highway)
    // The asphalt.
    feat('carriageway', poly(h.ring), { layer: lv, highway: h.tags.highway })
    // The pavement beside it, where OSM says the road has one on that side: 2 m wide, at the kerb.
    // A bridge's parapets: along its outer edges, beyond its pavements (not down the middle of a two-way bridge).
    if (lv > 0) {
      for (const side of h.twoWay ? ['right'] : ['right', 'left']) {
        const walk = sidewalkOn(h, side) ? 2 : 0
        feat('parapet', line(polyline(sm, i0, i1, (i) => (side === 'right' ? h.left[i] + h.W[i] + walk : h.left[i] - walk))), { layer: lv })
      }
    }
    // (A one-way road's left kerb is its own too; a two-way road's is the middle of the road.)
    for (const side of h.twoWay ? ['right'] : ['right', 'left']) {
      if (lv < 0 || !sidewalkOn(h, side)) continue
      const at = (i) => (side === 'right' ? h.left[i] + h.W[i] : h.left[i])
      const away = side === 'right' ? 2 : -2
      const kerb = polyline(sm, i0, i1, at)
      const out = polyline(sm, i0, i1, (i) => at(i) + away)
      feat('sidewalk', poly([...kerb, ...out.reverse()]), { layer: lv })
    }
    // Lane lines, measured from the held edge so the lane that opens or closes is the one that narrows.
    const nMax = Math.max(h.n, Math.round(Math.max(...h.W.slice(i0, i1 + 1)) / h.w))
    const signals = junctions.some((j) => j.node === h.to && j.signals)
    const solidFrom = h.trim1 > 0 && (h.turns || signals) ? sm.length - h.trim1 - 25 : Infinity
    // Where a lane that leaves or joins with a slip road runs beside the others: behind a block line.
    const blockSpan = h.block ? (h.block.at === 'end' ? [sm.length - 150, Infinity] : [-Infinity, 150]) : null
    for (let k = 1; h.known && k < nMax; k++) {
      const kLeft = h.anchorSide < 0 ? k : nMax - k
      const off = (i) => (h.anchorSide < 0 ? h.left[i] + k * h.w : h.left[i] + h.W[i] - k * h.w)
      const inside = (i) => off(i) > h.left[i] + 0.4 && off(i) < h.left[i] + h.W[i] - 0.4 && !covered(right(sm, i, off(i)), h)
      const dashAt = (s) => (blockSpan && h.block.kLeft === kLeft && s >= blockSpan[0] && s <= blockSpan[1] ? 'block' : s >= solidFrom ? 'solid' : major ? 'long' : 'short')
      let run = []
      const flush = () => {
        if (run.length > 1) feat('lane-line', line(run.map((i) => right(sm, i, off(i)))), { layer: lv, dash: dashAt(sm.s[run[0]]) })
        run = []
      }
      for (let i = i0; i <= i1; i++) {
        if (!inside(i) || (run.length && dashAt(sm.s[run[0]]) !== dashAt(sm.s[i]))) flush()
        if (inside(i)) run.push(i)
      }
      flush()
    }
    // The line between the two directions of a two-way road, on its forward half only.
    if (h.known && h.twoWay && h.dir === 1 && h.opposite) {
      const n = h.n + h.opposite
      feat('centre-line', line(polyline(sm, i0, i1, h.centre ? 0 : 0)), { layer: lv, dash: n >= 4 ? 'double' : 'short' })
    }
    // Edge lines on motorways, their slip roads and bridges.
    if (major || lv > 0) {
      feat('edge-line', line(polyline(sm, i0, i1, (i) => h.left[i] + 0.35)), { layer: lv })
      feat('edge-line', line(polyline(sm, i0, i1, (i) => h.left[i] + h.W[i] - 0.35)), { layer: lv })
    }
    // Turn arrows in every lane before a junction, 18 m out and again further back where there is room;
    // never where a lane is already narrowing away (an arrow saying a lane ends goes before it does).
    if (h.turns && h.turns.length === h.n && sm.length > 40) {
      const full = h.n * h.w * 0.97
      const placed = []
      for (const back of [18, 55]) {
        let s = sm.length - h.trim1 - back
        while (s > h.trim0 + 6 && h.W[idxAt(sm, s)] < full) s -= 4
        if (s <= h.trim0 + 6 || placed.some((p) => Math.abs(p - s) < 25)) continue
        placed.push(s)
        const i = idxAt(sm, s)
        h.turns.forEach((dirs, k) => {
          const off = h.left[i] + (k + 0.5) * (h.W[i] / h.n)
          const [x, y] = right(sm, i, off)
          // bearing: degrees clockwise from north, as the map turns an icon.
          feat('arrow', { type: 'Point', coordinates: P.from([x, y]) }, { layer: lv, icon: arrowIcon(dirs), bearing: Math.round(90 - (Math.atan2(sm.t[i][1], sm.t[i][0]) * 180) / Math.PI) })
        })
      }
    }
    // A stop line where the piece meets signals (they are painted on Baltic roads).
    if (h.known && h.trim1 > 0 && signals) {
      const i = idxAt(sm, sm.length - h.trim1 - 1)
      feat('stop-line', line([right(sm, i, h.left[i]), right(sm, i, h.left[i] + h.W[i])]), { layer: lv })
    }
    // Zebras where a crossing is mapped on the way.
    if (h.dir === 1 || !h.twoWay) {
      h.nodes.forEach((n, k) => {
        if (nodeTags.get(n)?.highway !== 'crossing' || nodeTags.get(n)?.crossing === 'unmarked') return
        const s = sample(h.pts.slice(0, k + 1)).length
        if (s < h.trim0 + 2 || s > sm.length - h.trim1 - 2) return
        const i = idxAt(sm, s)
        const a = h.twoWay ? -(h.opposite * h.w + h.centre) : h.left[i]
        const b = h.left[i] + h.W[i]
        // A zebra: 0.5 m stripes along the road, 0.5 m apart, 4 m long.
        const i0z = Math.max(0, i - 1), i1z = Math.min(sm.p.length - 1, i + 1)
        for (let o = a + 0.25; o + 0.5 <= b - 0.25; o += 1) feat('zebra', poly([right(sm, i0z, o), right(sm, i0z, o + 0.5), right(sm, i1z, o + 0.5), right(sm, i1z, o)]), { layer: lv })
      })
    }
  }

  // Junctions, paved across: the corners of every road's cut end, wrapped.
  for (const j of junctions) {
    // Each road's cut end seen from the junction: which way it leaves, and its two kerb corners.
    const groups = new Map()
    let C = null
    for (const { h, at } of j.ends) {
      if (!h.ring) continue
      const { sm } = h
      const i = at ? idxAt(sm, sm.length - h.trim1) : idxAt(sm, h.trim0)
      C ??= at ? h.pts[h.pts.length - 1] : h.pts[0]
      const g = groups.get(h.seg) ?? { pts: [], d: [0, 0] }
      g.pts.push(right(sm, i, h.left[i]), right(sm, i, h.left[i] + h.W[i]))
      g.d = [g.d[0] + (at ? -sm.t[i][0] : sm.t[i][0]), g.d[1] + (at ? -sm.t[i][1] : sm.t[i][1])]
      groups.set(h.seg, g)
    }
    if (!C || groups.size < 2) continue
    const arms = [...groups.values()].map((g) => {
      const l = Math.hypot(g.d[0], g.d[1]) || 1
      const d = [g.d[0] / l, g.d[1] / l], n = [-d[1], d[0]]
      const side = (p) => (p[0] - C[0]) * n[0] + (p[1] - C[1]) * n[1]
      const byside = [...g.pts].sort((p, q) => side(p) - side(q))
      return { d, right: byside[0], left: byside[byside.length - 1], ang: Math.atan2(d[1], d[0]) }
    }).sort((a, b) => a.ang - b.ang)
    // Round the kerb from one road to the next, as a junction's corners are built.
    const ring = []
    arms.forEach((a, k) => {
      const b = arms[(k + 1) % arms.length]
      ring.push(a.right, a.left)
      const den = a.d[0] * b.d[1] - a.d[1] * b.d[0]
      let Q = [(a.left[0] + b.right[0] + 2 * C[0]) / 4, (a.left[1] + b.right[1] + 2 * C[1]) / 4]
      if (Math.abs(den) > 0.15) {
        const t = ((b.right[0] - a.left[0]) * b.d[1] - (b.right[1] - a.left[1]) * b.d[0]) / den
        if (Math.abs(t) < 40) Q = [a.left[0] + a.d[0] * t, a.left[1] + a.d[1] * t]
      }
      for (let s = 1; s < 8; s++) {
        const u = s / 8
        ring.push([(1 - u) ** 2 * a.left[0] + 2 * (1 - u) * u * Q[0] + u * u * b.right[0], (1 - u) ** 2 * a.left[1] + 2 * (1 - u) * u * Q[1] + u * u * b.right[1]])
      }
    })
    feat('junction', poly(ring), { layer: 0 })
    // Dotted guides carrying the lanes of a road straight across the junction to where it goes on.
    for (const { a, b } of j.cont ?? []) {
      if (!a.known || !b.known || a.trim1 <= 0 || b.trim0 <= 0) continue
      const ia = idxAt(a.sm, a.sm.length - a.trim1), ib = idxAt(b.sm, b.trim0)
      for (let k = 1; k < Math.min(a.n, b.n); k++) {
        feat('guide', line([right(a.sm, ia, a.left[ia] + k * a.w), right(b.sm, ib, b.left[ib] + k * b.w)]), { layer: 0 })
      }
    }
  }

  // Gores: the wedge between a slip road and the main road, from where they part until they are 6 m
  // apart; none where mappers drew the islands or hatching there themselves.
  const areaBoxes = areas.map((w) => {
    const xs = w.xy.map((p) => p[0]), ys = w.xy.map((p) => p[1])
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
  })
  for (const g of gores) {
    const { main, slip, side, kind } = g
    const mi = (s) => idxAt(main.sm, kind === 'diverge' ? s : main.sm.length - s)
    const si = (s) => idxAt(slip.sm, kind === 'diverge' ? s : slip.sm.length - s)
    const mEdge = (s) => { const i = mi(s); return right(main.sm, i, side > 0 ? main.left[i] + main.W[i] : main.left[i]) }
    const sEdge = (s) => { const i = si(s); return right(slip.sm, i, side > 0 ? slip.left[i] : slip.left[i] + slip.W[i]) }
    const A = [], B = []
    for (let s = 0; s < Math.min(main.sm.length, slip.sm.length, 220); s += STEP) {
      const gap = len(sub(mEdge(s), sEdge(s)))
      // Until they part, the two lie side by side (or over each other): no wedge yet.
      if (gap < 0.3 && !A.length) continue
      A.push(mEdge(s))
      B.push(sEdge(s))
      if (gap > 6) break
    }
    if (A.length < 4) continue
    const pts = [...A, ...B]
    const box = [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))]
    // Where mappers drew the hatching or island here, theirs is the shape: the wedge is only paved, so no gap shows round theirs.
    const paved = areaBoxes.some((b) => b[0] < box[2] && b[2] > box[0] && b[1] < box[3] && b[3] > box[1])
    feat('gore', poly([...A, ...B.reverse()]), { layer: 0, side, how: kind, paved })
  }

  // The islands and hatched areas mappers drew.
  for (const w of ways) {
    const t = w.tags
    const isl = t['area:highway'] === 'traffic_island' || t.traffic_calming === 'island'
    const hatch = t['area:highway'] === 'prohibited'
    if ((!isl && !hatch) || w.nodes[0] !== w.nodes[w.nodes.length - 1]) continue
    feat(hatch ? 'hatch' : 'island', { type: 'Polygon', coordinates: [w.coords] }, { grass: t.surface === 'grass' || t.landuse === 'grass' })
  }
  return { type: 'FeatureCollection', features: F }
}

/**
 * Moves a carriageway's outer edges to the islands and hatched areas drawn beside it: from each
 * point of its line, across to either side, the nearest edge of such an area within reach (a few
 * metres past where its lanes put the edge, or inside it) becomes the edge there. The shared middle
 * of a two-way road stays. Smoothed, so an edge follows an island's kerb without stepping.
 */
function fitToAreas(halves, rings) {
  if (!rings.length) return
  const GRID = 30
  const cells = new Map()
  for (const ring of rings) {
    for (let i = 0; i < ring.length - 1; i++) {
      const a = ring[i], b = ring[i + 1]
      for (let gx = Math.floor(Math.min(a[0], b[0]) / GRID); gx <= Math.floor(Math.max(a[0], b[0]) / GRID); gx++) {
        for (let gy = Math.floor(Math.min(a[1], b[1]) / GRID); gy <= Math.floor(Math.max(a[1], b[1]) / GRID); gy++) {
          const k = `${gx},${gy}`
          if (!cells.has(k)) cells.set(k, [])
          cells.get(k).push([a, b])
        }
      }
    }
  }
  /** How far along the ray from p in direction d the nearest area edge is, up to `max`; null if none. */
  const hit = (p, d, max) => {
    let best = null
    const seen = new Set()
    for (let t = 0; t <= max + GRID; t += GRID / 2) {
      const k = `${Math.floor((p[0] + d[0] * Math.min(t, max)) / GRID)},${Math.floor((p[1] + d[1] * Math.min(t, max)) / GRID)}`
      if (seen.has(k)) continue
      seen.add(k)
      for (const [a, b] of cells.get(k) ?? []) {
        const e = sub(b, a), den = d[0] * e[1] - d[1] * e[0]
        if (Math.abs(den) < 1e-9) continue
        const w = sub(a, p)
        const s = (w[0] * e[1] - w[1] * e[0]) / den
        const u = (w[0] * d[1] - w[1] * d[0]) / den
        if (s > 0.2 && s <= max && u >= 0 && u <= 1 && (best === null || s < best)) best = s
      }
    }
    return best
  }
  for (const h of halves) {
    const { sm } = h
    const n = sm.p.length
    const L = [...h.left], R = h.left.map((l, i) => l + h.W[i])
    const fitL = new Array(n).fill(null), fitR = new Array(n).fill(null)
    for (let i = 0; i < n; i++) {
      const t = sm.t[i], rightDir = [t[1], -t[0]], leftDir = [-t[1], t[0]]
      // The right edge, out to 4 m past it; inside, not past the lanes' middle.
      if (R[i] > 0) {
        const d = hit(sm.p[i], rightDir, R[i] + 4)
        if (d !== null && d > Math.max(R[i] - h.w * 0.9, 1.5)) fitR[i] = d
      }
      if (!h.twoWay && L[i] < 0) {
        const d = hit(sm.p[i], leftDir, -L[i] + 4)
        if (d !== null && d > Math.max(-L[i] - h.w * 0.9, 1.5)) fitL[i] = -d
      }
    }
    // Smoothed over 5 samples (10 m) of those that found an area; elsewhere as the lanes say.
    const smooth5 = (fit, base) => base.map((v, i) => {
      let sum = 0, k = 0
      for (let j = Math.max(0, i - 2); j <= Math.min(n - 1, i + 2); j++) {
        if (fit[j] === null) continue
        sum += fit[j]
        k++
      }
      return fit[i] !== null && k ? sum / k : v
    })
    const L2 = smooth5(fitL, L), R2 = smooth5(fitR, R)
    h.left = L2
    h.W = R2.map((r, i) => Math.max(r - L2[i], 1))
  }
}

/**
 * Whether a carriageway has a pavement on this side of it (as it is driven), by the way's sidewalk
 * tags: sidewalk=both, left, right or separate (a pavement mapped as its own way runs beside the
 * road all the same), or sidewalk:left/right/both=yes|separate. Driven against the way's direction,
 * its right is the way's left.
 */
function sidewalkOn(h, side) {
  const t = h.tags
  const has = (side) => {
    const v = t[`sidewalk:${side}`] ?? t['sidewalk:both']
    if (v) return v === 'yes' || v === 'separate'
    return t.sidewalk === 'both' || t.sidewalk === 'separate' || t.sidewalk === side
  }
  return has((h.dir === 1) === (side === 'right') ? 'right' : 'left')
}

/** The arrow a lane's turn:lanes value paints, by name: arrow-left+through, arrow-right… */
const TURN_NAMES = { left: 'left', sharp_left: 'left', slight_left: 'slight_left', through: 'through', right: 'right', sharp_right: 'right', slight_right: 'slight_right', reverse: 'reverse', merge_to_left: 'slight_left', merge_to_right: 'slight_right' }
export function arrowIcon(dirs) {
  const names = [...new Set(dirs.map((d) => TURN_NAMES[d] ?? 'through'))].sort()
  return `arrow-${names.join('+')}`
}

function inRing([x, y], ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

