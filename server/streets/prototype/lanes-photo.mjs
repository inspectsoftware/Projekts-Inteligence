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
function sample(pts, win = 2) {
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
    for (let j = Math.max(0, i - win); j <= Math.min(out.t.length - 1, i + win); j++) {
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
  // A trunk road through a city is built to city widths: GeoRīga's 1 cm photo of Satekles iela (trunk,
  // 3 lanes each way, 50 km/h) measures 10.8-11.0 m kerb to kerb a carriageway, 3.5 m lanes, not 3.75.
  if ((c === 'trunk' || c === 'motorway') && isTown(tags)) return LANE.primary
  return LANE[c] ?? LANE.minor
}
/** Driven at town speeds: a speed limit of 60 or less (or a living street, a zone). */
function isTown(tags) {
  const v = num(String(tags.maxspeed ?? '').replace(/[^0-9.]/g, ''))
  return (v != null && v <= 60) || /^(LV|LT|EE):(urban|zone)/.test(tags.maxspeed ?? '') || tags.highway === 'living_street'
}

// Paint as measured on the GeoRīga 2022 orthophoto (1 cm/px) of Satekles / Marijas / Elizabetes iela:
//  - a lane line in town is 2.1-2.2 m of paint, 6 m apart (period 8.1 m);
//  - on the approach to signals it becomes a warning line, 6.0 m of paint, 2.0 m gaps, then solid to the stop line;
//  - the stop line stands at the signal (OSM maps highway=traffic_signals where traffic stops), 3 m before the zebra;
//  - zebras: 0.5 m stripes 0.5 m apart, the crossing 6-8 m wide across a six-lane street, 4.5-5 m across three lanes.
const DASH_TOWN = [2.1, 6]
const DASH_WARN = [6, 2]
const WARN_LEN = 40
const SOLID_LEN = 20
const ZEBRA_GAP = 3
const zebraWidth = (lanesAcross) => (lanesAcross >= 4 ? 6 : lanesAcross >= 3 ? 5 : 4)
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
    // A wide carriageway round a sharp kink in its line: the tangent smoothed over as much as it is
    // wide, so its far lane lines bend round as kerbs do instead of folding over themselves (the
    // 4-lane Marijas iela piece at Stacijas laukums, 14.5 m wide, kinks 40 degrees in 10 m).
    const reach = h.twoWay ? h.width + h.centre : h.width / 2
    if (reach > 5) h.sm = sample(h.pts, Math.min(8, Math.round(reach / 2.5)))
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

/** How big a road is, for which one runs on through a junction: motorway 7 down to a yard road 1. */
const RANK = { motorway: 7, trunk: 6, primary: 5, secondary: 4, tertiary: 3, unclassified: 2, residential: 2, road: 2, living_street: 1, service: 1, track: 1 }
const rankOf = (h) => RANK[String(h.tags.highway).replace(/_link$/, '')] - (/_link$/.test(h.tags.highway) ? 3 : 0) || 1

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
        const nm = Math.min(m.auxStart ? m.n - 1 : m.n, a.n), nr = Math.max(0, a.n - nm)
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
        const nm = Math.min(m.auxEnd ? m.n - 1 : m.n, b.n), nr = Math.max(0, b.n - nm)
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
    // A side road or a yard entrance meeting a bigger road without signals does not cut it: the bigger
    // road's kerbs and lane lines run on past the mouth (the LĢIA photos: Marijas iela past the service
    // roads at Stacijas laukums, Brīvības past every side street), only the side road stops at its kerb.
    const signalled = nodeTags.get(node)?.highway === 'traffic_signals'
    const top = Math.max(...ends.map((e) => rankOf(e.h)))
    const through = new Set(cont.filter((p) => rankOf(p.a) === top && rankOf(p.b) === top).flatMap((p) => [p.a, p.b]))
    const sideTop = Math.max(0, ...ends.filter((e) => !through.has(e.h)).map((e) => rankOf(e.h)))
    const runsOn = !signalled && through.size && sideTop < top && sideTop <= 2
    for (const e of ends) {
      if (e.h.roundabout || (runsOn && through.has(e.h))) continue
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

/**
 * Auxiliary lanes. Where a slip road joins a one-way carriageway and another leaves it on the same side
 * within 450 m, the joining lane runs on to the exit as a lane of its own behind a block line (the weaving
 * lane of a cloverleaf, the lane between two ramps in town): OSM usually leaves it out (Jūrkalnes iela
 * over the A10 is tagged lanes=1, the LĢIA photo shows two lanes and a block line between the loop ramps).
 * Where a photo covers the ground, the lane is added only if the photo shows asphalt where it would lie.
 */
const DRIVEN = /^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|road|living_street|service)(_link)?$/
function auxLanes(halves, colourAt) {
  const into = new Map(), outOf = new Map()
  for (const h of halves) {
    if (!DRIVEN.test(h.tags.highway) || h.nodes.length < 2) continue
    if (!into.has(h.to)) into.set(h.to, [])
    if (!outOf.has(h.from)) outOf.set(h.from, [])
    into.get(h.to).push(h)
    outOf.get(h.from).push(h)
  }
  const at = (node) => ({ ins: into.get(node) ?? [], outs: outOf.get(node) ?? [] })
  const SMALL = (60 * Math.PI) / 180
  const isLink = (h) => /_link$/.test(h.tags.highway)
  const oneway = (hs) => hs.every((h) => !h.twoWay && !h.roundabout)
  /** At a node: a slip road joining the carriageway h ends in, from which side; or null. */
  const mergeAt = (h) => {
    const { ins, outs } = at(h.to)
    if (ins.length !== 2 || outs.length !== 1 || !ins.includes(h) || !oneway([...ins, ...outs])) return null
    const b = outs[0], r = ins.find((x) => x !== h)
    if (!isLink(r) || isLink(h) || Math.abs(turn(r.hEnd, b.hStart)) > SMALL || Math.abs(turn(h.hEnd, b.hStart)) > Math.abs(turn(r.hEnd, b.hStart))) return null
    return { b, side: turn(h.hEnd, r.hEnd) > 0 ? 1 : -1 }
  }
  /** At a node: a slip road leaving the carriageway h ends in, to which side; or null. */
  const divergeAt = (h) => {
    const { ins, outs } = at(h.to)
    if (ins.length !== 1 || ins[0] !== h || outs.length !== 2 || !oneway(outs)) return null
    const [m, r] = [...outs].sort((p, q) => Math.abs(turn(h.hEnd, p.hStart)) - Math.abs(turn(h.hEnd, q.hStart)))
    if (!isLink(r) || isLink(m) || Math.abs(turn(h.hEnd, r.hStart)) > SMALL) return null
    return { m, side: turn(m.hStart, r.hStart) < 0 ? 1 : -1 }
  }
  for (const h0 of halves) {
    if (!into.has(h0.to)) continue
    // Where a slip road joins or leaves: the carriageway on from there.
    const mg = mergeAt(h0), dv = mg ? null : divergeAt(h0)
    const first = mg ? mg.b : dv?.m
    if (!first || first.twoWay || first.turns || first.aux) continue
    // A slip road joining whose lane OSM already carries on: nothing to add.
    if (mg && mg.b.n > h0.n) continue
    const side = (mg ?? dv).side
    const chain = [first]
    let dist = first.sm.length, end = null
    for (let h = first; dist < 450; ) {
      const m2 = mergeAt(h), d2 = m2 ? null : divergeAt(h)
      if (m2 || d2) {
        if ((m2 ?? d2).side === side && !(d2 && d2.m.n < h.n)) end = m2 ? 'merge' : 'diverge'
        break
      }
      const nx = at(h.to)
      if (nx.ins.length !== 1 || nx.outs.length !== 1 || nx.outs[0].twoWay || nx.outs[0].n !== h.n || nx.outs[0].turns || Math.abs(turn(h.hEnd, nx.outs[0].hStart)) > 0.5) break
      h = nx.outs[0]
      chain.push(h)
      dist += h.sm.length
    }
    if (globalThis.process?.env?.AUX_DEBUG && /^1184144|^1540808/.test(first.seg.id)) console.error('aux end', first.seg.id, side, end, chain.length, Math.round(dist))
    if (!end || dist > 450) continue
    // A slip road joining, then one leaving: the weaving lane, built so as a rule. One leaving, then one
    // joining close after: the carriageway kept a lane wider between them only where the photo shows it.
    const weave = mg && end === 'diverge'
    if (!weave && (!colourAt || dist > 250)) continue
    const w = first.w
    // The photo: the asphalt across the carriageway as wide as its lanes and one more (the OSM line need
    // not lie in the middle of the through lane: on Jūrkalnes iela it runs along the block line).
    if (colourAt) {
      let n = 0, yes = 0
      for (const h of chain) {
        for (let i = 2; i < h.sm.p.length - 2; i += 3) {
          const t = h.sm.t[i]
          const cell = (o) => {
            const cs = [-2, 0, 2].map((a) => colourAt([h.sm.p[i][0] + t[0] * a + t[1] * o, h.sm.p[i][1] + t[1] * a - t[0] * o])).filter(Boolean)
            return cs.length >= 2 ? median3(cs) : null
          }
          const mid = []
          for (let o = -1; o <= 1; o += 0.5) if (cell(o)) mid.push(cell(o))
          if (mid.length < 3) continue
          const ref = median3(mid)
          if (satOf(ref) > 30) continue
          const road = (c) => c && (colourDist(c, ref) < 26 || (lumOf(c) > lumOf(ref) + 35 && satOf(c) < 35) || (lumOf(c) < lumOf(ref) * 0.72 && satOf(c) < 30))
          const reach = (dir) => {
            let bad = 0, o = 0
            for (; o <= (h.n + 2) * w; o += 0.25) {
              if (road(cell(dir * o))) bad = 0
              else if (++bad >= 4) return o - 1
            }
            return o
          }
          n++
          if (reach(1) + reach(-1) >= (h.n + 0.75) * w) yes++
        }
      }
      if (globalThis.process?.env?.AUX_DEBUG) console.error('aux?', first.seg.id, side, n, yes, Math.round(dist))
      if (n < 6 ? !weave : yes < n * 0.55) continue
    }
    for (const h of chain) {
      h.n += 1
      h.width += h.w
      h.mid += (side * h.w) / 2
      h.aux = { kLeft: side > 0 ? h.n - 1 : 1 }
      // Opened behind the gore of the slip road that left, closed in the gore of the one that joins.
      if (h === chain[0] && dv) h.auxStart = true
      if (h === chain[chain.length - 1] && end === 'merge') h.auxEnd = true
      if (globalThis.process?.env?.AUX_DEBUG) console.error('aux', h.seg.id, h.tags.name, side, weave, Math.round(dist))
    }
  }
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
  const photo = PHOTOS.get(bboxKey(bbox))
  // What the photo pass gets: the paved rings (local metres) and the areas drawn, to judge on the photo.
  const pavedRings = [], judged = [], junctionItems = []
  for (const w of ways) w.xy = w.coords.map(P.to)
  const nodeTags = new Map(nodeTagsList.map((n) => [n.node, n.tags]))
  const roads = ways.filter((w) => w.tags.highway && w.tags.highway !== 'busway' && !w.tags['area:highway'] && w.tags.area !== 'yes' && w.tags.service !== 'parking_aisle' && w.tags.service !== 'driveway')
  const segs = split(roads)
  const halves = segs.flatMap(halvesOf)
  auxLanes(halves, photo ? (p) => photo.rgb(...P.from(p)) : null)
  const { junctions, gores } = rules(halves, nodeTags)
  for (const h of halves) profile(h)
  // The islands and hatched areas mappers drew are drawn where they are on the ground: a
  // carriageway beside one takes its edge from it rather than from its lanes' width.
  const areas = ways.filter((w) => (w.tags['area:highway'] === 'traffic_island' || w.tags['area:highway'] === 'prohibited' || w.tags.traffic_calming === 'island') && w.nodes[0] === w.nodes[w.nodes.length - 1])
  const dbgL = (tag) => { for (const h of halves) if (globalThis.process?.env?.LANE_DEBUG && h.seg.id.startsWith(process.env.LANE_DEBUG)) console.error(tag, h.seg.id, h.dir, 'n', h.n, 'mid', h.mid.toFixed(1), 'width', h.width.toFixed(1), 'start', JSON.stringify(h.start), 'end', JSON.stringify(h.end), 'trim', h.trim0.toFixed(1), h.trim1.toFixed(1), 'len', h.sm.length.toFixed(0), 'L', h.left.filter((_, i) => i % 5 === 0).map((v) => v.toFixed(1)).join(' '), 'W', h.W.filter((_, i) => i % 5 === 0).map((v) => v.toFixed(1)).join(' ')) }
  dbgL('rules')
  if (photo) fitToPhoto(halves, (p) => photo.rgb(...P.from(p)))
  dbgL('photo')
  fitToAreas(halves, areas.map((w) => w.xy))
  smoothEdges(halves)
  dbgL('fit')

  const F = []
  let curId = null
  const feat = (kind, geom, props = {}) => F.push({ type: 'Feature', properties: { kind, ...(curId && globalThis.process?.env?.LANE_IDS ? { id: curId } : {}), ...props }, geometry: geom })
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
    curId = h.seg.id + (h.dir > 0 ? '+' : '-')
    const i0 = idxAt(sm, h.trim0), i1 = idxAt(sm, sm.length - h.trim1)
    const lv = level(h)
    const major = MAJOR.test(h.tags.highway)
    // The asphalt.
    feat('carriageway', poly(h.ring), { layer: lv, highway: h.tags.highway, id: h.seg.id, n: h.n })
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
    // Where traffic stops and where people cross, along this half: zebras at marked crossings, stop
    // lines at the signals. OSM maps highway=traffic_signals where traffic stops (GeoRīga shows the
    // stop line within 1-3 m of it), so the stop line goes there; a signalled crossing with no signal
    // node before it gets one 3 m before its zebra, and a stop line never stands on a zebra.
    const signals = junctions.some((j) => j.node === h.to && j.signals)
    const town = isTown(h.tags) || (!major && h.tags.maxspeed == null)
    const cum = [0]
    for (let k = 1; k < h.pts.length; k++) cum.push(cum[k - 1] + len(sub(h.pts[k], h.pts[k - 1])))
    const zw = zebraWidth(/^(trunk|primary)/.test(h.tags.highway) ? h.n + (h.twoWay ? h.opposite : 1) : h.n + (h.twoWay ? h.opposite : 0))
    const zebras = [], stops = []
    h.nodes.forEach((n, k) => {
      const tg = nodeTags.get(n)
      if (!tg || k === 0 || k === h.nodes.length - 1) return
      const s = cum[k]
      if (tg.highway === 'crossing' && tg.crossing !== 'unmarked' && tg.crossing !== 'no' && tg['crossing:markings'] !== 'no') {
        zebras.push({ s, signal: tg.crossing === 'traffic_signals' })
      }
      if (tg.highway === 'traffic_signals') {
        const d = tg['traffic_signals:direction'] ?? tg.direction
        const applies = d === 'forward' || d === 'backward' ? (d === 'forward') === (h.dir === 1) : !h.twoWay || s > sm.length / 2
        if (applies) stops.push(s)
      }
    })
    const endS = sm.length - h.trim1
    // The stop line of a signalled junction goes before the crossing on its approach, if there is one
    // (a stop line between a zebra and the junction box is not painted: LĢIA, Matīsa x Tērbatas).
    const zNear = zebras.filter((z) => z.s > endS - 25 && z.s < endS + 2)
    if (h.trim1 > 0 && signals) {
      if (!zNear.length) stops.push(endS - 1)
      else if (!zNear.some((z) => z.signal)) stops.push(Math.min(...zNear.map((z) => z.s)) - zw / 2 - ZEBRA_GAP)
    }
    // A signalled crossing just past a junction, on the way out of it: no stop line before it (traffic
    // leaving the junction is held by the junction's own signals, and the photos show none there).
    const fromJunction = junctions.some((j) => j.node === h.from)
    for (const z of zebras) {
      if (!z.signal || (fromJunction && z.s < 25)) continue
      const near = z.s - zw / 2
      if (!stops.some((s) => s <= near + 1 && s > near - 15)) stops.push(near - ZEBRA_GAP)
    }
    // Pulled back off any zebra just after it.
    const stopAt = [...new Set(stops.map((s) => {
      for (const z of zebras) if (z.s - zw / 2 - ZEBRA_GAP < s && s < z.s + zw / 2 + 1) s = z.s - zw / 2 - ZEBRA_GAP
      return Math.round(s * 10) / 10
    }))].filter((s) => s > h.trim0 + 2 && s <= endS).sort((a, b) => a - b)
    // Paint stops at the stop line nearest the junction, if there is one close to it.
    const lastStop = stopAt.length && stopAt[stopAt.length - 1] > endS - 60 ? stopAt[stopAt.length - 1] : null
    // A zebra just past it: the road goes on beyond the crossing, and so do its lines; else what lies
    // past the stop line is the junction, crossed by guides.
    const zebraAfter = (t) => zebras.find((z) => z.s > t && z.s - zw / 2 <= t + ZEBRA_GAP + 6)
    const lineEnd = lastStop != null && !zebraAfter(lastStop) ? lastStop : endS
    // No paint on a zebra, nor between a stop line and the zebra it stands before.
    const zebraGap = (s) => zebras.some((z) => Math.abs(s - z.s) < zw / 2 + 0.6) || stopAt.some((t) => s > t && zebraAfter(t) && s < zebraAfter(t).s)

    // Lane lines, measured from the held edge so the lane that opens or closes is the one that narrows.
    const nMax = Math.max(h.n, Math.round(Math.max(...h.W.slice(i0, i1 + 1)) / h.w))
    const approach = h.trim1 > 0 && (h.turns || signals || lastStop != null)
    const stopLine = lastStop ?? endS
    const solidFrom = approach ? stopLine - SOLID_LEN : Infinity
    const warnFrom = approach && town ? solidFrom - WARN_LEN : Infinity
    // Where a lane that leaves or joins with a slip road runs beside the others: behind a block line.
    if (h.aux) h.block = { kLeft: h.aux.kLeft, at: 'all' }
    const blockSpan = h.block ? (h.block.at === 'all' ? [-Infinity, Infinity] : h.block.at === 'end' ? [sm.length - 150, Infinity] : [-Infinity, 150]) : null
    for (let k = 1; (h.known || h.aux) && k < nMax; k++) {
      const kLeft = h.anchorSide < 0 ? k : nMax - k
      const off = (i) => (h.anchorSide < 0 ? h.left[i] + k * h.w : h.left[i] + h.W[i] - k * h.w)
      const inside = (i) => sm.s[i] <= endS && !(sm.s[i] > lineEnd && sm.s[i] < lineEnd + 1) && !zebraGap(sm.s[i]) && off(i) > h.left[i] + 0.4 && off(i) < h.left[i] + h.W[i] - 0.4 && !covered(right(sm, i, off(i)), h)
      const dashAt = (s) => (s > lineEnd ? 'guide' : s > stopLine ? (town ? 'town' : major ? 'long' : 'short') : blockSpan && h.block.kLeft === kLeft && s >= blockSpan[0] && s <= blockSpan[1] ? 'block' : s >= solidFrom ? 'solid' : s >= warnFrom ? 'warn' : town ? 'town' : major ? 'long' : 'short')
      const at = (s) => {
        const i = Math.min(Math.max(idxAt(sm, s), 1), sm.p.length - 1), j = i - 1
        const a = right(sm, j, off(j)), b = right(sm, i, off(i))
        const t = sm.s[i] > sm.s[j] ? Math.max(0, Math.min(1, (s - sm.s[j]) / (sm.s[i] - sm.s[j]))) : 0
        return [lerp(a[0], b[0], t), lerp(a[1], b[1], t)]
      }
      let run = []
      const flush = () => {
        if (run.length > 1) {
          const style = dashAt(sm.s[run[0]])
          const s0 = sm.s[run[0]], s1 = style === 'guide' || s0 > stopLine ? sm.s[run[run.length - 1]] : Math.min(sm.s[run[run.length - 1]], stopLine)
          if (style === 'guide') {
            // Past the stop line, where the junction is mapped as ways of its own: the lanes carried
            // on by the dotted guides painted there (GeoRīga: Marijas x Satekles, Satekles x Elizabetes).
            const pts = run.map((i) => right(sm, i, off(i)))
            if (pts.length > 1) feat('guide', line(pts), { layer: lv })
          } else if (style === 'town' || style === 'warn') {
            // Cut into the dashes as they are painted, counted back from where the solid line begins
            // (or the junction), so the pattern meets it the way it does on the ground.
            const [D, G] = style === 'town' ? DASH_TOWN : DASH_WARN
            const origin = s0 > stopLine ? stopLine : Math.min(warnFrom, solidFrom, stopLine)
            const per = D + G
            const first = !Number.isFinite(origin) ? s0 : origin > s0 ? origin - Math.ceil((origin - s0) / per) * per : origin + Math.floor((s0 - origin) / per) * per
            for (let a = first; a < s1; a += per) {
              const p = Math.max(a, s0), q = Math.min(a + D, s1)
              if (q - p < 0.5) continue
              const pts = [at(p)]
              for (const i of run) if (sm.s[i] > p && sm.s[i] < q) pts.push(right(sm, i, off(i)))
              pts.push(at(q))
              feat('lane-line', line(pts), { layer: lv, dash: 'solid', paint: style === 'town' ? '2/6' : '6/2' })
            }
          } else if (s1 > s0) {
            const pts = run.filter((i) => sm.s[i] < s1).map((i) => right(sm, i, off(i)))
            pts.push(at(s1))
            if (pts.length > 1) feat('lane-line', line(pts), { layer: lv, dash: style })
          }
        }
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
    // Edge lines on motorways, their slip roads and bridges; not where a trunk road runs through town
    // between kerbs (GeoRīga: Satekles and Marijas iela, trunk at 50 km/h, have none, the kerb is the edge;
    // its slip roads keep theirs, as the LĢIA photo of the A10 x Jūrkalnes ramps shows).
    if ((major && !(isTown(h.tags) && !/_link$/.test(h.tags.highway))) || lv > 0) {
      feat('edge-line', line(polyline(sm, i0, i1, (i) => h.left[i] + 0.35)), { layer: lv })
      feat('edge-line', line(polyline(sm, i0, i1, (i) => h.left[i] + h.W[i] - 0.35)), { layer: lv })
    }
    // Turn arrows in every lane before a junction: GeoRīga shows them 21, 46 and 72 m back from the
    // stop line on Satekles iela; never where a lane is already narrowing away (an arrow saying a lane
    // ends goes before it does), nor on a zebra.
    if (h.turns && h.turns.length === h.n && sm.length > 40) {
      const full = h.n * h.w * 0.97
      const placed = []
      for (const back of town ? [20, 45, 70] : [18, 55]) {
        let s = stopLine - back
        while (s > h.trim0 + 6 && (h.W[idxAt(sm, s)] < full || zebraGap(s) || zebraGap(s + 2.5) || zebraGap(s - 2.5))) s -= 4
        if (s <= h.trim0 + 6 || placed.some((p) => Math.abs(p - s) < 20)) continue
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
    // Stop lines (they are painted on Baltic roads), across this half's carriageway.
    for (const s of stopAt) {
      const i = idxAt(sm, s)
      feat('stop-line', line([right(sm, i, h.left[i]), right(sm, i, h.left[i] + h.W[i])]), { layer: lv })
    }
    // Zebras where a crossing is mapped on the way: 0.5 m stripes along the road, 0.5 m apart, 0.5 m
    // in from the kerbs, the crossing as wide as such a street's is.
    if (h.dir === 1 || !h.twoWay) {
      for (const z of zebras) {
        // A zebra at a junction's mouth is drawn even where the junction's paving has taken the end of
        // the carriageway (GeoRīga: Satekles x Elizabetes, the zebra 13-19 m before the junction node).
        if (z.s < Math.min(h.trim0, 12) + 1 || z.s > sm.length - Math.min(h.trim1, 12) - 1) continue
        const ia = idxAt(sm, z.s - zw / 2), ib = idxAt(sm, z.s + zw / 2), i = idxAt(sm, z.s)
        const a = h.twoWay ? -(h.opposite * h.w + h.centre) : h.left[i]
        const b = h.left[i] + h.W[i]
        const pa = (o) => { const p = right(sm, ia, o), t = sm.t[ia], d = z.s - zw / 2 - sm.s[ia]; return [p[0] + t[0] * d, p[1] + t[1] * d] }
        const pb = (o) => { const p = right(sm, ib, o), t = sm.t[ib], d = z.s + zw / 2 - sm.s[ib]; return [p[0] + t[0] * d, p[1] + t[1] * d] }
        for (let o = a + 0.5; o + 0.5 <= b - 0.4; o += 1) feat('zebra', poly([pa(o), pa(o + 0.5), pb(o + 0.5), pb(o)]), { layer: lv })
      }
    }
  }

  curId = null
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
        const q = [a.left[0] + a.d[0] * t, a.left[1] + a.d[1] * t]
        // A kerb corner bends round between the two roads, never out past them: where their kerb lines
        // meet farther from the junction than their corners are (arms at a wide angle, or crossing behind
        // each other), the corner is the plain curve between the two, so no spike stands out of it.
        const far = Math.max(len(sub(a.left, C)), len(sub(b.right, C)))
        if (Math.abs(t) < 40 && t >= -1 && len(sub(q, C)) < far * 1.15) Q = q
      }
      for (let s = 1; s < 8; s++) {
        const u = s / 8
        ring.push([(1 - u) ** 2 * a.left[0] + 2 * (1 - u) * u * Q[0] + u * u * b.right[0], (1 - u) ** 2 * a.left[1] + 2 * (1 - u) * u * Q[1] + u * u * b.right[1]])
      }
    })
    feat('junction', poly(ring), { layer: 0 })
    pavedRings.push(ring)
    junctionItems.push({ ring, feature: F[F.length - 1] })
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
    // On a fast road a gore is painted: chevrons from where the lanes part to the nose (the LĢIA photos of
    // the A10 and Jūrkalnes ramps show them at every one); in town it is plain or kerbed.
    const fast = (MAJOR.test(main.tags.highway) || MAJOR.test(slip.tags.highway)) && !(isTown(main.tags) && isTown(slip.tags) && !/_link$/.test(slip.tags.highway))
    const ring = [...A, ...B.reverse()]
    if (fast && !paved) feat('hatch', poly(ring), { layer: 0, how: kind })
    else feat('gore', poly(ring), { layer: 0, side, how: kind, paved })
    if (!paved) judged.push({ ring, feature: F[F.length - 1], from: 'gore' })
  }

  // The islands and hatched areas mappers drew.
  for (const w of ways) {
    const t = w.tags
    const isl = t['area:highway'] === 'traffic_island' || t.traffic_calming === 'island'
    const hatch = t['area:highway'] === 'prohibited'
    if ((!isl && !hatch) || w.nodes[0] !== w.nodes[w.nodes.length - 1]) continue
    feat(hatch ? 'hatch' : 'island', { type: 'Polygon', coordinates: [w.coords] }, { grass: t.surface === 'grass' || t.landuse === 'grass' })
    judged.push({ ring: w.xy, feature: F[F.length - 1], from: 'osm' })
  }
  // A roundabout's middle: the island inside its inner kerb, the ring followed round from node to node.
  // Grass in most Baltic towns; the photo says which where there is one.
  const ringFrom = new Map()
  for (const h of halves) if (h.roundabout && !h.twoWay && h.ring) ringFrom.set(h.from, h)
  const done = new Set()
  for (const h0 of ringFrom.values()) {
    if (done.has(h0)) continue
    const chain = []
    let h = h0
    while (h && !done.has(h)) {
      done.add(h)
      chain.push(h)
      h = ringFrom.get(h.to)
    }
    if (h !== h0 || chain.length < 1) continue
    const ring = chain.flatMap((c) => polyline(c.sm, 0, c.sm.p.length - 1, (i) => c.left[i]))
    if (ring.length < 8) continue
    feat('island', poly(ring), { layer: 0, grass: true, roundabout: true })
    judged.push({ ring, feature: F[F.length - 1], from: 'osm' })
  }
  if (photo) {
    for (const h of halves) if (h.ring) pavedRings.push(h.ring)
    const [x0, y0] = P.to([bbox[0], bbox[1]]), [x1, y1] = P.to([bbox[2], bbox[3]])
    const colourAt = (p) => photo.rgb(...P.from(p))
    if (globalThis.process?.env?.PHOTO_DEBUG) {
      const T = 256 * 2 ** 19, mx = (lon) => ((lon + 180) / 360) * T, my = (lat) => ((1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2) * T
      const k = 1600 / (mx(bbox[2]) - mx(bbox[0]))
      globalThis.__px = (p) => { const [lon, lat] = P.from(p); return [Math.round((mx(lon) - mx(bbox[0])) * k), Math.round((my(lat) - my(bbox[3])) * k)] }
    }
    for (const { ring, kind } of photoPass(pavedRings, judged, colourAt, [x0, y0, x1, y1], junctionItems, poly)) {
      if (kind === 'asphalt') feat('junction', poly(ring), { layer: 0, source: 'photo' })
      else if (kind === 'hatch') feat('hatch', poly(ring), { layer: 0, source: 'photo' })
      else feat('island', poly(ring), { layer: 0, grass: kind === 'grass', source: 'photo' })
    }
  }
  return { type: 'FeatureCollection', features: F }
}

/**
 * Moves a carriageway's kerbs to where the asphalt ends on the photo. Every 4 m along (outside the
 * junctions), across the road from the middle of its lanes outwards: the photo there (each cell the
 * median of 3 pixels 6 m along, so a dash or a car says little), judged against the road's own colour
 * taken from the middle of its lanes; the kerb is where 0.75 m in a row is no longer road (a shadow
 * counts as neither). Kept only where found within reach (up to 3 m past the lanes' edge, a quarter
 * of the width or 2.5 m inside it), on at least 40 % of the stretch, smoothed over 5 readings; where
 * the asphalt runs on (a merged slab, a car park beside) the rules stand. The middle of a two-way road
 * stays. Then lanes as wide as the asphalt the photo shows, between 2.75 and 4.25 m.
 */
function fitToPhoto(halves, colourAt) {
  const med = (xs) => xs.sort((a, b) => a - b)[xs.length >> 1]
  for (const h of halves) {
    const lvl = Number(h.tags.layer ?? (h.tags.tunnel && h.tags.tunnel !== 'no' ? -1 : 0)) || 0
    if (lvl < 0 || h.sm.length < 12) continue
    const { sm } = h
    const n = sm.p.length
    const at = [], dR = [], dL = []
    for (let i = 0; i < n; i += 2) {
      const s = sm.s[i]
      if (s < h.trim0 + 3 || s > sm.length - h.trim1 - 3) continue
      const L = h.left[i], R = L + h.W[i], t = sm.t[i], nr = [t[1], -t[0]]
      const cell = (o) => {
        const cs = []
        for (const a of [-3, 0, 3]) {
          const c = colourAt([sm.p[i][0] + t[0] * a + nr[0] * o, sm.p[i][1] + t[1] * a + nr[1] * o])
          if (c) cs.push(c)
        }
        return cs.length >= 2 ? median3(cs) : null
      }
      const mid = []
      for (let o = L + h.W[i] * 0.25; o <= R - h.W[i] * 0.25; o += 0.25) {
        const c = cell(o)
        if (c && satOf(c) < 35 && lumOf(c) < 175) mid.push(c)
      }
      const ref = asphaltRef(mid.length >= 4 ? [...mid, ...mid, ...mid] : [])
      if (!ref || satOf(ref) > 30) continue
      const lr = lumOf(ref)
      const walk = (dir, from, to) => {
        let bad = 0, first = null
        for (let o = from; dir > 0 ? o <= to : o >= to; o += dir * 0.25) {
          const c = cell(o)
          if (!c) return null
          const l = lumOf(c)
          if (l < lr * 0.72 && satOf(c) < 30) continue // shadow: neither
          const road = colourDist(c, ref) < 22 || (l > lr + 40 && satOf(c) < 35)
          if (road) {
            bad = 0
            continue
          }
          if (!bad) first = o
          if (++bad >= 3) {
            // A kerb, not a patch: what lies beyond stays unlike the road for 1.5 m (grass, paving, a
            // wall), clearly so (dry verges at the A10 are close to asphalt in colour).
            let sum = 0, k = 0
            for (let q = first; Math.abs(q - first) <= 1.5; q += dir * 0.25) {
              const cq = cell(q)
              if (cq) {
                sum += colourDist(cq, ref)
                k++
              }
            }
            return k >= 4 && sum / k > 30 ? first - dir * 0.125 : null
          }
        }
        return null
      }
      const c0 = (L + R) / 2
      // A road OSM gives no lanes for is drawn at a guessed width: the photo may move its kerbs 1.5 m out.
      const out = h.known ? 3 : 1.5
      const r = walk(1, c0, R + out)
      const l = h.twoWay ? null : walk(-1, c0, L - out)
      at.push(i)
      dR.push(r != null && r > R - Math.max(2.5, h.W[i] * 0.25) ? r - R : null)
      dL.push(l != null && l < L + Math.max(2.5, h.W[i] * 0.25) ? l - L : null)
    }
    h.read = { at, dR, dL }
  }
  // Read along whole streets, not piece by piece: the pieces a street is cut into at nodes where it
  // runs straight on (no junction cut back there) are chained, so the kerb read off the photo goes on
  // across the node instead of stepping there.
  const nextOf = new Map(), hasPrev = new Set()
  for (const h of halves) {
    if (!h.read || h.trim1 > 0) continue
    const cands = halves.filter((b) => b !== h && b.read && b.from === h.to && b.seg !== h.seg && b.trim0 === 0 && b.twoWay === h.twoWay && Math.abs(turn(h.hEnd, b.hStart)) < 0.35)
    if (cands.length === 1 && !hasPrev.has(cands[0])) {
      nextOf.set(h, cands[0])
      hasPrev.add(cands[0])
    }
  }
  const seen = new Set()
  for (const h0 of halves) {
    if (!h0.read || hasPrev.has(h0) || seen.has(h0)) continue
    const chain = []
    for (let h = h0; h && !seen.has(h); h = nextOf.get(h)) {
      seen.add(h)
      chain.push(h)
    }
    // Every reading at its distance along the chain.
    const rd = []
    let base = 0
    for (const h of chain) {
      h.read.at.forEach((i, k) => rd.push({ s: base + h.sm.s[i], R: h.read.dR[k], L: h.read.dL[k] }))
      h.base = base
      base += h.sm.length
    }
    if (rd.length < 3) continue
    const side = (key) => {
      const found = rd.filter((r) => r[key] != null)
      // Too little found (the asphalt runs on, or the photo is unclear): the rules stand.
      if (found.length < Math.max(3, rd.length * 0.5)) return null
      // A median over 32 m, then a mean over 32 m: a kerb bends and tapers, it does not wobble.
      const md = found.map((r) => med(found.filter((q) => Math.abs(q.s - r.s) <= 16).map((q) => q[key])))
      const mean = found.map((r) => {
        let sum = 0, k = 0
        found.forEach((q, j) => {
          if (Math.abs(q.s - r.s) <= 16) {
            sum += md[j]
            k++
          }
        })
        return { s: r.s, v: sum / k }
      })
      // Between readings straight across; past the first and last, held.
      return (s) => {
        if (s <= mean[0].s) return mean[0].v
        if (s >= mean[mean.length - 1].s) return mean[mean.length - 1].v
        let j = 1
        while (mean[j].s < s) j++
        const p = mean[j - 1], q = mean[j]
        return lerp(p.v, q.v, (s - p.s) / (q.s - p.s || 1))
      }
    }
    const fR = side('R'), fL = side('L')
    if (!fR && !fL) continue
    for (const h of chain) {
      const ws = []
      for (let i = 0; i < h.sm.p.length; i++) {
        const s = h.base + h.sm.s[i]
        const L = h.left[i] + (fL ? fL(s) : 0), R = h.left[i] + h.W[i] + (fR ? fR(s) : 0)
        h.left[i] = L
        h.W[i] = Math.max(R - L, 2)
        if (h.sm.s[i] > h.trim0 + 3 && h.sm.s[i] < h.sm.length - h.trim1 - 3) ws.push(h.W[i])
      }
      h.photoFit = true
      if (h.known && ws.length && !h.start && !h.end) {
        const gut = h.twoWay ? GUTTERS / 2 : GUTTERS
        h.w = Math.max(2.75, Math.min(4.25, (med(ws) - gut) / h.n))
      }
    }
  }
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
 * Kerbs taper, they do not step: wherever an edge moves out or in faster than 1 in 4 along the road
 * (a kerb read off the photo jumping between readings, an island's edge taken over), it is averaged over
 * 8 m either side until it does not. On the LĢIA photos the steepest kerb tapers in town (bus bays,
 * turn pockets) run about 1 in 5; a lane line measured from such an edge then bends instead of breaking
 * into stubs at odd angles.
 */
function smoothEdges(halves) {
  const K = 0.25
  for (const h of halves) {
    if (!h.left || h.left.length < 5) continue
    const s = h.sm.s, n = s.length
    const fix = (E) => {
      for (let it = 0; it < 4; it++) {
        const steep = new Uint8Array(n)
        let any = false
        for (let i = 1; i < n; i++) if (Math.abs(E[i] - E[i - 1]) > K * (s[i] - s[i - 1] || 1) + 0.05) {
          steep[i] = steep[i - 1] = 1
          any = true
        }
        if (!any) return E
        const out = E.slice()
        for (let i = 0; i < n; i++) {
          let near = false
          for (let j = Math.max(0, i - 4); j <= Math.min(n - 1, i + 4) && !near; j++) near = !!steep[j]
          if (!near) continue
          let sum = 0, k = 0
          for (let j = Math.max(0, i - 4); j <= Math.min(n - 1, i + 4); j++) {
            sum += E[j]
            k++
          }
          out[i] = sum / k
        }
        E = out
      }
      return E
    }
    const R = fix(h.left.map((l, i) => l + h.W[i]))
    // A two-way road's half keeps its middle where it is: only its kerb is eased.
    const L = h.twoWay ? h.left : fix(h.left)
    h.left = L
    h.W = R.map((r, i) => Math.max(r - L[i], 2))
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


// ---- the orthophoto ------------------------------------------------------------------------------
// Where an aerial photo covers the ground (the LĢIA 25 cm orthophoto covers all of Latvia), the builder
// reads it for what OSM leaves out: what the areas between carriageways are made of (painted chevrons,
// plain asphalt, a kerbed island, grass). The photo is handed over per bbox (lendPhoto) by whoever has it;
// without one, the rules alone decide.

const PHOTOS = new Map()
const bboxKey = (b) => b.map((v) => Number(v).toFixed(6)).join(',')
/** Lends the builder a photo of this bbox: { rgb(lon, lat) -> [r, g, b] | null }. */
export function lendPhoto(bbox, photo) {
  PHOTOS.set(bboxKey(bbox), photo)
}

const lumOf = (c) => (c[0] + c[1] + c[2]) / 3
const satOf = (c) => Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2])
/** Excess green and warmth: grass (even dry Baltic summer grass) is greener and warmer than asphalt. */
const exgOf = (c) => 2 * c[1] - c[0] - c[2]
const warmOf = (c) => (c[0] + c[1]) / 2 - c[2]
/** How unlike two colours are, as much by hue as by brightness. */
function colourDist(a, b) {
  const la = lumOf(a), lb = lumOf(b)
  return Math.hypot(a[0] - la - (b[0] - lb), a[1] - la - (b[1] - lb), a[2] - la - (b[2] - lb)) * 1.6 + Math.abs(la - lb) * 0.8
}
const median3 = (cs) => [0, 1, 2].map((k) => cs.map((c) => c[k]).sort((a, b) => a - b)[cs.length >> 1])

/**
 * What a patch of ground is on the photo, against the asphalt round it (ref): 'hatch' (asphalt with
 * paint on it: chevrons, a painted island), 'asphalt' (plain road), 'grass', 'island' (something else:
 * a kerbed island, paving), or null when the photo says too little. Thresholds set on the LĢIA photos of
 * the test places: asphalt within 22 of the road's own colour, paint 40 brighter and grey, grass 6 greener
 * or warmer than the road beside it.
 */
function material(colours, ref) {
  const lr = lumOf(ref), er = exgOf(ref), wr = warmOf(ref)
  let n = 0, asph = 0, paint = 0, grass = 0
  for (const c of colours) {
    if (!c) continue
    const l = lumOf(c)
    if (l < lr * 0.6) continue // a shadow or a dark car: says nothing
    n++
    if (l > Math.max(lr + 40, 150) && satOf(c) < 35) paint++
    else if (colourDist(c, ref) < 22) asph++
    else if (exgOf(c) - er > 4 && warmOf(c) - wr > 3) grass++
  }
  if (n < 12) return null
  const f = { n, asph: asph / n, paint: paint / n, grass: grass / n }
  // Chevrons cover 15-45 % of a hatched area on the photo (gores at the A10, the Juglas hatching); lane
  // lines and arrows in a stretch of plain road 2-13 %; a zebra or a solid painted island over 65 %.
  f.kind = f.paint >= 0.14 && f.paint <= 0.65 && f.grass < 0.35 && f.asph + f.paint > 0.4 ? 'hatch' : f.grass > 0.35 ? 'grass' : f.asph + f.paint > 0.7 && f.paint < 0.14 ? 'asphalt' : 'island'
  return f
}

/** A grid of 0.5 m cells over the drawing: 1 where road, 2 where an area is drawn already. */
function cellGrid(roadRings, areaRings, box) {
  const CS = 0.5
  const gx0 = box[0] - 10, gy0 = box[1] - 10
  const NX = Math.ceil((box[2] - box[0] + 20) / CS), NY = Math.ceil((box[3] - box[1] + 20) / CS)
  const G = { g: new Uint8Array(NX * NY), NX, NY, CS, gx0, gy0 }
  G.centre = (k) => [gx0 + ((k % NX) + 0.5) * CS, gy0 + (Math.floor(k / NX) + 0.5) * CS]
  for (const r of roadRings) for (const k of cellsIn(G, r)) G.g[k] = Math.max(G.g[k], 1)
  for (const r of areaRings) for (const k of cellsIn(G, r)) G.g[k] = 2
  return G
}

/** The cells inside a ring (indices), on a grid as cellGrid makes. */
function cellsIn(G, ring) {
  const { NX, NY, CS, gx0, gy0 } = G
  const out = []
  let ymin = Infinity, ymax = -Infinity
  for (const p of ring) {
    ymin = Math.min(ymin, p[1])
    ymax = Math.max(ymax, p[1])
  }
  for (let j = Math.max(0, Math.floor((ymin - gy0) / CS)); j <= Math.min(NY - 1, Math.ceil((ymax - gy0) / CS)); j++) {
    const y = gy0 + (j + 0.5) * CS, xs = []
    for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) {
      const [xa, ya] = ring[a], [xb, yb] = ring[b]
      if (ya > y !== yb > y) xs.push(xa + ((y - ya) * (xb - xa)) / (yb - ya))
    }
    xs.sort((p, q) => p - q)
    for (let k = 0; k + 1 < xs.length; k += 2) {
      for (let i = Math.max(0, Math.ceil((xs[k] - gx0) / CS - 0.5)); i <= Math.min(NX - 1, Math.floor((xs[k + 1] - gx0) / CS - 0.5)); i++) out.push(j * NX + i)
    }
  }
  return out
}

/** Road cells within reach (cells) of a set of cells: the asphalt beside it, to judge it against. */
function roadAround(G, cells, reach = 8) {
  const { g, NX, NY } = G
  const seen = new Set(cells), out = []
  let front = [...cells]
  for (let d = 0; d < reach && front.length; d++) {
    const next = []
    for (const k of front) {
      const i = k % NX, j = (k - i) / NX
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const a = i + di, b = j + dj
        if (a < 0 || b < 0 || a >= NX || b >= NY) continue
        const q = b * NX + a
        if (seen.has(q)) continue
        seen.add(q)
        next.push(q)
        if (g[q] === 1) out.push(q)
      }
    }
    front = next
  }
  return out
}

/** The road's own colour from some of its cells: their median, leaving out paint and shadow. */
function asphaltRef(colours) {
  const cs = colours.filter((c) => c && satOf(c) < 40)
  if (cs.length < 12) return null
  const m = median3(cs)
  const near = cs.filter((c) => colourDist(c, m) < 25)
  return near.length / cs.length > 0.4 ? median3(near) : null
}

/** The outline of a set of cells (4-connected), as a ring in metres, its steps smoothed. */
function outline(G, cells) {
  const { NX, CS, gx0, gy0 } = G
  const inside = new Set(cells)
  const next = new Map()
  const key = (x, y) => x * 100003 + y
  for (const k of cells) {
    const i = k % NX, j = (k - i) / NX
    // Edges anticlockwise round the cell (y up), where the neighbour is not in the set.
    if (!inside.has(k - NX)) next.set(key(i, j), [i + 1, j])
    if (!inside.has(k + 1)) next.set(key(i + 1, j), [i + 1, j + 1])
    if (!inside.has(k + NX)) next.set(key(i + 1, j + 1), [i, j + 1])
    if (!inside.has(k - 1)) next.set(key(i, j + 1), [i, j])
  }
  let best = null
  const used = new Set()
  for (const [k0, first] of next) {
    if (used.has(k0)) continue
    const ring = []
    let k = k0, p = first
    while (!used.has(k) && p) {
      used.add(k)
      ring.push(p)
      k = key(p[0], p[1])
      p = next.get(k)
    }
    if (!best || ring.length > best.length) best = ring
  }
  if (!best || best.length < 4) return null
  let ring = best.map(([i, j]) => [gx0 + i * CS, gy0 + j * CS])
  // Chaikin twice, then thinned: the stair of the cells becomes the curve it stands for.
  for (let it = 0; it < 2; it++) {
    const r2 = []
    for (let a = 0; a < ring.length; a++) {
      const p = ring[a], q = ring[(a + 1) % ring.length]
      r2.push([p[0] * 0.75 + q[0] * 0.25, p[1] * 0.75 + q[1] * 0.25], [p[0] * 0.25 + q[0] * 0.75, p[1] * 0.25 + q[1] * 0.75])
    }
    ring = r2
  }
  return simplify(ring, 0.15)
}
function simplify(ring, tol) {
  if (ring.length < 8) return ring
  const keep = new Uint8Array(ring.length)
  const dp = (a, b) => {
    let best = -1, at = -1
    const [ax, ay] = ring[a], [bx, by] = ring[b], L = Math.hypot(bx - ax, by - ay) || 1e-9
    for (let k = a + 1; k < b; k++) {
      const d = Math.abs((bx - ax) * (ay - ring[k][1]) - (ax - ring[k][0]) * (by - ay)) / L
      if (d > best) {
        best = d
        at = k
      }
    }
    if (best > tol) {
      keep[at] = 1
      dp(a, at)
      dp(at, b)
    }
  }
  const mid = ring.length >> 1
  keep[0] = keep[mid] = 1
  dp(0, mid)
  dp(mid, ring.length - 1)
  keep[ring.length - 1] = 1
  return ring.filter((_, k) => keep[k])
}

/**
 * The photo pass, after everything is drawn by the rules:
 *  - each island, hatched area and gore is judged on the photo against the asphalt beside it and drawn
 *    as what it is there: chevrons on asphalt (hatch), grass, a kerbed island, or plain asphalt;
 *  - the pockets left undrawn between carriageways (enclosed, thin: every point within 8 m of a road)
 *    are filled with what the photo shows there: asphalt where the road runs on (the hole north of the
 *    Marijas iela median at Stacijas laukums), else the island, grass or chevrons it is.
 * items: [{ ring (local metres), feature, from: 'osm' | 'gore' }]. Returns the new features (local rings).
 */
function photoPass(roadRings, items, colourAt, box, junctionItems = [], toGeom = null) {
  const G = cellGrid(roadRings, items.map((it) => it.ring), box)
  const colours = (cells) => cells.map((k) => colourAt(G.centre(k)))
  // A junction's paving where the rules round its corners: peeled back from its outer edge, up to 3 m,
  // where the photo shows no road (grass, a pavement, a tram bed): its corners as built, not as guessed.
  for (const it of junctionItems) {
    const cells = cellsIn(G, it.ring)
    if (cells.length < 40 || !toGeom) continue
    const ref = asphaltRef(colours(cells))
    if (!ref) continue
    const lr = lumOf(ref)
    const inJ = new Set(cells)
    const notRoad = (k) => {
      const c = colourAt(G.centre(k))
      if (!c) return false
      const l = lumOf(c)
      if (l < lr * 0.72 && satOf(c) < 30) return false // shadow: keep
      if (l > lr + 40 && satOf(c) < 35) return false // paint
      return colourDist(c, ref) > 30
    }
    const gone = new Set()
    let front = cells.filter((k) => [k + 1, k - 1, k + G.NX, k - G.NX].some((q) => !inJ.has(q) && G.g[q] !== 1 && G.g[q] !== 2) && notRoad(k))
    for (let d = 0; d < 6 && front.length; d++) {
      const next = []
      for (const k of front) {
        if (gone.has(k)) continue
        gone.add(k)
        for (const q of [k + 1, k - 1, k + G.NX, k - G.NX]) if (inJ.has(q) && !gone.has(q) && notRoad(q)) next.push(q)
      }
      front = next
    }
    if (gone.size < cells.length * 0.04) continue
    const keep = cells.filter((k) => !gone.has(k))
    const ring = outline(G, keep)
    if (ring && ring.length >= 4) it.feature.geometry = toGeom(ring)
  }
  const judge = (cells) => {
    const ref = asphaltRef(colours(roadAround(G, cells)))
    return ref ? material(colours(cells), ref) : null
  }
  for (const it of items) {
    const cells = cellsIn(G, it.ring)
    if (cells.length < 12) continue
    const m = judge(cells)
    if (globalThis.__px) console.error('area', it.from, it.feature.properties.kind, globalThis.__px(G.centre(cells[cells.length >> 1])), cells.length, m && JSON.stringify(m, (k, v) => (typeof v === 'number' ? Math.round(v * 100) / 100 : v)))
    if (!m) continue
    const p = it.feature.properties
    p.photo = m.kind
    if (it.from === 'gore') {
      // A gore drawn painted by the rules (a fast road's) stays painted unless the photo shows grass there:
      // its chevrons fill only part of the wedge the rules draw, so the rest reads as plain asphalt.
      const painted = p.kind === 'hatch'
      p.kind = m.kind === 'hatch' || (painted && m.kind !== 'grass') ? 'hatch' : m.kind === 'grass' ? 'island' : 'gore'
      p.grass = m.kind === 'grass'
      p.paved = m.kind === 'asphalt'
    } else if (p.kind === 'island') {
      if (m.kind === 'hatch') p.kind = 'hatch'
      else if (m.kind === 'grass') p.grass = true
      else if (p.roundabout) p.grass = false
    } else if (p.kind === 'hatch' && m.kind === 'grass') {
      p.kind = 'island'
      p.grass = true
    }
  }
  // Pockets: the free cells no road or area covers, in pieces; those not reaching the grid's edge.
  const { g, NX, NY } = G
  const dist = new Int16Array(NX * NY).fill(-1)
  let front = []
  for (let k = 0; k < g.length; k++) if (g[k]) {
      dist[k] = 0
      front.push(k)
    }
  for (let d = 1; front.length; d++) {
    const next = []
    for (const k of front) {
      const i = k % NX
      for (const q of [i + 1 < NX ? k + 1 : -1, i > 0 ? k - 1 : -1, k + NX < g.length ? k + NX : -1, k - NX]) {
        if (q < 0 || dist[q] >= 0) continue
        dist[q] = d
        next.push(q)
      }
    }
    front = next
    if (d > 60) break
  }
  const seen = new Uint8Array(NX * NY)
  const out = []
  for (let k0 = 0; k0 < g.length; k0++) {
    if (g[k0] || seen[k0]) continue
    const comp = [k0]
    seen[k0] = 1
    let edge = false, far = 0
    for (let a = 0; a < comp.length; a++) {
      const k = comp[a], i = k % NX, j = (k - i) / NX
      if (i === 0 || j === 0 || i === NX - 1 || j === NY - 1) edge = true
      far = Math.max(far, dist[k] < 0 ? 999 : dist[k])
      for (const q of [i + 1 < NX ? k + 1 : -1, i > 0 ? k - 1 : -1, j + 1 < NY ? k + NX : -1, j > 0 ? k - NX : -1]) {
        if (q < 0 || g[q] || seen[q]) continue
        seen[q] = 1
        comp.push(q)
      }
    }
    // 1 m² to 1200 m², every cell within 8 m of a road: a pocket between carriageways, not a block.
    if (edge || comp.length > 4800 || far > 16) continue
    // A seam under 4 m² between carriageways laid side by side: asphalt, whatever the photo says.
    const m = comp.length < 16 ? { kind: 'asphalt' } : judge(comp)
    if (globalThis.__px) console.error('pocket', globalThis.__px(G.centre(comp[comp.length >> 1])), comp.length, far, m && JSON.stringify(m, (k, v) => (typeof v === 'number' ? Math.round(v * 100) / 100 : v)))
    // Something else (a kerbed island, a tram track bed): drawn as an island only where narrow (under 8 m
    // across), so a building in a small block is never taken for one.
    if (!m || (m.kind === 'island' && far > 8)) continue
    // Asphalt is drawn half a metre over the road round it, so no seam shows at its edge.
    let cells = comp
    if (m.kind === 'asphalt') {
      const grown = new Set(comp)
      for (const k of comp) for (const q of [k + 1, k - 1, k + NX, k - NX]) if (q >= 0 && q < g.length && g[q] === 1) grown.add(q)
      cells = [...grown]
    }
    const ring = outline(G, cells)
    if (ring) out.push({ ring, kind: m.kind })
  }
  return out
}

/**
 * The extra layer: kerbs, islands and painted areas traced on the city of Rīga's own 1 cm orthophoto
 * (GeoRīga 2022, sheet 4311-32-23.3.2 by Stacijas laukums), where OSM has none. Handed to the builder
 * as the areas mappers would draw, so the carriageways beside them take their edges from them too.
 */
export async function extra(bbox) {
  const { readFileSync } = await import('node:fs')
  // The LĢIA orthophoto of the place, lent to the builder (none outside Latvia: then the rules alone).
  try {
    const { orthophoto } = await import('./ortho.mjs')
    const photo = await orthophoto(bbox)
    if (photo.coverage > 0.3) lendPhoto(bbox, photo)
  } catch {}
  let fc
  try {
    fc = JSON.parse(readFileSync(new URL('./georiga-traced.json', import.meta.url), 'utf8'))
  } catch {
    return {}
  }
  const [w, s, e, n] = bbox
  const ways = [], features = []
  let id = -1
  for (const f of fc.features) {
    const ring = f.geometry.coordinates[0]
    if (!ring.some(([x, y]) => x > w && x < e && y > s && y < n)) continue
    // Paint is drawn as traced; only kerbs (islands) also move the carriageway edges beside them.
    if (f.properties.kind === 'hatch') {
      features.push({ type: 'Feature', properties: { kind: 'hatch', layer: 0, source: 'GeoRīga orthophoto 2022' }, geometry: f.geometry })
      continue
    }
    const nodes = ring.map(() => id--)
    nodes[nodes.length - 1] = nodes[0]
    const tags = { 'area:highway': 'traffic_island', ...(f.properties.grass ? { surface: 'grass' } : {}) }
    ways.push({ id: `georiga${id}`, tags: { ...tags, source: 'GeoRīga orthophoto 2022' }, nodes, coords: ring })
  }
  return { ways, features }
}
