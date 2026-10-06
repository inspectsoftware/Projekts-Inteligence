import type { FeedId } from '../../shared/feeds'
import { aircraftFeed } from './aircraft'
import type { FeedDef } from './types'

export type FeedRegistry = Record<FeedId, FeedDef>

/** Every feed the API serves. Adding a feed means adding its id in shared/feeds.ts and an entry here. */
export const FEEDS: FeedRegistry = {
  aircraft: aircraftFeed,
}
