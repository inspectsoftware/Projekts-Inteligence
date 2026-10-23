import { mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { HISTORY_FEEDS, activity, HISTORY_SPAN_MS, HISTORY_STEP_MS, type HistoryFeedId, isHistoryFeed } from '../../shared/history'
import type { FeedId } from '../../shared/feeds'
import type { Snapshot } from './cache'

interface Frame {
  at: number
  /** See activity() in shared/history.ts. */
  activity: number
  /** The snapshot's body, gzipped once when it is kept. */
  gzip: Buffer
}

/** A runaway payload must not take the process's memory with it: past this, the oldest frames go first. */
const MAX_BYTES_PER_FEED = 32 * 1024 * 1024

/** A frame's file: its time and activity in the name, so loading needs no unpacking. */
const FILE = /^(\d+)-(\d+)\.json\.gz$/

/**
 * The last few hours of the moving feeds, one frame a minute. Frames are only made when a
 * feed refreshes, and feeds only refresh while somebody is looking, so the record has gaps
 * where nobody was. Given a folder, each frame is also written there and read back when the
 * process starts again, so an idle stop or a deploy does not empty it. Strictly best effort,
 * as with the disk store: the host documents no persistent folder.
 */
export class History {
  private readonly frames = new Map<HistoryFeedId, Frame[]>(HISTORY_FEEDS.map((id) => [id, []]))
  private readonly bytes = new Map<HistoryFeedId, number>(HISTORY_FEEDS.map((id) => [id, 0]))

  private readonly stepMs: number
  private readonly spanMs: number
  private readonly dir?: string

  constructor(stepMs = HISTORY_STEP_MS, spanMs = HISTORY_SPAN_MS, dir?: string, now = Date.now()) {
    this.stepMs = stepMs
    this.spanMs = spanMs
    this.dir = dir
    if (dir) this.load(dir, now)
  }

  private folder(id: HistoryFeedId): string {
    return join(this.dir!, id)
  }

  /** What a previous process left, if still within the span. Once, at start; a few MB at most. */
  private load(dir: string, now: number): void {
    for (const id of HISTORY_FEEDS) {
      try {
        mkdirSync(join(dir, id), { recursive: true, mode: 0o700 })
        const found: Frame[] = []
        for (const name of readdirSync(join(dir, id))) {
          const match = FILE.exec(name)
          if (!match) continue
          const at = Number(match[1])
          if (at < now - this.spanMs) void unlink(join(dir, id, name)).catch(() => {})
          else found.push({ at, activity: Number(match[2]), gzip: readFileSync(join(dir, id, name)) })
        }
        found.sort((a, b) => a.at - b.at)
        this.frames.set(id, found)
        this.bytes.set(id, found.reduce((sum, frame) => sum + frame.gzip.length, 0))
      } catch {
        // No readable folder: start empty and keep the record in memory only.
      }
    }
  }

  record(id: FeedId, snapshot: Snapshot): void {
    if (!isHistoryFeed(id)) return
    const list = this.frames.get(id)!
    const last = list[list.length - 1]
    if (last && snapshot.updatedAt - last.at < this.stepMs) return
    const frame: Frame = { at: snapshot.updatedAt, activity: activity(snapshot.payload), gzip: gzipSync(snapshot.json, { level: 6 }) }
    list.push(frame)
    if (this.dir) void writeFile(join(this.folder(id), `${frame.at}-${frame.activity}.json.gz`), frame.gzip, { mode: 0o600 }).catch(() => {})
    let bytes = this.bytes.get(id)! + frame.gzip.length
    while (list.length > 0 && (list[0].at < snapshot.updatedAt - this.spanMs || bytes > MAX_BYTES_PER_FEED)) {
      const gone = list.shift()!
      bytes -= gone.gzip.length
      if (this.dir) void unlink(join(this.folder(id), `${gone.at}-${gone.activity}.json.gz`)).catch(() => {})
    }
    this.bytes.set(id, bytes)
  }

  times(id: HistoryFeedId): number[] {
    return this.frames.get(id)!.map((frame) => frame.at)
  }

  activity(id: HistoryFeedId): number[] {
    return this.frames.get(id)!.map((frame) => frame.activity)
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
