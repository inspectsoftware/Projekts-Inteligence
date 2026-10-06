import type { FeedId } from '../../shared/feeds'
import { aircraftFeed, militaryAirFeed } from './aircraft'
import { briefFeed } from './brief'
import { camsFeed } from './cams'
import { countryBriefsFeed } from './countryBriefs'
import { gpsHexFeed } from './gpsHex'
import { newsFeed } from './news'
import { energyFeed, internetFeed, radiationFeed, riversFeed } from './panels'
import { camerasFeed, roadsFeed } from './roads'
import { satellitesFeed } from './satellites'
import { sanctionsFeed, shipsFeed } from './ships'
import { trainsFeed } from './trains'
import { transitFeed } from './transit'
import { tvFeed } from './tv'
import type { FeedDef } from './types'
import { firesFeed, stationsFeed, warningsFeed } from './weather'
import { airspaceFeed, navwarnFeed } from './zones'

/** Partial so a test (or a deployment) can run with only some feeds. */
export type FeedRegistry = Partial<Record<FeedId, FeedDef>>

/** Every feed the API serves. Adding a feed means adding its id in shared/feeds.ts and an entry here. */
export const FEEDS: FeedRegistry = {
  aircraft: aircraftFeed,
  'aircraft-mil': militaryAirFeed,
  trains: trainsFeed,
  transit: transitFeed,
  ships: shipsFeed,
  sanctions: sanctionsFeed,
  satellites: satellitesFeed,
  'gps-hex': gpsHexFeed,
  warnings: warningsFeed,
  navwarn: navwarnFeed,
  airspace: airspaceFeed,
  stations: stationsFeed,
  fires: firesFeed,
  cameras: camerasFeed,
  cams: camsFeed,
  roads: roadsFeed,
  radiation: radiationFeed,
  rivers: riversFeed,
  energy: energyFeed,
  internet: internetFeed,
  news: newsFeed,
  brief: briefFeed,
  'country-briefs': countryBriefsFeed,
  tv: tvFeed,
}
