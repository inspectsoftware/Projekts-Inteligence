import type { Entity } from './entity'
import type { Attribution } from './origins'

export const FEED_IDS = ['aircraft'] as const
export type FeedId = (typeof FEED_IDS)[number]

export function isFeedId(value: string): value is FeedId {
  return (FEED_IDS as readonly string[]).includes(value)
}

/** What a feed delivers. One entity list cannot describe hexes, news or orbits, hence the union. */
export type FeedPayload = { shape: 'entities'; entities: Entity[] }

/**
 * Response body of GET /api/feed/:id. Identical for every client of one snapshot,
 * so it is serialised once and can be answered with 304. Anything that changes
 * between requests travels in the headers below instead.
 */
export interface FeedBody<T extends FeedPayload = FeedPayload> {
  id: FeedId
  /** Epoch ms when the server fetched this snapshot. */
  updatedAt: number
  payload: T
}

export const FEED_HEADERS = {
  /** Server clock (epoch ms), so the browser can correct its own. */
  serverTime: 'x-server-time',
  /** "1" when the snapshot is older than the feed's TTL. */
  stale: 'x-feed-stale',
  /** Milliseconds until asking again is worthwhile. */
  nextPoll: 'x-feed-next-poll',
} as const

export type FeedStatus = 'idle' | 'ok' | 'stale' | 'error' | 'needs-key'

/** One row of GET /api/feeds. */
export interface FeedMeta {
  id: FeedId
  title: string
  ttlMs: number
  status: FeedStatus
  updatedAt: number | null
  count: number | null
  /** Sanitised reason for the last failure: no URLs, no keys. */
  error: string | null
  attribution: readonly Attribution[]
}

export interface FeedsResponse {
  serverTime: number
  feeds: FeedMeta[]
}
