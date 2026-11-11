import type { Entity } from '../../shared/entity'
import { serverNow } from '../runtime/clock'
import { useSelection } from '../state/selection'
import { flyThere } from './camera'
import { getMap } from './instance'
import { positionAt } from './motion'

/** Selects a live object and flies to where it is now: what a search result or a list row does. */
export function goToEntity(entity: Entity): void {
  useSelection.getState().select(entity.id)
  const map = getMap()
  if (!map) return
  // Buses and trains are looked at from the street; aircraft and ships from higher up.
  const close = entity.kind === 'transit' || entity.kind === 'train'
  flyThere(map, positionAt(entity, serverNow()), close ? 16 : Math.max(map.getZoom(), 9))
}
