/**
 * Roofs over a building's outline, from the shape its mappers give (OpenStreetMap's roof:shape, as
 * Overture carries it). Roofs of sloping planes, gabled, hipped and the like, are laid over the
 * outline's smallest enclosing rectangle; roofs that rise to a point or a dome are made by drawing
 * the outline again, smaller and higher, towards its middle. Plain geometry in metres: x east,
 * y north, z up, every outline a flat list of x, y.
 */
import earcut from 'earcut'

/** A plane over the ground: z = a x + b y + c. */
export type Plane = [number, number, number]

/** A roof's surface, and the planes whose lowest gives its height over the outline: where the walls stop. */
export interface Roof {
  /** x, y, z per corner. */
  positions: number[]
  /** Corners of the triangles, three by three. */
  triangles: number[]
  planes: Plane[]
}

/** The outline's smallest enclosing rectangle, turned so that u runs along the ridge and v across it. */
export interface Frame {
  centre: [number, number]
  u: [number, number]
  /** Across the ridge; for a roof of one slope, and wherever a direction is mapped, the way the roof faces, downhill. */
  v: [number, number]
  /** Half the rectangle's length along u, and its width along v, in metres. */
  halfLength: number
  halfWidth: number
  /** How much of the rectangle the outline covers, 0..1. */
  fill: number
}

/** Below this share of its rectangle an outline is too far from a box for planes laid over the box to look like its roof. */
const MIN_FILL = 0.7

/** Signed area and area-weighted centre of a ring in a flat x, y list, from one point to before another. Positive runs anticlockwise. */
export function ringShape(flat: number[], from: number, to: number): [number, number, number] {
  let area = 0
  let x = 0
  let y = 0
  for (let i = from, j = to - 1; i < to; j = i++) {
    const cross = flat[2 * j] * flat[2 * i + 1] - flat[2 * i] * flat[2 * j + 1]
    area += cross
    x += (flat[2 * j] + flat[2 * i]) * cross
    y += (flat[2 * j + 1] + flat[2 * i + 1]) * cross
  }
  return [area / 2, x / (3 * area), y / (3 * area)]
}

function contains(flat: number[], x: number, y: number): boolean {
  let inside = false
  for (let i = 0, j = flat.length - 2; i < flat.length; j = i, i += 2) {
    const [xi, yi, xj, yj] = [flat[i], flat[i + 1], flat[j], flat[j + 1]]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

function convexHull(flat: number[]): [number, number][] {
  const points: [number, number][] = []
  for (let i = 0; i < flat.length; i += 2) points.push([flat[i], flat[i + 1]])
  points.sort((p, q) => p[0] - q[0] || p[1] - q[1])
  // Andrew's monotone chain: the lower half left to right, then the upper half back.
  const half = (list: [number, number][]) => {
    const chain: [number, number][] = []
    for (const p of list) {
      while (chain.length >= 2) {
        const [o, a] = [chain[chain.length - 2], chain[chain.length - 1]]
        if ((a[0] - o[0]) * (p[1] - o[1]) - (a[1] - o[1]) * (p[0] - o[0]) > 0) break
        chain.pop()
      }
      chain.push(p)
    }
    chain.pop()
    return chain
  }
  return [...half(points), ...half(points.slice().reverse())]
}

/**
 * The frame a roof is laid in. The ridge runs along the rectangle's long side, or across it where
 * the mappers say so. A mapped direction is the way the roof faces, as in OpenStreetMap, so the
 * ridge runs at right angles to it; it picks the rectangle's nearer side rather than turning the
 * roof off the walls, as mappers give it to the nearest few degrees or the nearest compass point.
 */
export function roofFrame(outline: number[], orientation: unknown, direction: unknown): Frame | null {
  // The smallest rectangle has a side along a side of the hull. ponytail: every side is tried
  // against every corner, which is quadratic in the hull's corners; buildings have few.
  const hull = convexHull(outline)
  let best: { area: number; a: [number, number]; lows: [number, number]; highs: [number, number] } | null = null
  for (let i = 0; i < hull.length; i++) {
    const [p, q] = [hull[i], hull[(i + 1) % hull.length]]
    const length = Math.hypot(q[0] - p[0], q[1] - p[1])
    if (length < 1e-6) continue
    const a: [number, number] = [(q[0] - p[0]) / length, (q[1] - p[1]) / length]
    const lows: [number, number] = [Infinity, Infinity]
    const highs: [number, number] = [-Infinity, -Infinity]
    for (const [x, y] of hull) {
      const along = x * a[0] + y * a[1]
      const across = y * a[0] - x * a[1]
      lows[0] = Math.min(lows[0], along)
      highs[0] = Math.max(highs[0], along)
      lows[1] = Math.min(lows[1], across)
      highs[1] = Math.max(highs[1], across)
    }
    const area = (highs[0] - lows[0]) * (highs[1] - lows[1])
    if (!best || area < best.area) best = { area, a, lows, highs }
  }
  if (!best) return null
  const { a, lows, highs } = best
  const b: [number, number] = [-a[1], a[0]]
  const [middleA, middleB] = [(lows[0] + highs[0]) / 2, (lows[1] + highs[1]) / 2]
  const centre: [number, number] = [a[0] * middleA + b[0] * middleB, a[1] * middleA + b[1] * middleB]
  let [u, halfLength, v, halfWidth] = [a, (highs[0] - lows[0]) / 2, b, (highs[1] - lows[1]) / 2]
  if (halfWidth > halfLength) [u, halfLength, v, halfWidth] = [v, halfWidth, u, halfLength]
  if (typeof direction === 'number' && Number.isFinite(direction)) {
    // A bearing: clockwise from north.
    const facing = [Math.sin((direction * Math.PI) / 180), Math.cos((direction * Math.PI) / 180)]
    const dot = (axis: [number, number]) => axis[0] * facing[0] + axis[1] * facing[1]
    if (Math.abs(dot(u)) > Math.abs(dot(v))) [u, halfLength, v, halfWidth] = [v, halfWidth, u, halfLength]
    if (dot(v) < 0) v = [-v[0], -v[1]]
  } else if (orientation === 'across') {
    ;[u, halfLength, v, halfWidth] = [v, halfWidth, u, halfLength]
  }
  if (!(halfWidth > 0.25 && halfLength > 0.25)) return null
  return { centre, u, v, halfLength, halfWidth, fill: Math.abs(ringShape(outline, 0, outline.length / 2)[0]) / (4 * halfLength * halfWidth) }
}

/**
 * The sloping planes of a roof over its frame. Each rises from one side of the rectangle: z = wall
 * top + rise · distance in from that side + lift, and the roof is the lowest of them over every
 * point, so the creases and the ridge fall where two planes meet.
 */
function planesOf(shape: string, frame: Frame, wallTop: number, height: number): Plane[] | null {
  const { centre, u, v, halfLength, halfWidth } = frame
  const side = (n: [number, number], half: number, rise: number, lift: number): Plane => [-rise * n[0], -rise * n[1], wallTop + lift + rise * (half + n[0] * centre[0] + n[1] * centre[1])]
  const across = (rise: number, lift = 0) => [side(v, halfWidth, rise, lift), side([-v[0], -v[1]], halfWidth, rise, lift)]
  const along = (rise: number, lift = 0) => [side(u, halfLength, rise, lift), side([-u[0], -u[1]], halfLength, rise, lift)]
  // Hips and mansards slope alike on every side, so the shorter half reaches the top.
  const shorter = Math.min(halfLength, halfWidth)
  switch (shape) {
    case 'gabled':
      return across(height / halfWidth)
    case 'hipped':
      return [...across(height / shorter), ...along(height / shorter)]
    case 'half_hipped':
      // A gable whose top half is hipped back.
      return [...across(height / halfWidth), ...along(height / halfWidth, height / 2)]
    case 'skillion':
      return [side(v, halfWidth, height / (2 * halfWidth), 0)]
    case 'saltbox':
      // A long slope facing v, a short steep one behind: the ridge a third of the way across.
      return [side(v, halfWidth, (3 * height) / (4 * halfWidth), 0), side([-v[0], -v[1]], halfWidth, (3 * height) / (2 * halfWidth), 0)]
    case 'gambrel':
      // Steep from the eaves to two thirds of the height halfway in, then shallow to the ridge.
      return [...across((4 * height) / (3 * halfWidth)), ...across((2 * height) / (3 * halfWidth), height / 3)]
    case 'mansard':
      // Steep on every side to three quarters of the height a third of the way in, then nearly flat.
      return [...across((9 * height) / (4 * shorter)), ...along((9 * height) / (4 * shorter)), ...across((3 * height) / (8 * shorter), (5 * height) / 8), ...along((3 * height) / (8 * shorter), (5 * height) / 8)]
    case 'round': {
      // OpenStreetMap's round is a barrel vault: a half circle across, made of chords every 15 degrees.
      const planes: Plane[] = []
      for (let k = 0; k < 6; k++) {
        const [from, to] = [(k * Math.PI) / 12, ((k + 1) * Math.PI) / 12]
        const [inFrom, inTo] = [halfWidth * (1 - Math.cos(from)), halfWidth * (1 - Math.cos(to))]
        const rise = (height * (Math.sin(to) - Math.sin(from))) / (inTo - inFrom)
        planes.push(...across(rise, height * Math.sin(from) - rise * inFrom))
      }
      return planes
    }
    default:
      return null
  }
}

/** For roofs drawn as rings: each ring's size against the outline's (0: a point) and its height as a share of the roof's. */
function ringsOf(shape: string): [number, number][] | null {
  switch (shape) {
    case 'pyramidal':
    case 'cone':
      return [[0, 1]]
    case 'dome':
    case 'spherical':
      return [1, 2, 3, 4, 5].map((k): [number, number] => [Math.cos((k * Math.PI) / 12), Math.sin((k * Math.PI) / 12)]).concat([[0, 1]])
    case 'onion':
      // Swelling out past the walls, then drawn in to a point.
      return [
        [1.15, 0.12],
        [1.25, 0.3],
        [1.15, 0.5],
        [0.8, 0.68],
        [0.4, 0.82],
        [0.12, 0.93],
        [0, 1],
      ]
    default:
      return null
  }
}

/** The part of a polygon where a x + b y + c is at most 0: Sutherland and Hodgman's clip against one line. */
function clip(flat: number[], [a, b, c]: Plane): number[] {
  const out: number[] = []
  for (let i = 0; i < flat.length; i += 2) {
    const j = (i + 2) % flat.length
    const here = a * flat[i] + b * flat[i + 1] + c
    const next = a * flat[j] + b * flat[j + 1] + c
    if (here <= 0) out.push(flat[i], flat[i + 1])
    if ((here < 0 && next > 0) || (here > 0 && next < 0)) {
      const t = here / (here - next)
      out.push(flat[i] + t * (flat[j] - flat[i]), flat[i + 1] + t * (flat[j + 1] - flat[i + 1]))
    }
  }
  return out
}

/** A flat roof at one height, holes and all. */
export function flatRoof(flat: number[], holes: number[], z: number): Roof {
  const positions: number[] = []
  for (let i = 0; i < flat.length; i += 2) positions.push(flat[i], flat[i + 1], z)
  return { positions, triangles: earcut(flat, holes), planes: [[0, 0, z]] }
}

/**
 * A roof of the mapped shape over an outline without holes, from its walls' top up by its height;
 * null where the shape is not one known here or does not fit the outline, for a flat roof instead.
 */
export function pitchedRoof(outline: number[], frame: Frame, shape: string, wallTop: number, height: number): Roof | null {
  // A single plane suits any outline.
  if (!(height > 0.1) || (frame.fill < MIN_FILL && shape !== 'skillion')) return null
  const rings = ringsOf(shape)
  if (rings) {
    const [area, cx, cy] = ringShape(outline, 0, outline.length / 2)
    // Drawn in towards a middle outside the outline, the rings would cross its walls.
    if (!contains(outline, cx, cy)) return null
    const count = outline.length / 2
    const positions: number[] = []
    for (let i = 0; i < outline.length; i += 2) positions.push(outline[i], outline[i + 1], wallTop)
    const triangles: number[] = []
    // Seen from above, each ring's faces run anticlockwise like an anticlockwise outline's.
    const triangle = (a: number, b: number, c: number) => (area > 0 ? triangles.push(a, b, c) : triangles.push(a, c, b))
    let below = 0
    for (const [size, rise] of rings) {
      const above = positions.length / 3
      if (size === 0) {
        positions.push(cx, cy, wallTop + height)
        for (let i = 0; i < count; i++) triangle(below + i, below + ((i + 1) % count), above)
        break
      }
      for (let i = 0; i < outline.length; i += 2) positions.push(cx + size * (outline[i] - cx), cy + size * (outline[i + 1] - cy), wallTop + rise * height)
      for (let i = 0; i < count; i++) {
        const j = (i + 1) % count
        triangle(below + i, below + j, above + j)
        triangle(below + i, above + j, above + i)
      }
      below = above
    }
    return { positions, triangles, planes: [[0, 0, wallTop]] }
  }

  const planes = planesOf(shape, frame, wallTop, height)
  if (!planes) return null
  // Each plane roofs the part of the outline where it is the lowest, cut out by one line per other
  // plane. An outline that is not convex, clipped whole, comes out as pieces joined along the cut,
  // and earcut fills across the gap between them; so the outline's own triangles are clipped
  // instead. A triangle cut by lines stays convex, and turned as earcut turned it, anticlockwise,
  // so a fan from its first corner fills it.
  const positions: number[] = []
  const triangles: number[] = []
  const corners = earcut(outline)
  for (let t = 0; t < corners.length; t += 3) {
    const triangle = [corners[t], corners[t + 1], corners[t + 2]].flatMap((c) => [outline[2 * c], outline[2 * c + 1]])
    for (const own of planes) {
      let piece = triangle
      for (const other of planes) if (other !== own && piece.length >= 6) piece = clip(piece, [own[0] - other[0], own[1] - other[1], own[2] - other[2]])
      if (piece.length < 6) continue
      const first = positions.length / 3
      for (let i = 0; i < piece.length; i += 2) positions.push(piece[i], piece[i + 1], own[0] * piece[i] + own[1] * piece[i + 1] + own[2])
      for (let c = first + 2; c < positions.length / 3; c++) triangles.push(first, c - 1, c)
    }
  }
  return { positions, triangles, planes }
}

/**
 * Where a wall from a to b stops under a roof: s, z pairs from a (s = 0) to b (s = 1). The wall
 * bends up or down wherever two of the roof's planes cross over it, so a gable end rises to the
 * ridge this way.
 */
export function wallTop(planes: Plane[], ax: number, ay: number, bx: number, by: number): number[] {
  const z = (plane: Plane, s: number) => plane[0] * (ax + s * (bx - ax)) + plane[1] * (ay + s * (by - ay)) + plane[2]
  if (planes.length === 1) return [0, z(planes[0], 0), 1, z(planes[0], 1)]
  const lowest = (s: number) => Math.min(...planes.map((plane) => z(plane, s)))
  const stops = [0, 1]
  for (let i = 0; i < planes.length; i++) {
    for (let j = i + 1; j < planes.length; j++) {
      const before = z(planes[i], 0) - z(planes[j], 0)
      const after = z(planes[i], 1) - z(planes[j], 1)
      if (before * after >= 0) continue
      const s = before / (before - after)
      // Only a crossing on the roof itself, where both planes are the lowest.
      if (z(planes[i], s) - lowest(s) < 1e-6) stops.push(s)
    }
  }
  return stops.sort((p, q) => p - q).flatMap((s) => [s, lowest(s)])
}
