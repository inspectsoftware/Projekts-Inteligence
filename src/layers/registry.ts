import type { Entity } from '../../shared/entity'
import type { FeedId } from '../../shared/feeds'
import { aircraftLayer } from './aircraft'
import { camsLayer } from './cams'
import { conflictsLayer, dangerLayer } from './danger'
import { firesLayer } from './fires'
import { gpsHexLayer } from './gpsHex'
import { militarySitesLayer, seaExerciseAreasLayer } from './military'
import { radarLayer } from './radar'
import { camerasLayer, roadEventsLayer } from './roads'
import { REFERENCE_LAYERS } from './reference'
import { satellitesLayer } from './satellites'
import { gaugesLayer, radiationLayer } from './sensors'
import { shipsLayer } from './ships'
import { stationsLayer } from './stations'
import { trainsLayer } from './trains'
import { transitLayer } from './transit'
import type { LayerDef, LayerGroup } from './types'
import { warningsLayer } from './warnings'
import { airspaceLayer, seaWarningsLayer } from './zones'

/** Draw order, bottom to top. Also the order of the layer list within each group. */
export const LAYERS: readonly LayerDef[] = [
  dangerLayer,
  ...REFERENCE_LAYERS,
  seaExerciseAreasLayer,
  militarySitesLayer,
  conflictsLayer,
  radarLayer,
  warningsLayer,
  gpsHexLayer,
  firesLayer,
  stationsLayer,
  gaugesLayer,
  radiationLayer,
  roadEventsLayer,
  camerasLayer,
  camsLayer,
  shipsLayer,
  seaWarningsLayer,
  transitLayer,
  trainsLayer,
  satellitesLayer,
  aircraftLayer,
  airspaceLayer,
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
