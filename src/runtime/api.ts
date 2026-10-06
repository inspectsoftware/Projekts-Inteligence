import { FEED_HEADERS, type FeedBody, type FeedId, type FeedsResponse } from '../../shared/feeds'
import { observeServerTime } from './clock'

export type FeedFetch =
  | { kind: 'data'; body: FeedBody; etag: string | null; stale: boolean; nextPollMs: number }
  | { kind: 'unchanged'; stale: boolean; nextPollMs: number }

export class FeedError extends Error {
  readonly status: number
  readonly retryAfterMs: number | null

  constructor(message: string, status: number, retryAfterMs: number | null) {
    super(message)
    this.name = 'FeedError'
    this.status = status
    this.retryAfterMs = retryAfterMs
  }
}

/** One poll of a feed. Sends the validator of the copy we hold, so an unchanged feed costs no body. */
export async function fetchFeed(id: FeedId, etag: string | null, signal: AbortSignal): Promise<FeedFetch> {
  const sentAt = performance.now()
  const res = await fetch(`/api/feed/${id}`, {
    signal,
    // We do our own revalidation; the HTTP cache would hide the 304 and its fresh headers.
    cache: 'no-store',
    headers: etag ? { 'If-None-Match': etag } : undefined,
  })
  const receivedAt = performance.now()

  const serverTime = Number(res.headers.get(FEED_HEADERS.serverTime))
  if (serverTime > 0) observeServerTime(serverTime, sentAt, receivedAt)

  if (res.status !== 200 && res.status !== 304) {
    const retryAfter = Number(res.headers.get('retry-after'))
    let message = `HTTP ${res.status}`
    try {
      const body = (await res.json()) as { message?: string; error?: string }
      message = body.message ?? body.error ?? message
    } catch {
      // not JSON: keep the status text
    }
    throw new FeedError(message, res.status, retryAfter > 0 ? retryAfter * 1000 : null)
  }

  const stale = res.headers.get(FEED_HEADERS.stale) === '1'
  const nextPollMs = Number(res.headers.get(FEED_HEADERS.nextPoll)) || 10_000
  if (res.status === 304) return { kind: 'unchanged', stale, nextPollMs }
  return { kind: 'data', body: (await res.json()) as FeedBody, etag: res.headers.get('etag'), stale, nextPollMs }
}

export async function fetchFeedList(signal?: AbortSignal): Promise<FeedsResponse> {
  const res = await fetch('/api/feeds', { signal, cache: 'no-store' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as FeedsResponse
}
