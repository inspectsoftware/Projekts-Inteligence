import { Flag } from './entity'
import type { FeedId, FeedPayload } from './feeds'
import { gradeCell } from './gps'

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

/** GET /api/history: when each feed has a frame, oldest first, and how busy each frame was. */
export interface HistoryIndex {
  serverTime: number
  spanMs: number
  feeds: Record<HistoryFeedId, number[]>
  /** One number per frame, in the same order: see activity(). */
  activity: Record<HistoryFeedId, number[]>
}

/**
 * The one number per frame the rewind bar draws its graph from: what an analyst would look
 * for a spike in: military aircraft, military or sanctioned ships, heavily jammed cells.
 */
export function activity(payload: FeedPayload): number {
  if (payload.shape === 'cells') return payload.cells.filter((cell) => gradeCell(cell) === 'heavy').length
  if (payload.shape !== 'entities') return 0
  const { entities } = payload
  if (entities[0]?.kind === 'ship') return entities.filter((e) => e.flags & (Flag.MIL | Flag.SANCTIONED | Flag.SHADOW_FLEET)).length
  return entities.filter((e) => e.flags & Flag.MIL).length
}
