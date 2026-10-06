import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FeedCache, FeedUnavailable } from '../../server/core/cache'
import { UpstreamError } from '../../server/core/upstream'
import type { FeedDef } from '../../server/feeds/types'
import type { FeedPayload } from '../../shared/feeds'

const payload = (n: number): FeedPayload => ({
  shape: 'entities',
  entities: Array.from({ length: n }, (_, i) => ({
    id: `aircraft:${i}`,
    kind: 'aircraft' as const,
    lon: 24,
    lat: 57,
    ts: 0,
    flags: 0,
    props: {},
  })),
})

function feed(load: FeedDef['load'], overrides: Partial<FeedDef> = {}): FeedDef {
  return {
    id: 'aircraft',
    title: 'Test',
    origins: [],
    ttlMs: 10_000,
    staleMs: 60_000,
    attribution: [],
    load,
    ...overrides,
  }
}

const quiet = { log: () => {} }

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-06T08:00:00Z'))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('FeedCache', () => {
  it('calls the upstream once per TTL however many requests arrive', async () => {
    const load = vi.fn(async () => payload(3))
    const cache = new FeedCache(quiet)
    const def = feed(load)

    const hits = await Promise.all([cache.get(def), cache.get(def), cache.get(def)])
    expect(load).toHaveBeenCalledTimes(1)
    expect(hits.every((hit) => !hit.stale && hit.snapshot === hits[0].snapshot)).toBe(true)
    expect(hits[0].snapshot.count).toBe(3)

    vi.advanceTimersByTime(9_000)
    await cache.get(def)
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('serves the stale copy at once while one refresh runs in the background', async () => {
    let release!: () => void
    const load = vi
      .fn<FeedDef['load']>()
      .mockResolvedValueOnce(payload(1))
      .mockImplementationOnce(() => new Promise((resolve) => (release = () => resolve(payload(2)))))
    const cache = new FeedCache(quiet)
    const def = feed(load)

    const first = await cache.get(def)
    vi.advanceTimersByTime(11_000)

    const [a, b] = await Promise.all([cache.get(def), cache.get(def)])
    expect(a.stale).toBe(true)
    expect(a.snapshot).toBe(first.snapshot)
    expect(b.snapshot).toBe(first.snapshot)
    expect(load).toHaveBeenCalledTimes(2)

    release()
    await vi.advanceTimersByTimeAsync(0)
    const fresh = await cache.get(def)
    expect(fresh.stale).toBe(false)
    expect(fresh.snapshot.count).toBe(2)
  })

  it('waits briefly for a refresh when the feed asks for it', async () => {
    const load = vi
      .fn<FeedDef['load']>()
      .mockResolvedValueOnce(payload(1))
      .mockImplementationOnce(() => new Promise((resolve) => setTimeout(() => resolve(payload(2)), 500)))
    const cache = new FeedCache(quiet)
    const def = feed(load, { waitMs: 1500 })

    await cache.get(def)
    vi.advanceTimersByTime(11_000)
    const pending = cache.get(def)
    await vi.advanceTimersByTimeAsync(600)
    const hit = await pending
    expect(hit.stale).toBe(false)
    expect(hit.snapshot.count).toBe(2)
  })

  it('keeps serving the last good copy when the upstream fails, and backs off', async () => {
    const load = vi
      .fn<FeedDef['load']>()
      .mockResolvedValueOnce(payload(1))
      .mockRejectedValue(new UpstreamError('http', 'example.org answered HTTP 502', { status: 502 }))
    const cache = new FeedCache(quiet)
    const def = feed(load)

    await cache.get(def)
    vi.advanceTimersByTime(11_000)
    const stale = await cache.get(def)
    await vi.advanceTimersByTimeAsync(0)
    expect(stale.stale).toBe(true)
    expect(cache.peek('aircraft').error).toBe('example.org answered HTTP 502')
    expect(load).toHaveBeenCalledTimes(2)

    // Still inside the backoff window: no new upstream call.
    vi.advanceTimersByTime(5_000)
    await cache.get(def)
    expect(load).toHaveBeenCalledTimes(2)

    vi.advanceTimersByTime(30_000)
    await cache.get(def)
    expect(load).toHaveBeenCalledTimes(3)
  })

  it('refuses to serve a copy older than staleMs', async () => {
    const load = vi
      .fn<FeedDef['load']>()
      .mockResolvedValueOnce(payload(1))
      .mockRejectedValue(new UpstreamError('network', 'example.org could not be reached'))
    const cache = new FeedCache(quiet)
    const def = feed(load)

    await cache.get(def)
    vi.advanceTimersByTime(61_000)
    await expect(cache.get(def)).rejects.toBeInstanceOf(FeedUnavailable)
  })

  it('never exposes the text of unexpected errors', async () => {
    const load = vi.fn<FeedDef['load']>().mockRejectedValue(new Error('GET https://secret.example/?key=abc123 failed'))
    const cache = new FeedCache(quiet)

    await expect(cache.get(feed(load))).rejects.toThrow('The feed could not be read')
    expect(cache.peek('aircraft').error).toBe('The feed could not be read')
  })

  it('compresses a snapshot once and reuses the result', async () => {
    const cache = new FeedCache(quiet)
    const { snapshot } = await cache.get(feed(async () => payload(200)))

    const br = snapshot.encoded('gzip, deflate, br')
    expect(br.encoding).toBe('br')
    expect(br.body.length).toBeLessThan(snapshot.json.length)
    expect(snapshot.encoded('br').body).toBe(br.body)
    expect(snapshot.encoded('gzip').encoding).toBe('gzip')
    expect(snapshot.encoded('identity').encoding).toBeNull()
  })
})
