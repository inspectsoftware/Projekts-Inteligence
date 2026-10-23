import type { Entity } from '../../shared/entity'
import { advance } from '../../shared/geo/sphere'
import { rewound } from '../state/rewind'

/** Never project further ahead than this: a target that stopped reporting should not fly on forever. */
const MAX_EXTRAPOLATION_S = 25

/**
 * Where an entity is right now, carried forward from its last reported position
 * along its last reported course. This is what makes icons glide between polls.
 */
export function positionAt(entity: Entity, now: number): [number, number] {
  // A bus reports about once a minute and turns or stops in between: carried on along its
  // last heading it leaves the street within seconds. It stays where it was last seen.
  if (entity.kind === 'transit') return [entity.lon, entity.lat]
  // A frame from the past shows where things were, not where they were headed.
  if (rewound(entity.kind)) return [entity.lon, entity.lat]
  if (entity.spd === undefined || entity.trk === undefined || entity.spd < 1) return [entity.lon, entity.lat]
  const seconds = Math.min(MAX_EXTRAPOLATION_S, Math.max(0, (now - entity.ts) / 1000))
  return advance(entity.lon, entity.lat, entity.trk, entity.spd * seconds)
}
