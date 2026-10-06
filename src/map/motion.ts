import type { Entity } from '../../shared/entity'
import { advance } from '../../shared/geo/sphere'

/** Never project further ahead than this: a target that stopped reporting should not fly on forever. */
const MAX_EXTRAPOLATION_S = 25

/**
 * Where an entity is right now, carried forward from its last reported position
 * along its last reported course. This is what makes icons glide between polls.
 */
export function positionAt(entity: Entity, now: number): [number, number] {
  if (entity.spd === undefined || entity.trk === undefined || entity.spd < 1) return [entity.lon, entity.lat]
  const seconds = Math.min(MAX_EXTRAPOLATION_S, Math.max(0, (now - entity.ts) / 1000))
  return advance(entity.lon, entity.lat, entity.trk, entity.spd * seconds)
}
