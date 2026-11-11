import type { Entity, EntityKind } from '../../shared/entity'
import { advance } from '../../shared/geo/sphere'
import { rewound } from '../state/rewind'

/** Never project further ahead than this: a target that stopped reporting should not fly on forever. */
const MAX_EXTRAPOLATION_S = 25

/**
 * Vehicles that keep to a road or a track glide from where they are drawn to each new fix,
 * instead of being carried on along their heading: projected ahead in a straight line they leave
 * the street on the first bend and jump back when the next fix arrives. The value is the shortest
 * glide, about the feed's refresh; how long one really takes is worked out from the vehicle's speed.
 */
const GLIDE_MS: Partial<Record<EntityKind, number>> = { transit: 2000, train: 4000 }
/** Never stretch one glide past this: a vehicle that went quiet catches up rather than crawls. */
const MAX_GLIDE_MS = 30_000
/** A step back shorter than this is the GPS wavering at a stop, not the vehicle reversing: it stays put. */
const JITTER_M = 30
/** A jump longer than this is a vehicle seen again after a gap, not motion: it is shown there at once. */
const TELEPORT_M = 2000

interface Glide {
  /** The way from where it was drawn to its latest fix: two points, or the bends of its route between. */
  points: [number, number][]
  /** Metres from the first point to each one. */
  walked: number[]
  /** When the glide began, and how long it takes: the way's length at the vehicle's own speed. */
  at: number
  duration: number
  /** The fix it is gliding to, by its time, so a new fix is noticed. */
  ts: number
  /** When its position last changed, by the feed's clock: many feeds repeat a fix for several refreshes. */
  moved: number
  /** Last asked about, for forgetting vehicles that have gone. */
  seen: number
  /** Its route on from the latest fix (TransitProps.ahead), and how fast it goes, m/s: for keeping it moving until the next fix. */
  ahead: Pick<Glide, 'points' | 'walked'> | null
  speed: number
}

/**
 * How far, and for how long, a vehicle is carried on along its route past its latest fix. Under the
 * jitter allowance, so when the real fix lands a little behind, the vehicle waits for it rather than
 * sliding back.
 */
const PREDICT_M = 25
const PREDICT_MS = 8000

const glides = new Map<string, Glide>()
let lastSweep = 0

function metres(a: [number, number], b: [number, number]): number {
  const k = Math.cos(((a[1] + b[1]) / 2) * (Math.PI / 180))
  return Math.hypot((b[0] - a[0]) * k, b[1] - a[1]) * 111_320
}

function track(points: [number, number][]): Pick<Glide, 'points' | 'walked'> {
  const walked = [0]
  for (let i = 1; i < points.length; i++) walked.push(walked[i - 1] + metres(points[i - 1], points[i]))
  return { points, walked }
}

/**
 * Where along its glide a vehicle is, and which way that stretch runs (degrees from north). Past the
 * end of the glide, before the next fix, it keeps on along its route ahead at its own speed, a
 * little: no further than PREDICT_M and for no longer than PREDICT_MS.
 */
function along(glide: Glide, now: number): { at: [number, number]; trk: number | null } {
  const over = now - glide.at - glide.duration
  if (over > 0 && glide.ahead && glide.speed > 0) {
    const d = Math.min(PREDICT_M, (glide.speed * Math.min(over, PREDICT_MS)) / 1000, glide.ahead.walked[glide.ahead.walked.length - 1])
    if (d > 0) return pointOn(glide.ahead, d)
  }
  const f = Math.min(1, Math.max(0, (now - glide.at) / glide.duration))
  // Eased at both ends, so a bus pulling up at a stop slows into it.
  return pointOn(glide, f * f * (3 - 2 * f) * glide.walked[glide.walked.length - 1])
}

/** The point d metres along a track, and which way the track runs there. */
function pointOn(track: Pick<Glide, 'points' | 'walked'>, d: number): { at: [number, number]; trk: number | null } {
  const { points, walked } = track
  let i = 1
  while (i < points.length - 1 && walked[i] < d) i++
  const [a, b] = [points[i - 1] ?? points[0], points[i] ?? points[0]]
  const span = walked[i] - walked[i - 1] || 1
  const g = Math.min(1, Math.max(0, (d - walked[i - 1]) / span))
  const k = Math.cos(a[1] * (Math.PI / 180))
  const trk = a === b || (a[0] === b[0] && a[1] === b[1]) ? null : ((Math.atan2((b[0] - a[0]) * k, b[1] - a[1]) * 180) / Math.PI + 360) % 360
  return { at: [a[0] + (b[0] - a[0]) * g, a[1] + (b[1] - a[1]) * g], trk }
}

/** Is the step from a to b backwards for something heading `trk` (degrees from north)? */
function backwards(a: [number, number], b: [number, number], trk: number | undefined): boolean {
  if (trk === undefined) return false
  const k = Math.cos(a[1] * (Math.PI / 180))
  const rad = (trk * Math.PI) / 180
  return (b[0] - a[0]) * k * Math.sin(rad) + (b[1] - a[1]) * Math.cos(rad) < 0
}

/** A stretch of route the feed gave a vehicle (TransitProps.path or .ahead), if it gave one. */
function routeProp(entity: Entity, name: 'path' | 'ahead'): [number, number][] | null {
  const value = (entity.props as Record<string, unknown> | undefined)?.[name]
  return Array.isArray(value) && value.length >= 2 ? (value as [number, number][]) : null
}

/**
 * The way from where a vehicle is drawn to its new fix: along the street it took where the feed
 * says, joined at the point of that street nearest to where it is drawn (it may already be a little
 * way along it), else straight.
 */
function wayFrom(drawn: [number, number], path: [number, number][] | null, fix: [number, number]): [number, number][] {
  if (!path) return [drawn, fix]
  let from = 0
  let best = Infinity
  path.forEach((point, i) => {
    const d = metres(drawn, point)
    if (d < best) [best, from] = [d, i]
  })
  return [drawn, ...path.slice(from === 0 ? 0 : from)]
}

/**
 * How long to take over a way this long: at the speed the vehicle reports, or else at the pace it
 * actually covered it, from one changed fix to the next. Either way about as fast as it really goes,
 * not the whole way in one refresh when the feed only moved it every half minute.
 */
function durationFor(length: number, entity: Entity, sinceMoved: number, shortest: number): number {
  const speed = entity.spd ?? 0
  const ms = speed > 1 ? (length / speed) * 1000 : sinceMoved
  return Math.min(MAX_GLIDE_MS, Math.max(shortest, ms))
}

function glideOf(entity: Entity, now: number, shortest: number): Glide {
  const fix: [number, number] = [entity.lon, entity.lat]
  let glide = glides.get(entity.id)
  if (!glide) {
    glide = { ...track([fix]), at: now, duration: shortest, ts: entity.ts, moved: entity.ts, seen: now, ahead: null, speed: 0 }
    glides.set(entity.id, glide)
  }
  glide.seen = now
  if (glide.ts !== entity.ts) {
    const { at: drawn } = along(glide, now)
    const last = glide.points[glide.points.length - 1]
    const changed = last[0] !== fix[0] || last[1] !== fix[1]
    const sinceMoved = entity.ts - glide.moved
    if (changed) glide.moved = entity.ts
    const step = metres(drawn, fix)
    glide.ts = entity.ts
    const ahead = routeProp(entity, 'ahead')
    if (!changed) {
      // The same fix again: carry on with the glide under way. A vehicle stood still that long has stopped.
      if (sinceMoved > PREDICT_MS) glide.speed = 0
    } else if (step > TELEPORT_M) Object.assign(glide, track([fix]), { at: now, duration: shortest, ahead: null, speed: 0 })
    // Holds still rather than twitching back a few metres.
    else if (step < JITTER_M && backwards(drawn, fix, entity.trk)) Object.assign(glide, track([drawn]), { at: now, duration: shortest, ahead: null, speed: 0 })
    else {
      const way = track(wayFrom(drawn, routeProp(entity, 'path'), fix))
      const length = way.walked[way.walked.length - 1]
      const duration = durationFor(length, entity, sinceMoved, shortest)
      // Its pace: what the feed says, else what it just covered; none if it barely moved.
      const speed = (entity.spd ?? 0) > 1 ? entity.spd! : length > 5 ? (length / duration) * 1000 : 0
      Object.assign(glide, way, { at: now, duration, ahead: ahead ? track(ahead) : null, speed })
    }
  }
  // Now and then, forget vehicles not drawn for a few minutes.
  if (now - lastSweep > 60_000) {
    lastSweep = now
    for (const [id, old] of glides) if (now - old.seen > 300_000) glides.delete(id)
  }
  return glide
}

/** Which way a vehicle is pointing right now: along the bend it is gliding round, else its reported course. */
export function headingAt(entity: Entity, now: number): number | undefined {
  const shortest = GLIDE_MS[entity.kind]
  if (!shortest || rewound(entity.kind)) return entity.trk
  return along(glideOf(entity, now, shortest), now).trk ?? entity.trk
}

/**
 * Where an entity is right now. Buses, trams and trains glide between their fixes (see GLIDE_MS);
 * aircraft and ships are carried forward from their last reported position along their last
 * reported course, which is what makes their icons move between polls.
 */
export function positionAt(entity: Entity, now: number): [number, number] {
  // A frame from the past shows where things were, not where they were headed.
  if (rewound(entity.kind)) return [entity.lon, entity.lat]
  const shortest = GLIDE_MS[entity.kind]
  if (shortest) return along(glideOf(entity, now, shortest), now).at
  if (entity.spd === undefined || entity.trk === undefined || entity.spd < 1) return [entity.lon, entity.lat]
  const seconds = Math.min(MAX_EXTRAPOLATION_S, Math.max(0, (now - entity.ts) / 1000))
  return advance(entity.lon, entity.lat, entity.trk, entity.spd * seconds)
}
