import type { Entity } from '../../shared/entity'
import { serverNow } from '../runtime/clock'
import { useSelection } from '../state/selection'
import { getMap } from './instance'
import { positionAt } from './motion'

/** Selects a live object and flies to where it is now: what a search result or a list row does. */
export function goToEntity(entity: Entity): void {
  useSelection.getState().select(entity.id)
  const map = getMap()
  map?.flyTo({ center: positionAt(entity, serverNow()), zoom: Math.max(map.getZoom(), 8.5), duration: 1400 })
}
