import type { Entity } from '../../shared/entity'
import type { FeedId } from '../../shared/feeds'
import { aircraftLayer } from './aircraft'
import { firesLayer } from './fires'
import { gpsHexLayer } from './gpsHex'
import { radarLayer } from './radar'
import { REFERENCE_LAYERS } from './reference'
import { satellitesLayer } from './satellites'
import { shipsLayer } from './ships'
import { stationsLayer } from './stations'
import { trainsLayer } from './trains'
import { transitLayer } from './transit'
import type { LayerDef, LayerGroup } from './types'
import { warningsLayer } from './warnings'

/** Draw order, bottom to top. Also the order of the layer list within each group. */
export const LAYERS: readonly LayerDef[] = [
  ...REFERENCE_LAYERS,
  radarLayer,
  warningsLayer,
  gpsHexLayer,
  firesLayer,
  stationsLayer,
  shipsLayer,
  transitLayer,
  trainsLayer,
  satellitesLayer,
  aircraftLayer,
]

export const GROUP_ORDER: readonly LayerGroup[] = ['air', 'sea', 'land', 'space', 'signals', 'environment', 'reference']

/** The layer that knows how to describe this entity in the inspector. */
export function layerFor(entity: Entity): LayerDef | undefined {
  return LAYERS.find((layer) => layer.describes?.includes(entity.kind))
}

/** Layers fed by this feed, for turning a snapshot into headline numbers. */
export function layersFedBy(feed: FeedId): LayerDef[] {
  return LAYERS.filter((layer) => layer.feeds.includes(feed))
}
