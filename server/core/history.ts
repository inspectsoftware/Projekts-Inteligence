import { gzipSync } from 'node:zlib'
import { HISTORY_FEEDS, HISTORY_SPAN_MS, HISTORY_STEP_MS, type HistoryFeedId, isHistoryFeed } from '../../shared/history'
import type { FeedId } from '../../shared/feeds'
import type { Snapshot } from './cache'

interface Frame {
  at: number
  /** The snapshot's body, gzipped once when it is kept. */
  gzip: Buffer
}

/** A runaway payload must not take the process's memory with it: past this, the oldest frames go first. */
const MAX_BYTES_PER_FEED = 32 * 1024 * 1024

/**
 * The last few hours of the moving feeds, one frame a minute, kept in memory.
 * Frames are only made when a feed refreshes, and feeds only refresh while somebody
 * is looking, so the record has gaps where nobody was; a restart empties it.
 */
// ponytail: memory only, lost on restart or idle stop; write frames to disk if the host keeps a folder.
export class History {
  private readonly frames = new Map<HistoryFeedId, Frame[]>(HISTORY_FEEDS.map((id) => [id, []]))
  private readonly bytes = new Map<HistoryFeedId, number>(HISTORY_FEEDS.map((id) => [id, 0]))

  private readonly stepMs: number
  private readonly spanMs: number

  constructor(stepMs = HISTORY_STEP_MS, spanMs = HISTORY_SPAN_MS) {
    this.stepMs = stepMs
    this.spanMs = spanMs
  }

  record(id: FeedId, snapshot: Snapshot): void {
    if (!isHistoryFeed(id)) return
    const list = this.frames.get(id)!
    const last = list[list.length - 1]
    if (last && snapshot.updatedAt - last.at < this.stepMs) return
    const gzip = gzipSync(snapshot.json, { level: 6 })
    list.push({ at: snapshot.updatedAt, gzip })
    let bytes = this.bytes.get(id)! + gzip.length
    while (list.length > 0 && (list[0].at < snapshot.updatedAt - this.spanMs || bytes > MAX_BYTES_PER_FEED)) {
      bytes -= list.shift()!.gzip.length
    }
    this.bytes.set(id, bytes)
  }

  times(id: HistoryFeedId): number[] {
    return this.frames.get(id)!.map((frame) => frame.at)
  }

  /** The newest frame made at or before `at`, or the oldest one when `at` is earlier than all of them. */
  frame(id: HistoryFeedId, at: number): Frame | undefined {
    const list = this.frames.get(id)!
    let found = list[0]
    for (const frame of list) {
      if (frame.at > at) break
      found = frame
    }
    return found
  }
}
