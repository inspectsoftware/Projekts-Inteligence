import type { FeedId } from '../../shared/feeds'
import { layersFedBy } from '../layers/registry'
import { useFeeds } from '../state/feeds'
import { FeedError, fetchFeed } from './api'
import { clearFeed, ingest } from './entityStore'

/**
 * Polls each feed that some visible layer needs, at the pace the server suggests.
 * Reference-counted, so two layers sharing a feed cause one request, and a feed
 * nobody is looking at is not requested at all. Pauses while the tab is hidden.
 */
interface Job {
  refs: number
  etag: string | null
  timer: ReturnType<typeof setTimeout> | null
  controller: AbortController | null
  failures: number
}

const MIN_INTERVAL_MS = 2000
const MAX_INTERVAL_MS = 120_000

const jobs = new Map<FeedId, Job>()

function schedule(id: FeedId, job: Job, delayMs: number): void {
  if (job.timer) clearTimeout(job.timer)
  job.timer = setTimeout(() => void poll(id, job), delayMs)
}

async function poll(id: FeedId, job: Job): Promise<void> {
  job.timer = null
  // Picked up again by the visibility listener below.
  if (document.hidden) return

  const controller = new AbortController()
  job.controller = controller
  const { report } = useFeeds.getState()
  try {
    const result = await fetchFeed(id, job.etag, controller.signal)
    if (jobs.get(id) !== job) return
    job.failures = 0
    const status = result.stale ? 'stale' : 'ok'

    if (result.kind === 'data') {
      job.etag = result.etag
      ingest(result.body)
      const { entities } = result.body.payload
      report(id, {
        status,
        updatedAt: result.body.updatedAt,
        count: entities.length,
        error: null,
        stats: layersFedBy(id).flatMap((layer) => layer.stats?.(entities) ?? []),
      })
    } else if (useFeeds.getState().feeds[id]?.status !== status) {
      report(id, { status, error: null })
    }
    schedule(id, job, Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, result.nextPollMs + 250)))
  } catch (err) {
    if (controller.signal.aborted || jobs.get(id) !== job) return
    job.failures += 1
    report(id, { status: 'error', error: err instanceof Error ? err.message : String(err) })
    const asked = err instanceof FeedError ? err.retryAfterMs : null
    schedule(id, job, asked ?? Math.min(60_000, 4000 * 2 ** (job.failures - 1)))
  } finally {
    if (job.controller === controller) job.controller = null
  }
}

/** Starts polling a feed (or joins the polling already under way). Call the result to let go. */
export function acquireFeed(id: FeedId): () => void {
  let job = jobs.get(id)
  if (!job) {
    job = { refs: 0, etag: null, timer: null, controller: null, failures: 0 }
    jobs.set(id, job)
    void poll(id, job)
  }
  job.refs += 1

  const held = job
  let released = false
  return () => {
    if (released) return
    released = true
    held.refs -= 1
    if (held.refs > 0) return
    if (held.timer) clearTimeout(held.timer)
    held.controller?.abort()
    jobs.delete(id)
    clearFeed(id)
    useFeeds.getState().report(id, { status: 'idle', count: null, stats: [] })
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) return
  for (const [id, job] of jobs) {
    if (!job.timer && !job.controller) void poll(id, job)
  }
})
