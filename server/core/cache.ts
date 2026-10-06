import { createHash } from 'node:crypto'
import { brotliCompressSync, constants, gzipSync } from 'node:zlib'
import { type FeedBody, type FeedId, type FeedPayload, countOf } from '../../shared/feeds'
import type { FeedDef } from '../feeds/types'
import type { DiskStore } from './disk'
import { type FetchLike, UpstreamError, createUpstream } from './upstream'

const DEFAULT_TIMEOUT_MS = 8000
const MAX_BACKOFF_MS = 5 * 60 * 1000

/** One successful refresh, serialised once and shared by every request until the next one. */
export class Snapshot {
  readonly updatedAt: number
  readonly count: number
  readonly etag: string
  /** The data itself, for feeds that are derived from this one. */
  readonly payload: FeedPayload
  readonly json: Buffer
  private br?: Buffer
  private gzip?: Buffer

  constructor(id: FeedId, payload: FeedPayload, updatedAt: number, count: number) {
    const body: FeedBody = { id, updatedAt, payload }
    this.updatedAt = updatedAt
    this.count = count
    this.payload = payload
    this.json = Buffer.from(JSON.stringify(body))
    this.etag = `W/"${createHash('sha1').update(this.json).digest('base64url').slice(0, 20)}"`
  }

  /** The body in the best encoding the client accepts, compressed at most once per snapshot. */
  encoded(acceptEncoding: string): { body: Buffer; encoding: 'br' | 'gzip' | null } {
    if (this.json.length < 1024) return { body: this.json, encoding: null }
    if (/\bbr\b/.test(acceptEncoding)) {
      this.br ??= brotliCompressSync(this.json, { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } })
      return { body: this.br, encoding: 'br' }
    }
    if (/\bgzip\b/.test(acceptEncoding)) {
      this.gzip ??= gzipSync(this.json, { level: 6 })
      return { body: this.gzip, encoding: 'gzip' }
    }
    return { body: this.json, encoding: null }
  }
}

export interface CacheHit {
  snapshot: Snapshot
  /** True when the copy is older than the feed's TTL (a refresh is under way or failing). */
  stale: boolean
  /** How long until a newer copy is likely to exist. */
  nextPollMs: number
}

/** Thrown when there is nothing servable: no copy yet, or one too old to show. */
export class FeedUnavailable extends Error {
  readonly retryAfterMs: number

  constructor(message: string, retryAfterMs: number) {
    super(message)
    this.name = 'FeedUnavailable'
    this.retryAfterMs = retryAfterMs
  }
}

export interface FeedState {
  snapshot: Snapshot | null
  /** Sanitised reason for the last failed refresh; cleared by the next success. */
  error: string | null
  refreshing: boolean
}

interface Entry {
  snapshot: Snapshot | null
  /** Whether the on-disk copy has been looked for yet (once per process). */
  hydrated: boolean
  inFlight: Promise<void> | null
  error: string | null
  failures: number
  nextAttemptAt: number
}

export interface CacheDeps {
  now?(): number
  fetch?: FetchLike
  env?: NodeJS.ProcessEnv
  log?(message: string): void
  /** Where feeds marked `persist` keep their last good copy. Omit to keep everything in memory. */
  disk?: DiskStore
  /** Looks up another feed's definition, for feeds that are derived from one. */
  resolve?(id: FeedId): FeedDef | undefined
}

/**
 * In-memory cache in front of every feed. Request-driven on purpose: Hostinger stops
 * the process when traffic goes quiet, so nothing here relies on timers staying alive,
 * and everything it holds can be rebuilt from upstream after a cold start.
 */
export class FeedCache {
  private readonly entries = new Map<FeedId, Entry>()
  private readonly now: () => number
  private readonly fetchImpl?: FetchLike
  private readonly env: NodeJS.ProcessEnv
  private readonly log: (message: string) => void
  private readonly disk?: DiskStore
  private readonly resolve?: (id: FeedId) => FeedDef | undefined

  constructor(deps: CacheDeps = {}) {
    this.now = deps.now ?? Date.now
    this.fetchImpl = deps.fetch
    this.env = deps.env ?? process.env
    this.log = deps.log ?? ((message) => console.log(message))
    this.disk = deps.disk
    this.resolve = deps.resolve
  }

  private entry(id: FeedId): Entry {
    let entry = this.entries.get(id)
    if (!entry) {
      entry = { snapshot: null, hydrated: false, inFlight: null, error: null, failures: 0, nextAttemptAt: 0 }
      this.entries.set(id, entry)
    }
    return entry
  }

  /** Current state without touching the upstream. */
  peek(id: FeedId): FeedState {
    const entry = this.entry(id)
    return { snapshot: entry.snapshot, error: entry.error, refreshing: entry.inFlight !== null }
  }

  async get(def: FeedDef): Promise<CacheHit> {
    const entry = this.entry(def.id)
    if (!entry.snapshot && !entry.hydrated) await this.hydrate(def, entry)
    const age = entry.snapshot ? this.now() - entry.snapshot.updatedAt : Infinity

    if (entry.snapshot && age < def.ttlMs) {
      return { snapshot: entry.snapshot, stale: false, nextPollMs: def.ttlMs - age }
    }

    const refresh = this.refresh(def, entry)

    if (entry.snapshot && age < def.staleMs) {
      // Give the refresh a moment, so a 10 s feed is not served 20 s old, but never hold the request for long.
      if (refresh && def.waitMs) await Promise.race([refresh, new Promise((resolve) => setTimeout(resolve, def.waitMs))])
      const snapshot = entry.snapshot
      const stale = this.now() - snapshot.updatedAt >= def.ttlMs
      return { snapshot, stale, nextPollMs: stale ? Math.min(def.ttlMs, 3000) : def.ttlMs }
    }

    // Nothing servable: this request has to wait for the upstream.
    if (refresh) await refresh
    if (entry.snapshot && this.now() - entry.snapshot.updatedAt < def.staleMs) {
      return { snapshot: entry.snapshot, stale: false, nextPollMs: def.ttlMs }
    }
    throw new FeedUnavailable(
      entry.error ?? 'No data yet',
      Math.max(1000, entry.nextAttemptAt - this.now()),
    )
  }

  /** After a cold start, picks up the copy a previous process left on disk, if it is still usable. */
  private async hydrate(def: FeedDef, entry: Entry): Promise<void> {
    entry.hydrated = true
    if (!def.persist || !this.disk) return
    const stored = await this.disk.read(def.id)
    if (!stored || entry.snapshot || this.now() - stored.updatedAt >= def.staleMs) return
    try {
      entry.snapshot = new Snapshot(def.id, stored.payload, stored.updatedAt, this.countFor(def, stored.payload))
    } catch {
      // A file from an older build with another shape: ignore it and ask the upstream.
    }
  }

  private countFor(def: FeedDef, payload: FeedPayload): number {
    return def.count ? def.count(payload) : countOf(payload)
  }

  /** Starts a refresh unless one is running or the feed is backing off. Never rejects. */
  private refresh(def: FeedDef, entry: Entry): Promise<void> | null {
    if (entry.inFlight) return entry.inFlight
    if (this.now() < entry.nextAttemptAt) return null

    const startedAt = this.now()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), def.timeoutMs ?? DEFAULT_TIMEOUT_MS)

    entry.inFlight = (async () => {
      try {
        const payload = await def.load({
          now: startedAt,
          env: this.env,
          http: createUpstream(def.origins, controller.signal, this.fetchImpl),
          feed: async (id) => {
            const source = this.resolve?.(id)
            if (!source) throw new UpstreamError('network', `The ${id} feed is not available here`)
            const { snapshot } = await this.get(source)
            return { id, updatedAt: snapshot.updatedAt, payload: snapshot.payload }
          },
        })
        entry.snapshot = new Snapshot(def.id, payload, this.now(), this.countFor(def, payload))
        if (def.persist) void this.disk?.write(def.id, { updatedAt: entry.snapshot.updatedAt, payload })
        entry.error = null
        entry.failures = 0
        entry.nextAttemptAt = 0
      } catch (err) {
        entry.failures += 1
        // Only our own error messages are safe to show; anything else could carry a URL or a key.
        entry.error = err instanceof UpstreamError ? err.message : 'The feed could not be read'
        const backoff = Math.min(MAX_BACKOFF_MS, def.ttlMs * 2 ** Math.min(entry.failures, 8))
        const asked = err instanceof UpstreamError ? (err.retryAfterMs ?? 0) : 0
        // Jitter, so many feeds failing together do not all retry on the same tick.
        entry.nextAttemptAt = this.now() + Math.max(backoff, asked) * (0.85 + Math.random() * 0.3)
        this.log(`[feed:${def.id}] refresh failed (${entry.failures}): ${err instanceof Error ? err.message : String(err)}`)
      } finally {
        clearTimeout(timer)
        entry.inFlight = null
      }
    })()
    return entry.inFlight
  }
}
