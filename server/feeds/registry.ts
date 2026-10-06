import type { FeedId } from '../../shared/feeds'
import { aircraftFeed } from './aircraft'
import { gpsHexFeed } from './gpsHex'
import { camerasFeed, roadsFeed } from './roads'
import { satellitesFeed } from './satellites'
import { sanctionsFeed, shipsFeed } from './ships'
import { trainsFeed } from './trains'
import { transitFeed } from './transit'
import type { FeedDef } from './types'
import { firesFeed, stationsFeed, warningsFeed } from './weather'

/** Partial so a test (or a deployment) can run with only some feeds. */
export type FeedRegistry = Partial<Record<FeedId, FeedDef>>

/** Every feed the API serves. Adding a feed means adding its id in shared/feeds.ts and an entry here. */
export const FEEDS: FeedRegistry = {
  aircraft: aircraftFeed,
  trains: trainsFeed,
  transit: transitFeed,
  ships: shipsFeed,
  sanctions: sanctionsFeed,
  satellites: satellitesFeed,
  'gps-hex': gpsHexFeed,
  warnings: warningsFeed,
  stations: stationsFeed,
  fires: firesFeed,
  cameras: camerasFeed,
  roads: roadsFeed,
}
