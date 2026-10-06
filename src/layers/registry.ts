import type { Entity } from '../../shared/entity'
import type { FeedId } from '../../shared/feeds'
import { aircraftLayer } from './aircraft'
import type { LayerDef, LayerGroup } from './types'

/** Draw order, bottom to top. Also the order of the layer list within each group. */
export const LAYERS: readonly LayerDef[] = [aircraftLayer]

export const GROUP_ORDER: readonly LayerGroup[] = ['air', 'sea', 'land', 'space', 'signals', 'environment']

/** The layer that knows how to describe this entity in the inspector. */
export function layerFor(entity: Entity): LayerDef | undefined {
  return LAYERS.find((layer) => layer.describes?.includes(entity.kind))
}

/** Layers fed by this feed, for turning a snapshot into headline numbers. */
export function layersFedBy(feed: FeedId): LayerDef[] {
  return LAYERS.filter((layer) => layer.feeds.includes(feed))
}
