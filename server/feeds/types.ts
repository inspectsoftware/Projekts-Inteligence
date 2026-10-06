import type { FeedBody, FeedId, FeedPayload } from '../../shared/feeds'
import type { Attribution } from '../../shared/origins'
import type { Upstream } from '../core/upstream'

export interface FeedContext {
  /** Epoch ms when this refresh started. */
  now: number
  /** Limited to the feed's declared origins, with the refresh timeout already applied. */
  http: Upstream
  env: NodeJS.ProcessEnv
  /**
   * Another feed's current snapshot. For feeds that are worked out from another feed's data
   * rather than fetched from somewhere. A source that is due is refreshed behind the copy handed
   * back. With `fresh` the refresh is waited for, and the old copy comes back only if it failed:
   * for a feed that keeps what it makes of the source far longer than the source's own TTL.
   */
  feed(id: FeedId, opts?: { fresh?: boolean }): Promise<FeedBody>
}

/**
 * A feed that is refreshed by asking an upstream over HTTP. Refreshes only happen
 * when someone asks for the feed and the cached copy is older than ttlMs, so the
 * number of upstream calls never depends on the number of visitors.
 */
export interface FeedDef<T extends FeedPayload = FeedPayload> {
  id: FeedId
  title: string
  /** The only origins load() may contact. */
  origins: readonly string[]
  /** No upstream call is made while the cached copy is younger than this. */
  ttlMs: number
  /** A copy older than this is never served, even if refreshing keeps failing. */
  staleMs: number
  /** How long a request may wait for a refresh before it is handed the stale copy. */
  waitMs?: number
  /** Upstream time budget for one refresh. */
  timeoutMs?: number
  /** Keep the last good copy on disk, for data that is slow to change and costly to re-fetch. */
  persist?: boolean
  /** Environment variables that must be set, or the feed reports "needs-key" and never calls out. */
  requiresEnv?: readonly string[]
  attribution: readonly Attribution[]
  load(ctx: FeedContext): Promise<T>
  /** Number shown next to the layer; defaults to how many things the payload holds. */
  count?(payload: T): number
}
