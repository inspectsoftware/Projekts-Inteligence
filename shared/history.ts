import type { FeedId } from './feeds'

/** Feeds whose recent past the server keeps, so the map can be wound back. */
export const HISTORY_FEEDS = ['aircraft', 'aircraft-mil', 'ships', 'gps-hex'] as const satisfies readonly FeedId[]
export type HistoryFeedId = (typeof HISTORY_FEEDS)[number]

export function isHistoryFeed(id: string): id is HistoryFeedId {
  return (HISTORY_FEEDS as readonly string[]).includes(id)
}

/** One frame per feed at most this often. */
export const HISTORY_STEP_MS = 60_000
/** How far back frames are kept. */
export const HISTORY_SPAN_MS = 6 * 60 * 60_000

/** GET /api/history: when each feed has a frame, oldest first. */
export interface HistoryIndex {
  serverTime: number
  spanMs: number
  feeds: Record<HistoryFeedId, number[]>
}
