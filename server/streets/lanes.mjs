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
/** How fast an edge fitted to a mapped island or hatched area may move across, m per m along the road. */
const EASE = 0.2
const STEP = 2
/** How far a kerb may run back on itself where a slip road is turned to its parent road (out of sight), m. */
const FOLD = 0.3
/** Whether the wedges between roads parting or joining are drawn (islands with chevrons). Off: the roads alone read better for now. */
const DRAW_GORES = false
/** Chevrons and stripes in a gore or island, metres apart along the road. */
const CHEVRON = 4

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

/**
 * A piece that parts from a road (at = 'start') or joins one (at = 'end') at an angle: its cross-sections
 * there are turned by that angle, so at the node it is the road's own (heading t) and its kerbs go on from
 * the road's instead of starting turned (a kerb step, a notch of ground between them); the turn eases off
 * over a taper, each sample keeping its own bend. Half as much, or none, where it would fold a kerb
 * (at its ends' offsets) back on itself.
 */
function alignTo(h, t, at) {
  const { sm } = h
  const own = sm.t, ends = at === 'start' ? h.start : h.end
  const D = Math.min(MAJOR.test(h.tags.highway) ? TAPER.fast : TAPER.city, sm.length)
  const near = (i) => (at === 'start' ? sm.s[i] : sm.length - sm.s[i])
  const end = at === 'start' ? own[0] : own[own.length - 1]
  const by = turn(Math.atan2(end[1], end[0]), Math.atan2(t[1], t[0]))
  const folds = () => {
    // How far a kerb runs back at worst: short samples where OSM vertices crowd fold back by a few cm unseen.
    let worst = 0
    for (const off of [ends.left, ends.left + ends.width]) {
      for (let i = 1; i < sm.p.length; i++) {
        if (near(i) > D + STEP && near(i - 1) > D + STEP) continue
        const a = right(sm, i - 1, off), b = right(sm, i, off), d = sub(sm.p[i], sm.p[i - 1])
        worst = Math.max(worst, -((b[0] - a[0]) * d[0] + (b[1] - a[1]) * d[1]) / (len(d) || 1))
      }
    }
    return worst
  }
  const before = folds()
  for (const k of [1, 0.5]) {
    sm.t = own.map((o, i) => {
      const a = Math.atan2(o[1], o[0]) + k * by * (1 - smooth(near(i) / D))
      return [Math.cos(a), Math.sin(a)]
    })
    if (folds() <= before + FOLD) return
  }
  sm.t = own
}

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
  // Where a road just goes on (with as many lanes or not): the two pieces, for the lane links.
  const conts = []
  // A slip road's gore side: the side its gore (and the road it leaves or joins) is on, -1 left, +1 right.
  // Carried along the slip road through the nodes where it only goes on, so a lane it gains or loses
  // on the way opens or closes on that side, the gore's island filling the room (see the lane change below).
  const onlyOn = (node) => {
    const i = (into.get(node) ?? []).filter((h) => h.nodes.length > 1), o = (outOf.get(node) ?? []).filter((h) => h.nodes.length > 1)
    return i.length === 1 && o.length === 1 && i[0].seg !== o[0].seg && !i[0].twoWay && !o[0].twoWay && Math.abs(turn(i[0].hEnd, o[0].hStart)) < (35 * Math.PI) / 180 ? [i[0], o[0]] : null
  }
  const carry = (h, side, forward) => {
    // The piece that meets the gore itself knows which end does.
    h.goreAt ??= forward ? 'start' : 'end'
    for (let cur = h, dist = 0; cur && dist < 400; ) {
      cur.goreSide ??= side
      dist += cur.sm.length
      const p = onlyOn(forward ? cur.to : cur.from)
      cur = p ? (forward ? p[1] : p[0]) : null
    }
  }
  for (const node of nodes) {
    const ins = (into.get(node) ?? []).filter((h) => h.nodes.length > 1 && !h.twoWay)
    const outs = (outOf.get(node) ?? []).filter((h) => h.nodes.length > 1 && !h.twoWay)
    if (ins.length === 1 && outs.length === 2) {
      const a = ins[0]
      const [m, r] = [...outs].sort((p, q) => Math.abs(turn(a.hEnd, p.hStart)) - Math.abs(turn(a.hEnd, q.hStart)))
      if (Math.abs(turn(a.hEnd, r.hStart)) < (60 * Math.PI) / 180) {
        const s = turn(m.hStart, r.hStart) < 0 ? -1 : 1
        carry(r, s, true)
        // The main road, past where a slip road leaves it, gains a lane on the side away from it.
        carry(m, s, true)
      }
    } else if (ins.length === 2 && outs.length === 1) {
      const b = outs[0]
      const [m, r] = [...ins].sort((p, q) => Math.abs(turn(p.hEnd, b.hStart)) - Math.abs(turn(q.hEnd, b.hStart)))
      if (Math.abs(turn(r.hEnd, b.hStart)) < (60 * Math.PI) / 180) {
        const s = turn(m.hEnd, r.hEnd) > 0 ? -1 : 1
        carry(r, s, false)
        // Before a slip road joins, the main road loses a lane on the side it joins on.
        carry(m, -s, false)
      }
    }
  }
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
        // The leaving lanes take the road's own outer kerb with them, then narrow to the slip road's own width.
        const wr = nr ? R - L - nm * a.w : r.n * r.w
        if (side > 0) {
          m.start = { left: L, width: nm * m.w, anchor: -1 }
          r.start = { left: L + nm * a.w, width: wr, anchor: -1 }
        } else {
          m.start = { left: R - nm * m.w, width: nm * m.w, anchor: 1 }
          r.start = { left: R - nm * a.w - wr, width: wr, anchor: 1 }
        }
        for (const h of [m, r]) alignTo(h, a.sm.t[a.sm.t.length - 1], 'start')
        gores.push({ kind: 'diverge', main: m, slip: r, side, from: a, nm })
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
        // The joining lanes come in to the road's own outer kerb.
        const wr = nr ? R - L - nm * b.w : r.n * r.w
        if (side > 0) {
          m.end = { left: L, width: nm * m.w, anchor: -1 }
          r.end = { left: L + nm * b.w, width: wr, anchor: -1 }
          // No lane of its own after the merge: the joining traffic's lane opens beside the main road and closes on its right.
          if (!nr) b.start = { left: L, width: b.width + r.n * r.w, anchor: -1 }
        } else {
          m.end = { left: R - nm * m.w, width: nm * m.w, anchor: 1 }
          r.end = { left: R - nm * b.w - wr, width: wr, anchor: 1 }
          if (!nr) b.start = { left: L - r.n * r.w, width: b.width + r.n * r.w, anchor: 1 }
        }
        for (const h of [m, r]) alignTo(h, b.sm.t[0], 'end')
        gores.push({ kind: 'merge', main: m, slip: r, side, to: b, nm })
        continue
      }
    }
    // A road going on with more or fewer lanes: one edge straight, the lane opens or closes on the other.
    if (!sharp && cont.length && segs.size === 2) {
      for (const { a, b } of cont) {
        if (a.twoWay === b.twoWay) conts.push({ a, b })
        if (a.n === b.n || a.twoWay !== b.twoWay) continue
        const [La, Ra] = edgesAt(a)
        // Which side the change is on: the wider piece's turn lanes (a turn lane opens on its side; a lane
        // marked to merge left ends on the right, and the mirror); else, on a slip road, its gore's side;
        // else the right.
        const wide = b.n > a.n ? b : a
        const extra = Math.abs(b.n - a.n)
        const t = turnOnly(wide.turns)
        const ends = wide.turns ? { right: wide.turns.slice(-extra).every((d) => d.includes('merge_to_left')), left: wide.turns.slice(0, extra).every((d) => d.includes('merge_to_right')) } : {}
        const gore = a.goreSide ?? b.goreSide
        const side = a.twoWay ? 1 : ends.right ? 1 : ends.left ? -1 : t.left >= extra && t.right < extra ? -1 : t.right >= extra ? 1 : gore ?? 1
        const anchor = -side
        // A slip road one lane short between its gore and here, on the gore's side: it runs its own lanes
        // to here, the island beside them (between them and the other road's) reaching to here; here the
        // lane it gains begins, whole, where the island ends. Its edge away from the island holds.
        const narrow = b.n > a.n ? a : b
        const touches = gore === side && !a.twoWay && narrow.goreAt === (narrow === a ? 'start' : 'end') && narrow.sm.length < 200
        if (touches) {
          narrow.islandTo = true
          const held = anchor < 0 ? La : Ra
          // The lane opens out of the one beside it (or closes into it) over 20 m, at the island's end.
          if (narrow === b) {
            a.end = { left: anchor < 0 ? held : held - b.width, width: b.width, anchor, taper: 20 }
            b.start = { left: anchor < 0 ? held : held - b.width, width: b.width, anchor }
          } else b.start = { left: anchor < 0 ? held : held - a.width, width: a.width, anchor, taper: 20 }
          continue
        }
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
  return { junctions, gores, conts }
}

// ---- the carriageway along a half ------------------------------------------------------------------

/**
 * How much road a lane change or a slip road's lane has to open or close in (`room` on h.start / h.end): a
 * piece cut short a few metres on (by a crossing, another way, a lane count) does not squeeze it in there.
 * Into a junction the width may run on unfinished (the junction is paved to whatever edges meet it); into the next
 * piece of the same road, as wide and with no change of its own there, it is handed on as that one's start
 * (or end), `from` metres into the change; elsewhere it is done by the node. The held edge is back on the
 * road's own line within the piece the constraint was set on (`reach`), as before: a slip road held to its
 * parent's kerb does not drift off its own line for a long way. Runs after laneGraph, which
 * must see only the constraints rules() set.
 */
function handOn(halves, conts) {
  const same = (a, b) => a.n === b.n && a.twoWay === b.twoWay && Math.abs(a.width - b.width) < 0.01 && Math.abs(a.mid - b.mid) < 0.01
  for (const { a, b } of conts) if (same(a, b) && !a.end && !b.start) { a.next = b; b.prev = a }
  const L = (h) => (h.tags.highway && MAJOR.test(h.tags.highway) ? TAPER.fast : /^(primary|secondary)/.test(h.tags.highway) ? TAPER.city : TAPER.minor)
  for (const [at, on, trim] of [['start', 'next', 'trim1'], ['end', 'prev', 'trim0']]) {
    for (const h of halves) {
      if (!h[at] || h[at].from != null) continue
      const c = (h[at] = { ...h[at], taper: h[at].taper ?? L(h), from: 0 })
      const chain = [h]
      let d = h.sm.length
      for (let cur = h; d < Math.max(c.taper, SETTLE) && cur[on] && !cur[on][at]; cur = cur[on]) {
        cur[on][at] = { ...c, from: d }
        chain.push(cur[on])
        d += cur[on].sm.length
      }
      const last = chain[chain.length - 1]
      const room = d >= Math.max(c.taper, SETTLE) || last[trim] > 0 ? Infinity : d
      for (const p of chain) Object.assign(p[at], { room, reach: h.sm.length })
    }
  }
}

/** Left edge and width at every sample, honouring what the ends must meet. */
function profile(h) {
  const { sm } = h
  const L = h.tags.highway && MAJOR.test(h.tags.highway) ? TAPER.fast : /^(primary|secondary)/.test(h.tags.highway) ? TAPER.city : TAPER.minor
  const total = sm.length
  const base = { left: h.mid - h.width / 2, width: h.width }
  // A change is done by 0.6 of the room it has (the width: the road from where it begins to the next node where
  // something must meet the road's own width) and 0.8 of its reach (the held edge); see handOn. At most 1 m of
  // width per 2 m of road, however wide the change.
  const taperOf = (c) => Math.min(Math.max(c.taper ?? L, 3 * Math.abs(c.width - base.width)), (c.room ?? total) * 0.6)
  const settleOf = (c) => Math.min(SETTLE, (c.reach ?? total) * 0.8)
  const tS = h.start && taperOf(h.start), tE = h.end && taperOf(h.end)
  const settleS = h.start && settleOf(h.start), settleE = h.end && settleOf(h.end)
  const left = [], width = []
  for (let i = 0; i < sm.p.length; i++) {
    // how far from where each change begins (a change handed on from the piece before begins `from` metres before this one)
    const s = sm.s[i], sS = s + (h.start?.from ?? 0), sE = total - s + (h.end?.from ?? 0)
    let W = base.width, edgeS = null, edgeE = null
    if (h.start) W += (h.start.width - base.width) * (1 - smooth(sS / tS))
    if (h.end) W += (h.end.width - base.width) * (1 - smooth(sE / tE))
    // The edge that is held: where the end says, settling back to the line's middle slowly.
    if (h.start) {
      const held = h.start.anchor < 0 ? h.start.left : h.start.left + h.start.width
      const own = h.start.anchor < 0 ? base.left : base.left + base.width
      edgeS = { anchor: h.start.anchor, at: own + (held - own) * (1 - smooth(sS / settleS)) }
    }
    if (h.end) {
      const held = h.end.anchor < 0 ? h.end.left : h.end.left + h.end.width
      const own = h.end.anchor < 0 ? base.left : base.left + base.width
      edgeE = { anchor: h.end.anchor, at: own + (held - own) * (1 - smooth(sE / settleE)) }
    }
    const fromEdge = (e) => (e.anchor < 0 ? e.at : e.at - W)
    let l
    if (edgeS && edgeE) l = lerp(fromEdge(edgeS), fromEdge(edgeE), smooth(sS / (sS + sE)))
    else if (edgeS) l = fromEdge(edgeS)
    else if (edgeE) l = fromEdge(edgeE)
    else l = base.left
    left.push(l)
    width.push(W)
  }
  h.left = left
  h.W = width
  // The edge the lane lines are measured from: where a lane closes at the end, the edge held there (so the
  // line beside the closing lane stays on the asphalt to the end); else the one held at the start.
  h.anchorSide = (h.end && h.end.width < h.width - 0.1 ? h.end.anchor : null) ?? h.start?.anchor ?? h.end?.anchor ?? -1
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

/**
 * Moves a line (points in metres, every STEP) onto the white line painted nearest it on the photo: across
 * the line at each point, the middle of the narrowest run of paint (0.08-0.6 m wide, a painted line, not a
 * chevron's foot or a concrete lane) within 2.5 m, on the line's own side of the island; where such a line
 * was found at 3 or more of the 9 points round, the median of those; between such stretches the shift goes
 * over in a straight line, and holds past the last; then averaged over 5 points.
 * paint(lon, lat) -> true where the photo shows paint.
 */
/** How far across an island edge its painted line is looked for, either side, metres. */
const REACH = 3.5, INWARD = 3.5
function snapToPaint(pts, paint, P, other) {
  const n = pts.length
  const found = new Array(n).fill(null)
  const normals = pts.map((_, k) => {
    const a = pts[Math.max(0, k - 1)], b = pts[Math.min(n - 1, k + 1)], d = sub(b, a), l = len(d) || 1
    return [-d[1] / l, d[0] / l]
  })
  // Which side the island (the other edge) is on: this edge's line is looked for on its own side of it.
  let vote = 0
  for (let k = 0; k < n; k++) {
    if (!other[k]) continue
    const d = (other[k][0] - pts[k][0]) * normals[k][0] + (other[k][1] - pts[k][1]) * normals[k][1]
    if (Math.abs(d) > 0.3) vote += Math.sign(d)
  }
  const inward = Math.sign(vote) || 1
  for (let k = 0; k < n; k++) {
    const [nx, ny] = normals[k]
    let best = null
    let run = null
    for (let t = -REACH; t <= REACH + 0.01; t += 0.05) {
      const on = paint(...P.from([pts[k][0] + nx * t, pts[k][1] + ny * t]))
      if (on && run == null) run = t
      if ((!on || t > REACH) && run != null) {
        const w = t - run, c = (t + run) / 2
        if (w >= 0.08 && w <= 0.6 && c * inward <= INWARD && (best == null || Math.abs(c) < Math.abs(best))) best = c
        run = null
      }
    }
    found[k] = best == null ? null : { t: best }
  }
  const shift = found.map((f, k) => {
    const near = []
    for (let j = Math.max(0, k - 4); j <= Math.min(n - 1, k + 4); j++) if (found[j]) near.push(found[j].t)
    if (near.length < 3) return null
    near.sort((x, y) => x - y)
    return near[near.length >> 1]
  })
  const known = shift.map((v, k) => (v == null ? -1 : k)).filter((k) => k >= 0)
  if (!known.length) return
  for (let k = 0; k < n; k++) {
    if (shift[k] != null) continue
    const after = known.find((j) => j > k), before = known.findLast((j) => j < k)
    shift[k] = before == null ? shift[after] : after == null ? shift[before] : shift[before] + ((shift[after] - shift[before]) * (k - before)) / (after - before)
  }
  const even = shift.map((v, k) => {
    let sum = 0, c = 0
    for (let j = Math.max(0, k - 2); j <= Math.min(n - 1, k + 2); j++) if (shift[j] != null) { sum += shift[j]; c++ }
    return v == null || !c ? v : sum / c
  })
  for (let k = 0; k < n; k++) if (even[k] != null) pts[k] = [pts[k][0] + normals[k][0] * even[k], pts[k][1] + normals[k][1] * even[k]]
}

/**
 * Where the photo shows a road's lane lines, the road is put on them: along it, 30 m at a time, the paint
 * across it (0.1 m bins, some 4 m past each kerb) is summed into one profile - dashes add up into clear
 * peaks, specks do not - and the shift of the whole road and the width of its lanes that put its lines on
 * the most paint are found (shift within 2.5 m, lane 2.6-4.4 m). A one-way road is moved stretch by stretch
 * (the shifts in between drawn straight), its lanes given the width most stretches agree on; a two-way road
 * is moved and widened as one, both halves about the line between them. Where the profile shows no clear
 * lines (no better than three times what the lines would catch anywhere), the road stays as it was.
 */
function fitLanesToPaint(halves, paint, P) {
  const BIN = 0.1, WIN = 15
  const profile = (h, i0, i1, from, to) => {
    const n = Math.round((to - from) / BIN), out = new Float64Array(n)
    for (let i = i0; i <= i1; i++) for (let b = 0; b < n; b++) if (paint(...P.from(right(h.sm, i, h.left[i] + from + b * BIN)))) out[b]++
    // smoothed over 3 bins (a line is 0.1-0.3 m wide)
    return out.map((v, b) => (out[Math.max(0, b - 1)] + v + out[Math.min(n - 1, b + 1)]) / 3)
  }
  // Best (shift, lane width) for lines at these lane positions (k * width, from the profile's zero), weighted.
  const fit = (prof, from, ks, w0) => {
    const at = (o) => { const b = Math.round((o - from) / BIN); return b >= 0 && b < prof.length ? prof[b] : 0 }
    let best = null, total = 0, count = 0
    for (let w = Math.max(2.6, w0 - 0.9); w <= Math.min(4.4, w0 + 0.6); w += 0.05) {
      for (let d = -2.5; d <= 2.5; d += 0.1) {
        let s = 0
        for (const [k, wt] of ks) s += wt * at(d + k * w)
        total += s
        count++
        if (!best || s > best.s) best = { s, d, w }
      }
    }
    return best && best.s > 2.2 * (total / count) && best.s > 0 ? best : null
  }
  // Streets OSM gives no lanes for, drawn plain: where the photo shows a line down the middle, it is drawn,
  // the street put on it (not yards and service roads, whose paint is parking bays and the like).
  const PLAIN_LINED = /^(primary|secondary|tertiary|unclassified|residential)(_link)?$/
  const median = (v) => { const s = [...v].sort((a, b) => a - b); return s[s.length >> 1] }
  const done = new Set()
  const dbg = process.env.FIT_DEBUG ? (h, msg) => console.error(`fit ${h.seg.id} ${h.tags.highway} n=${h.n} len=${Math.round(h.sm.length)} ${msg}`) : () => {}
  for (const h of halves) {
    let seen = 0
    if (!h.left || done.has(h)) continue
    if (!h.known && h.twoWay && h.dir === 1 && h.sm.length >= 30 && PLAIN_LINED.test(h.tags.highway ?? '')) {
      const b = halves.find((o) => o.seg === h.seg && o.dir === -1)
      if (!b) continue
      done.add(h).add(b)
      const ds = []
      for (let s0 = 0; s0 < h.sm.length; s0 += WIN) {
        const i0 = idxAt(h.sm, s0), i1 = idxAt(h.sm, Math.min(h.sm.length, s0 + 2 * WIN))
        if (paint.covers && !paint.covers(...P.from(h.sm.p[idxAt(h.sm, s0 + WIN)]))) continue
        seen++
        const r = fit(profile(h, i0, i1, -4, 4), -4, [[0, 1]], h.w)
        if (r) ds.push(r.d)
      }
      if (ds.length < Math.max(1, Math.round(seen / 3))) { dbg(h, `plain: no middle line (${ds.length})`); continue }
      const d = median(ds)
      dbg(h, `plain: middle line, d=${d.toFixed(2)}`)
      for (const [x, sgn] of [[h, 1], [b, -1]]) {
        x.left = x.left.map((l) => l + sgn * d)
        x.known = true
      }
      continue
    }
    if (!h.known || h.sm.length < 20) { if (h.dir === 1 || !h.twoWay) dbg(h, h.known ? 'short' : 'no lanes in OSM'); continue }
    if (h.twoWay) {
      // Both halves as one: lines at the middle and every lane either side, in the forward half's frame.
      const f = h.dir === 1 ? h : halves.find((o) => o.seg === h.seg && o.dir === 1)
      const b = halves.find((o) => o.seg === h.seg && o.dir === -1)
      if (!f || !b) continue
      done.add(f).add(b)
      const ks = [[0, 1]]
      for (let k = 1; k <= f.n; k++) ks.push([k, k === f.n ? 0.5 : 1])
      for (let k = 1; k <= b.n; k++) ks.push([-k, k === b.n ? 0.5 : 1])
      const from = -(b.n * b.w + 4), to = f.n * f.w + 4
      const ds = [], ws = []
      for (let s0 = 0; s0 < f.sm.length; s0 += WIN) {
        const i0 = idxAt(f.sm, s0), i1 = idxAt(f.sm, Math.min(f.sm.length, s0 + 2 * WIN))
        if (paint.covers && !paint.covers(...P.from(f.sm.p[idxAt(f.sm, s0 + WIN)]))) continue
        seen++
        // relative to the line between the halves (the forward half's left edge)
        const prof = profile(f, i0, i1, from, to)
        const r = fit(prof, from, ks, f.w)
        if (r) { ds.push(r.d); ws.push(r.w) }
      }
      if (ds.length < Math.max(1, Math.round(seen / 3))) { dbg(f, `two-way: ${ds.length} stretches fit, too few`); continue }
      dbg(f, `two-way: ${ds.length} fit, d=${median(ds).toFixed(2)} w=${median(ws).toFixed(2)}`)
      const d = median(ds), w = median(ws)
      for (const [x, sgn] of [[f, 1], [b, -1]]) {
        x.left = x.left.map((l) => l + sgn * d)
        x.W = x.W.map((W) => W + x.n * (w - x.w))
        x.w = w
      }
      continue
    }
    done.add(h)
    const ks = []
    for (let k = 0; k <= h.n; k++) ks.push([k, k === 0 || k === h.n ? 0.5 : 1])
    const at = []
    for (let s0 = 0; s0 < h.sm.length; s0 += WIN) {
      const i0 = idxAt(h.sm, s0), i1 = idxAt(h.sm, Math.min(h.sm.length, s0 + 2 * WIN))
      if (paint.covers && !paint.covers(...P.from(h.sm.p[idxAt(h.sm, s0 + WIN)]))) continue
      seen++
      const prof = profile(h, i0, i1, -4, h.n * h.w + 4)
      const r = fit(prof, -4, ks, h.w)
      if (r) at.push({ s: Math.min(h.sm.length, s0 + WIN), d: r.d, w: r.w })
    }
    if (at.length < Math.max(1, Math.round(seen / 3))) { dbg(h, `one-way: ${at.length} stretches fit, too few`); continue }
    dbg(h, `one-way: ${at.length} fit, d=${median(at.map((a) => a.d)).toFixed(2)} w=${median(at.map((a) => a.w)).toFixed(2)}`)
    const w = median(at.map((a) => a.w))
    // One straight shift along it (a road is not wavy): fitted to the stretches, those 0.6 m off it left
    // out and fitted again; a short road (or too few stretches) just moved by their median.
    const line = (pts) => {
      const n = pts.length, sx = pts.reduce((v, p) => v + p.s, 0), sy = pts.reduce((v, p) => v + p.d, 0)
      const sxx = pts.reduce((v, p) => v + p.s * p.s, 0), sxy = pts.reduce((v, p) => v + p.s * p.d, 0)
      const den = n * sxx - sx * sx
      if (n < 3 || Math.abs(den) < 1e-6) return { a: median(pts.map((p) => p.d)), b: 0 }
      const b = (n * sxy - sx * sy) / den
      return { a: (sy - b * sx) / n, b }
    }
    let m = line(at)
    const kept = at.filter((p) => Math.abs(p.d - (m.a + m.b * p.s)) < 0.6)
    if (kept.length >= 2) m = line(kept)
    // never more than 2.5 m at either end
    const shiftAt = (s) => Math.max(-2.5, Math.min(2.5, m.a + m.b * s))
    h.left = h.left.map((l, i) => l + shiftAt(h.sm.s[i]))
    h.W = h.W.map((W) => W + h.n * (w - h.w))
    h.w = w
  }
}

/**
 * The lanes as a navigator knows them: each lane of each piece (numbered from the left, with the traffic)
 * and the lanes of the next piece it leads into, where a road goes on, parts or joins. Where a road goes on
 * with fewer lanes, the lane that ends leads into the one beside it on the side it ends on (the side the
 * rules chose: its turn lanes, its gore, else the right); with more, the new lane comes from the one beside
 * it. Where a slip road leaves, the lanes on its side go to it (or, with none of its own, the outermost one
 * also goes to it); where one joins, the mirror. Junctions are left to the turns (not linked here).
 * Returns the links and the lanes that come from nowhere or lead nowhere though their piece goes on.
 */
function laneGraph(halves, gores, conts) {
  const links = []
  const link = (a, i, b, j, kind = 'on') => links.push([a, i, b, j, kind])
  const linked = new Set() // nodes where pieces are linked lane by lane
  for (const { a, b } of conts) {
    linked.add(`${a.seg.id}:${a.dir}>`).add(`${b.seg.id}:${b.dir}<`)
    const anchor = b.start?.anchor ?? a.end?.anchor ?? -1
    const n = Math.min(a.n, b.n)
    // aligned from the edge that holds
    const ai = (j) => (anchor < 0 ? j : a.n - 1 - j), bi = (j) => (anchor < 0 ? j : b.n - 1 - j)
    for (let j = 0; j < n; j++) link(a, ai(j), b, bi(j))
    for (let j = n; j < a.n; j++) link(a, ai(j), b, bi(n - 1), 'ends') // ends: into the lane beside it
    for (let j = n; j < b.n; j++) link(a, ai(n - 1), b, bi(j), 'new') // new: from the lane beside it
  }
  for (const g of gores) {
    const { main: m, slip: r, side, nm } = g
    if (g.kind === 'diverge' && g.from) {
      const a = g.from
      linked.add(`${a.seg.id}:${a.dir}>`).add(`${m.seg.id}:${m.dir}<`).add(`${r.seg.id}:${r.dir}<`)
      // with the slip road to the right, the main road takes a's left lanes, the slip road the rest
      const am = (j) => (side > 0 ? j : a.n - nm + j), mi = (j) => (side > 0 ? j : m.n - nm + j)
      for (let j = 0; j < Math.min(nm, m.n); j++) link(a, am(j), m, mi(j))
      // a lane the main road gains (on the slip road's side) opens out of its lane nearest the slip road
      for (let j = nm; j < m.n; j++) link(a, am(side > 0 ? nm - 1 : 0), m, side > 0 ? j : m.n - 1 - j, 'new')
      // the slip road's lanes, counted from the main road's side: one more on either side than the
      // other opens out of (or closes into) the one beside it; with none of its own, a's outermost one
      const nr = a.n - nm
      const aOut = (k) => (nr ? (side > 0 ? nm + k : nr - 1 - k) : side > 0 ? a.n - 1 : 0), rOut = (k) => (side > 0 ? k : r.n - 1 - k)
      for (let j = 0; j < Math.max(r.n, nr); j++) link(a, aOut(Math.min(j, Math.max(nr, 1) - 1)), r, rOut(Math.min(j, r.n - 1)), 'leaves')
    } else if (g.kind === 'merge' && g.to) {
      const b = g.to
      linked.add(`${b.seg.id}:${b.dir}<`).add(`${m.seg.id}:${m.dir}>`).add(`${r.seg.id}:${r.dir}>`)
      const bm = (j) => (side > 0 ? j : b.n - nm + j), mi = (j) => (side > 0 ? j : m.n - nm + j)
      for (let j = 0; j < Math.min(nm, m.n); j++) link(m, mi(j), b, bm(j))
      // a lane the main road loses (on the slip road's side) closes into its lane nearest the slip road
      for (let j = nm; j < m.n; j++) link(m, side > 0 ? j : m.n - 1 - j, b, bm(side > 0 ? nm - 1 : 0), 'ends')
      const nr = b.n - nm
      const bOut = (k) => (nr ? (side > 0 ? nm + k : nr - 1 - k) : side > 0 ? b.n - 1 : 0), rOut = (k) => (side > 0 ? k : r.n - 1 - k)
      for (let j = 0; j < Math.max(r.n, nr); j++) link(r, rOut(Math.min(j, r.n - 1)), b, bOut(Math.min(j, Math.max(nr, 1) - 1)), 'joins')
    }
  }
  const hasOut = new Set(links.map(([a, i]) => `${a.seg.id}:${a.dir}:${i}`)), hasIn = new Set(links.map(([, , b, j]) => `${b.seg.id}:${b.dir}:${j}`))
  const broken = []
  for (const h of halves) {
    for (let k = 0; k < h.n; k++) {
      if (linked.has(`${h.seg.id}:${h.dir}>`) && !hasOut.has(`${h.seg.id}:${h.dir}:${k}`)) broken.push({ h, k, what: 'leads nowhere' })
      if (linked.has(`${h.seg.id}:${h.dir}<`) && !hasIn.has(`${h.seg.id}:${h.dir}:${k}`)) broken.push({ h, k, what: 'from nowhere' })
    }
  }
  return { links, broken }
}

export function buildRoads(ways, nodeTagsList, bbox, opts = {}) {
  const P = projector(bbox)
  for (const w of ways) w.xy = w.coords.map(P.to)
  const nodeTags = new Map(nodeTagsList.map((n) => [n.node, n.tags]))
  const roads = ways.filter((w) => w.tags.highway && w.tags.highway !== 'busway' && !w.tags['area:highway'] && w.tags.area !== 'yes' && w.tags.service !== 'parking_aisle' && w.tags.service !== 'driveway')
  const segs = split(roads)
  const halves = segs.flatMap(halvesOf)
  const { junctions, gores, conts } = rules(halves, nodeTags)
  // Where a road just goes on, its two pieces meet square to the same line, the bend's bisector (each
  // piece's tangents are smoothed over its own samples only): else each is cut square to its own end
  // and a bend there steps the kerbs apart by 2 x offset x sin(turn / 2).
  for (const { a, b } of conts) {
    const i = a.sm.t.length - 1, u = a.sm.t[i], v = b.sm.t[0], x = u[0] + v[0], y = u[1] + v[1], l = Math.hypot(x, y)
    if (l > 1e-6) a.sm.t[i] = b.sm.t[0] = [x / l, y / l]
  }
  const graph = laneGraph(halves, gores, conts)
  handOn(halves, conts)
  for (const h of halves) profile(h)
  // The islands and hatched areas mappers drew are drawn where they are on the ground: a
  // carriageway beside one takes its edge from it rather than from its lanes' width.
  const areas = ways.filter((w) => (w.tags['area:highway'] === 'traffic_island' || w.tags['area:highway'] === 'prohibited' || w.tags.traffic_calming === 'island') && w.nodes[0] === w.nodes[w.nodes.length - 1])
  fitToAreas(halves, areas.map((w) => w.xy))
  // With the photo to hand: each road moved and its lanes widened or narrowed to the lines painted on it.
  if (opts.paint) fitLanesToPaint(halves, opts.paint, P)

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
      // A corner is rounded only where the two kerbs, carried back toward the junction, meet behind both corners;
      // else (roads going straight on, or parting at a narrow angle) the kerb runs straight from one to the other.
      let Q = [(a.left[0] + b.right[0]) / 2, (a.left[1] + b.right[1]) / 2]
      if (Math.abs(den) > 0.15) {
        const w = sub(b.right, a.left)
        const t = (w[0] * b.d[1] - w[1] * b.d[0]) / den, u = (w[0] * a.d[1] - w[1] * a.d[0]) / den
        if (t < 1 && u < 1 && t > -40 && u > -40) Q = [a.left[0] + a.d[0] * t, a.left[1] + a.d[1] * t]
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
  for (const g of DRAW_GORES ? gores : []) {
    const { main, slip, side, kind } = g
    const mi = (s) => idxAt(main.sm, kind === 'diverge' ? s : main.sm.length - s)
    const si = (s) => idxAt(slip.sm, kind === 'diverge' ? s : slip.sm.length - s)
    // The island lies between the two roads' lanes: its edges are their edges, each road with its own lanes.
    const mEdge = (s) => { const i = mi(s); return right(main.sm, i, side > 0 ? main.left[i] + main.W[i] : main.left[i]) }
    const sEdge = (s) => { const i = si(s); return right(slip.sm, i, side > 0 ? slip.left[i] : slip.left[i] + slip.W[i]) }
    // How far it reaches: to where the two are 10 m apart (as the chevrons go on the photos). Past there the
    // ground is grass, the island (painted on the asphalt) ends, and each road's own edge goes on.
    const A = [], B = []
    for (let s = 0; s < Math.min(main.sm.length, 220); s += STEP) {
      if (len(sub(mEdge(s), sEdge(Math.min(s, slip.sm.length)))) > 10 && A.length > 3) break
      A.push(mEdge(s))
    }
    for (let s = 0; s < Math.min(slip.sm.length, 220); s += STEP) {
      if (len(sub(sEdge(s), mEdge(Math.min(s, main.sm.length)))) > 10 && B.length > 3) break
      B.push(sEdge(s))
    }
    if (A.length < 4 || B.length < 4) continue
    // With the photo to hand, each edge of the island goes onto the white line painted there; and the island
    // is looked for up the road they part from too (or down the one they make), its point often being before
    // OSM's fork (or past its join), both edges starting on the line between the two roads' lanes there.
    let before = 0
    if (opts.paint) {
      const c = g.from ?? g.to
      if (c?.ring) {
        const at = (i) => right(c.sm, i, side > 0 ? c.left[i] + g.nm * c.w : c.left[i] + c.W[i] - g.nm * c.w)
        for (let d = STEP; d < 30 && d < c.sm.length; d += STEP) {
          const p = at(idxAt(c.sm, g.from ? c.sm.length - d : d))
          A.unshift(p)
          B.unshift(p)
          before++
        }
      }
      snapToPaint(A, opts.paint, P, B)
      snapToPaint(B, opts.paint, P, A)
    }
    // Where the lanes still run side by side (under 1.5 m apart; before the fork or past the join on the
    // photo, 2.5 m: a lane line and a solid one), only a solid line keeps them apart; the island's point is
    // where they draw apart for good (looked for only up to where it is first 2 m wide).
    const pair = Math.min(A.length, B.length)
    let tipAt = 0
    const wideAt = A.slice(0, pair).findIndex((a, k) => k >= before && len(sub(a, B[k])) >= 2)
    for (let k = 0; k < (wideAt < 0 ? pair : wideAt); k++) if (len(sub(A[k], B[k])) < (k < before && opts.paint ? 2.5 : 1.5)) tipAt = k
    if (pair - tipAt < 4) continue
    if (tipAt > 0) {
      const mids = A.slice(0, tipAt + 1).map((a, k) => [(a[0] + B[k][0]) / 2, (a[1] + B[k][1]) / 2])
      feat('lane-line', line(mids), { layer: 0, dash: 'solid' })
      A.splice(0, tipAt)
      B.splice(0, tipAt)
    }
    const n = Math.min(A.length, B.length)
    // An island only widens from its point (no waist in it, the two edges never crossing): measured across
    // the road, signed, where it would come in again it keeps the width it had, each side giving half.
    const across = A.slice(0, n).map((_, k) => {
      const p = A[Math.max(0, k - 1)], q = A[Math.min(n - 1, k + 1)], d = sub(q, p), l = len(d) || 1
      return [-d[1] / l, d[0] / l]
    })
    const towards = Math.sign(across.reduce((v, c, k) => v + (B[k][0] - A[k][0]) * c[0] + (B[k][1] - A[k][1]) * c[1], 0)) || 1
    for (let k = 1, wMax = 0; k < n; k++) {
      const d = [across[k][0] * towards, across[k][1] * towards]
      const w = (B[k][0] - A[k][0]) * d[0] + (B[k][1] - A[k][1]) * d[1]
      if (w < wMax) {
        const push = (wMax - w) / 2
        A[k] = [A[k][0] - d[0] * push, A[k][1] - d[1] * push]
        B[k] = [B[k][0] + d[0] * push, B[k][1] + d[1] * push]
      } else wMax = w
    }
    // Its point: where the two edges meet, a little short of the first pair, so it is sharp.
    const tip = [(A[0][0] + B[0][0]) / 2, (A[0][1] + B[0][1]) / 2]
    const ahead = sub(tip, [(A[2][0] + B[2][0]) / 2, (A[2][1] + B[2][1]) / 2]), al = len(ahead) || 1
    const point = [tip[0] + (ahead[0] / al) * len(sub(A[0], B[0])) * 1.5, tip[1] + (ahead[1] / al) * len(sub(A[0], B[0])) * 1.5]
    A.unshift(point)
    B.unshift(point)
    // Before the point (with the traffic where roads part, after it where they meet) a short solid line.
    if (tipAt === 0) feat('lane-line', line([point, [point[0] + (ahead[0] / al) * 15, point[1] + (ahead[1] / al) * 15]]), { layer: 0, dash: 'solid' })
    const pts = [...A, ...B]
    const box = [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))]
    // Where mappers drew the hatching or island here, theirs is the shape: the wedge is only paved, so no gap shows round theirs.
    const paved = areaBoxes.some((b) => b[0] < box[2] && b[2] > box[0] && b[1] < box[3] && b[3] > box[1])
    if (!paved) {
      // Its two edges, solid lines from the point to where each ends; open beyond (no line across).
      feat('lane-line', line(A), { layer: 0, dash: 'solid' })
      feat('lane-line', line(B), { layer: 0, dash: 'solid' })
      // Chevrons: a V every few metres, its point up the road against the traffic, its arms out to the two
      // edges further on (A and B run from the point: with the traffic where roads part, against it where they meet).
      const down = kind === 'diverge' ? 1 : -1
      const m = Math.min(A.length, B.length)
      for (let k = 0; k < m; k += CHEVRON / STEP) {
        const gap = len(sub(A[k], B[k]))
        if (gap < 0.8) continue
        const j = k + down * Math.max(1, Math.round(gap / 2 / STEP))
        if (j < 0 || j >= m) continue
        const M = [(A[k][0] + B[k][0]) / 2, (A[k][1] + B[k][1]) / 2]
        const inset = (P, Q) => { const d = sub(Q, P), l = len(d) || 1; return [P[0] + (d[0] / l) * 0.3, P[1] + (d[1] / l) * 0.3] }
        feat('chevron', line([inset(A[j], B[j]), M, inset(B[j], A[j])]), { layer: 0 })
      }
    }
    // The island: from its point along one edge to its end, across, and back along the other.
    feat('gore', poly([...A, ...[...B].reverse()]), { layer: 0, side, how: kind, paved, open: !paved, edge: A.length })
  }

  // The islands and hatched areas mappers drew.
  for (const w of ways) {
    const t = w.tags
    const isl = t['area:highway'] === 'traffic_island' || t.traffic_calming === 'island'
    const hatch = t['area:highway'] === 'prohibited'
    if ((!isl && !hatch) || w.nodes[0] !== w.nodes[w.nodes.length - 1]) continue
    feat(hatch ? 'hatch' : 'island', { type: 'Polygon', coordinates: [w.coords] }, { grass: t.surface === 'grass' || t.landuse === 'grass' })
  }
  const fc = { type: 'FeatureCollection', features: F }
  // On request (the bench): the lanes that come from nowhere or lead nowhere, where.
  if (opts.laneGraph) {
    // Where the drawing breaks: the kerbs of one piece and the next (or of a road and the pieces it parts
    // into or joins from) more than 0.6 m apart where they meet; a piece's width jumping by over 1 m in 2 m.
    const edge = (h, i, which) => right(h.sm, i, which === 'L' ? h.left[i] : h.left[i] + h.W[i])
    const last = (h) => h.sm.p.length - 1
    const steps = []
    // only roads whose lanes are known, and not yards: a plain street meeting another class is as wide as its class
    const counted = (h) => h.known && !/^(service|living_street|track|pedestrian)$/.test(h.tags.highway)
    const step = (p, q, what, ...hs) => { const d = len(sub(p, q)); if (d > 0.6 && hs.every(counted)) steps.push({ what: `${what} (${hs.map((h) => h.tags.highway).join('/')})`, d: Math.round(d * 10) / 10, at: P.from(p) }) }
    for (const { a, b } of conts) {
      if (!a.left || !b.left || a.trim1 > 0 || b.trim0 > 0) continue
      step(edge(a, last(a), 'L'), edge(b, 0, 'L'), `left kerb steps between ${a.seg.id} and ${b.seg.id}`, a, b)
      step(edge(a, last(a), 'R'), edge(b, 0, 'R'), `right kerb steps between ${a.seg.id} and ${b.seg.id}`, a, b)
    }
    for (const g of gores) {
      const { main: m, slip: r, side } = g
      if (g.kind === 'diverge' && g.from?.left && m.left && r.left) {
        const a = g.from
        step(edge(a, last(a), side > 0 ? 'L' : 'R'), edge(m, 0, side > 0 ? 'L' : 'R'), `main road's kerb steps where ${r.seg.id} leaves ${a.seg.id}`, a, m)
        // (a slip road with no lane of its own starts beside the road, a lane out: no step there)
        if (g.nm < a.n) step(edge(a, last(a), side > 0 ? 'R' : 'L'), edge(r, 0, side > 0 ? 'R' : 'L'), `slip road's kerb steps where ${r.seg.id} leaves ${a.seg.id}`, a, r)
      } else if (g.kind === 'merge' && g.to?.left && m.left && r.left) {
        const b = g.to
        step(edge(m, last(m), side > 0 ? 'L' : 'R'), edge(b, 0, side > 0 ? 'L' : 'R'), `main road's kerb steps where ${r.seg.id} joins ${b.seg.id}`, m, b)
        if (g.nm < b.n) step(edge(r, last(r), side > 0 ? 'R' : 'L'), edge(b, 0, side > 0 ? 'R' : 'L'), `slip road's kerb steps where ${r.seg.id} joins ${b.seg.id}`, r, b)
      }
    }
    for (const h of halves) {
      if (!h.W || !counted(h)) continue
      for (let i = 1; i < h.W.length; i++) {
        if (Math.abs(h.W[i] - h.W[i - 1]) > 1) { steps.push({ what: `width jumps ${h.W[i - 1].toFixed(1)} to ${h.W[i].toFixed(1)} m on ${h.seg.id}`, d: Math.abs(h.W[i] - h.W[i - 1]), at: P.from(h.sm.p[i]) }); break }
      }
    }
    fc.steps = steps
    const id = (h) => `${h.seg.id}:${h.dir}`
    fc.laneGraph = {
      // every lane's middle, and which lanes each leads into
      lanes: Object.fromEntries(halves.filter((h) => h.left).map((h) => [id(h), Array.from({ length: h.n }, (_, k) => h.sm.p.map((_, i) => P.from(right(h.sm, i, h.left[i] + (k + 0.5) * (h.W[i] / h.n)))).filter((_, i, all) => i % 3 === 0 || i === all.length - 1))])),
      edges: graph.links.map(([x, i, y, j, kind]) => [id(x), i, id(y), j, kind]),
      links: graph.links.length,
      broken: graph.broken.map(({ h, k, what }) => ({ what, way: h.seg.id, lane: k, of: h.n, highway: h.tags.highway, at: P.from(what === 'leads nowhere' ? h.pts[h.pts.length - 1] : h.pts[0]) })),
    }
  }
  return fc
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
    // Eased in and out: an edge leaves its lanes' line, or goes from one area's kerb to another's, by at
    // most EASE m per m along the road, so where an area begins, ends or goes out of reach the kerb turns
    // instead of stepping; and at an end of the piece where no area was found it is back on its lanes' line,
    // where the next piece meets it.
    const ease = (fit, base) => {
      const E = smooth5(fit, base)
      const up = E.map((v, i) => Math.max(v - base[i], 0)), dn = E.map((v, i) => Math.min(v - base[i], 0))
      for (let i = 1; i < n; i++) { const g = EASE * (sm.s[i] - sm.s[i - 1]); up[i] = Math.max(up[i], up[i - 1] - g); dn[i] = Math.min(dn[i], dn[i - 1] + g) }
      for (let i = n - 2; i >= 0; i--) { const g = EASE * (sm.s[i + 1] - sm.s[i]); up[i] = Math.max(up[i], up[i + 1] - g); dn[i] = Math.min(dn[i], dn[i + 1] + g) }
      const cap = (i) => Math.min(fit[0] === null ? EASE * sm.s[i] : Infinity, fit[n - 1] === null ? EASE * (sm.s[n - 1] - sm.s[i]) : Infinity)
      return base.map((v, i) => v + Math.min(up[i], cap(i)) + Math.max(dn[i], -cap(i)))
    }
    const L2 = ease(fitL, L), R2 = ease(fitR, R)
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

