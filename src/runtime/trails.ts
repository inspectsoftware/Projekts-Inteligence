import type { Entity } from '../../shared/entity'
import { haversine } from '../../shared/geo/sphere'

/** Where an entity has recently been, oldest first. Kept in the browser: the server stores no history. */
export interface Trail {
  path: [number, number][]
  lastSeen: number
}

const MAX_POINTS = 90
const MIN_STEP_M = 150
const FORGET_AFTER_MS = 3 * 60 * 1000

const trails = new Map<string, Trail>()

/** Extends each entity's trail with its newest reported position, and forgets entities that left. */
export function recordTrails(entities: readonly Entity[], now: number): void {
  for (const entity of entities) {
    let trail = trails.get(entity.id)
    if (!trail) {
      trail = { path: [], lastSeen: now }
      trails.set(entity.id, trail)
    }
    trail.lastSeen = now
    const last = trail.path[trail.path.length - 1]
    if (last && haversine(last[0], last[1], entity.lon, entity.lat) < MIN_STEP_M) continue
    trail.path.push([entity.lon, entity.lat])
    if (trail.path.length > MAX_POINTS) trail.path.shift()
  }
  for (const [id, trail] of trails) {
    if (now - trail.lastSeen > FORGET_AFTER_MS) trails.delete(id)
  }
}

export function getTrail(id: string): Trail | undefined {
  return trails.get(id)
}
