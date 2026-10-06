import { type Ring, plainText } from './zones'

/**
 * Reads the "lateral limits" of restricted, danger and reserved areas out of Latvia's
 * electronic AIP (ENR 5.1 and 5.2). Only the baking script uses this: the outlines change
 * with the AIP cycle, every few weeks at most, and are committed as data.
 */
export interface AipArea {
  id: string
  name: string
  /** Null when the limits follow a line this code has no data for, such as the edge of the territorial sea. */
  ring: Ring | null
}

const RAD = Math.PI / 180
/** How far a corner may sit from the nearest point of the baked border and still count as being on it, in degrees. */
const ON_BORDER_DEG = 0.08

const POSITION = /(\d{2})(\d{2})(\d{2})N\s?(\d{3})(\d{2})(\d{2})E/
/** The pieces a limit is written in, in the order they come: a circle, an arc, a stretch of border, a plain corner. */
const STEPS =
  /circle radius [\d.]+ NM cent(?:er|re)ed on \d{6}N\s?\d{7}E|(?:counter-)?clockwise arc[^–-]*?\d{6}N\s?\d{7}E|along\b[^0-9]*?(?:territorial waters|boundary|border)|\d{6}N\s?\d{7}E/gi

/** "560425N0254441E" as [lon, lat]. */
function position(text: string): [number, number] {
  const [, latD, latM, latS, lonD, lonM, lonS] = POSITION.exec(text)!.map(Number)
  return [lonD + lonM / 60 + lonS / 3600, latD + latM / 60 + latS / 3600]
}

/** Flat-map distance in degrees of latitude: these are all short hops at one latitude. */
function gap(a: readonly number[], b: readonly number[]): number {
  return Math.hypot((a[0] - b[0]) * Math.cos(a[1] * RAD), a[1] - b[1])
}

function circle(centre: [number, number], radiusNm: number): Ring {
  const ring: Ring = []
  // One nautical mile is one minute of latitude.
  const radius = radiusNm / 60
  for (let i = 0; i <= 32; i++) {
    const angle = (i / 32) * 2 * Math.PI
    ring.push([centre[0] + (radius * Math.cos(angle)) / Math.cos(centre[1] * RAD), centre[1] + radius * Math.sin(angle)])
  }
  return ring
}

/** The points of an arc around `centre` between two corners, the corners themselves left out. */
function arc(centre: [number, number], from: [number, number], to: [number, number], counterClockwise: boolean): Ring {
  const squeeze = Math.cos(centre[1] * RAD)
  const polar = ([lon, lat]: [number, number]) => ({
    radius: Math.hypot((lon - centre[0]) * squeeze, lat - centre[1]),
    angle: Math.atan2(lat - centre[1], (lon - centre[0]) * squeeze),
  })
  const start = polar(from)
  const end = polar(to)
  // With north up and east to the right, counter-clockwise is the way angles grow.
  let sweep = end.angle - start.angle
  if (counterClockwise && sweep <= 0) sweep += 2 * Math.PI
  if (!counterClockwise && sweep >= 0) sweep -= 2 * Math.PI

  const steps = Math.ceil(Math.abs(sweep) / (10 * RAD))
  const points: Ring = []
  for (let i = 1; i < steps; i++) {
    const angle = start.angle + (sweep * i) / steps
    // The two corners are rarely at exactly the stated radius: ease from one to the other so the arc meets both.
    const radius = start.radius + ((end.radius - start.radius) * i) / steps
    points.push([centre[0] + (radius * Math.cos(angle)) / squeeze, centre[1] + radius * Math.sin(angle)])
  }
  return points
}

/** The stretch of the national border between two corners, the shorter way round. Null if either is not on it. */
function alongBorder(border: Ring, from: [number, number], to: [number, number]): Ring | null {
  // A closed ring names its first point twice.
  const points = border.slice(0, -1)
  const nearest = (corner: [number, number]) => points.reduce((best, point, i) => (gap(point, corner) < gap(points[best], corner) ? i : best), 0)
  const a = nearest(from)
  const b = nearest(to)
  if (gap(points[a], from) > ON_BORDER_DEG || gap(points[b], to) > ON_BORDER_DEG) return null

  const walk = (step: 1 | -1) => {
    const path: Ring = [points[a]]
    for (let i = a; i !== b; ) {
      i = (i + step + points.length) % points.length
      path.push(points[i])
    }
    return path
  }
  const length = (path: Ring) => path.slice(1).reduce((sum, point, i) => sum + gap(path[i], point), 0)
  const [forward, backward] = [walk(1), walk(-1)]
  return length(forward) <= length(backward) ? forward : backward
}

/**
 * An outline from the AIP's "standardised presentation of the airspace lateral limits":
 * corners joined by straight lines, with arcs, whole circles and stretches of the state
 * border in between. `border` is Latvia's outline as a closed ring of [lon, lat].
 */
export function parseLateralLimits(limits: string, border: Ring): Ring | null {
  const ring: Ring = []
  /** Fills in the stretch between the last corner and the next one, when it is not a straight line. */
  let stretch: ((to: [number, number]) => Ring | null) | null = null

  const corner = (at: [number, number]): boolean => {
    const between = stretch ? stretch(at) : []
    stretch = null
    if (!between) return false
    ring.push(...between, at)
    return true
  }

  for (const [step] of limits.matchAll(STEPS)) {
    if (/^circle/i.test(step)) return circle(position(step), Number(/radius ([\d.]+)/i.exec(step)![1]))

    const last = ring[ring.length - 1]
    if (/^along/i.test(step)) {
      if (!last || /waters/i.test(step)) return null
      stretch = (to) => alongBorder(border, last, to)
    } else if (/arc/i.test(step)) {
      if (!last) return null
      const centre = position(step)
      const counterClockwise = /^counter/i.test(step)
      stretch = (to) => arc(centre, last, to, counterClockwise)
    } else if (!corner(position(step))) {
      return null
    }
  }
  // Limits that end on a border or an arc run back to where they started.
  if (stretch && ring.length > 0 && !corner(ring[0])) return null
  return ring.length >= 3 ? ring : null
}

const FIRST_CELL = /<tr[\s>][\s\S]*?<td[^>]*>([\s\S]*?)<\/td>/g
const AREA =
  /^(EV[A-Z]+\d+[A-Z0-9]*)\s*(.*?)\s*(?:Lateral limits are available.*?)?Standardised presentation of the airspace lateral limits:\s*(.*)$/

/** Every area in one AIP page. The first cell of a table row holds the designator, the name and the limits. */
export function parseAipAreas(html: string, border: Ring): AipArea[] {
  const areas: AipArea[] = []
  for (const [, cell] of html.matchAll(FIRST_CELL)) {
    const match = AREA.exec(plainText(cell).replace(/\s+/g, ' '))
    if (match) areas.push({ id: match[1], name: match[2], ring: parseLateralLimits(match[3], border) })
  }
  return areas
}
