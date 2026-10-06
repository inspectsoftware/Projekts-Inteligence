import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '../../server/app'
import { FeedCache } from '../../server/core/cache'
import type { FeedRegistry } from '../../server/feeds/registry'
import type { FeedDef } from '../../server/feeds/types'
import { FEED_HEADERS, type FeedBody, type FeedsResponse } from '../../shared/feeds'

let clientDir: string

beforeAll(() => {
  clientDir = mkdtempSync(join(tmpdir(), 'pwh-client-'))
  mkdirSync(join(clientDir, 'assets'))
  writeFileSync(join(clientDir, 'index.html'), '<!doctype html><div id="root"></div>')
  writeFileSync(join(clientDir, 'assets', 'app-abc123.js'), 'console.log(1)')
})

afterAll(() => {
  rmSync(clientDir, { recursive: true, force: true })
})

describe('api', () => {
  it('reports health without caching', async () => {
    const res = await createApp({ clientDir: null }).request('/api/health')
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.json()).toMatchObject({ ok: true, commit: expect.any(String) })
  })

  it('answers unknown api routes with a json 404, not the app shell', async () => {
    const res = await createApp({ clientDir }).request('/api/nope')
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'not_found' })
  })

  it('sets security headers on api, file, shell and 404 responses', async () => {
    const app = createApp({ clientDir })
    for (const path of ['/api/health', '/assets/app-abc123.js', '/some/route', '/assets/gone.js']) {
      const res = await app.request(path)
      expect(res.headers.get('content-security-policy'), path).toContain("default-src 'self'")
      expect(res.headers.get('x-content-type-options'), path).toBe('nosniff')
    }
  })
})

describe('feed api', () => {
  const entity = { id: 'aircraft:abc123', kind: 'aircraft' as const, lon: 24, lat: 57, ts: 1, flags: 0, props: {} }
  const aircraft: FeedDef = {
    id: 'aircraft',
    title: 'Aircraft',
    origins: [],
    ttlMs: 10_000,
    staleMs: 60_000,
    attribution: [{ label: 'Test source', href: 'https://example.org' }],
    load: async () => ({ shape: 'entities', entities: Array.from({ length: 40 }, () => entity) }),
  }
  const feeds: FeedRegistry = { aircraft }
  const app = () => createApp({ clientDir: null, feeds, cache: new FeedCache({ log: () => {} }) })

  it('serves a feed with timing headers and a validator', async () => {
    const res = await app().request('/api/feed/aircraft', { headers: { 'accept-encoding': 'identity' } })
    expect(res.status).toBe(200)
    expect(res.headers.get(FEED_HEADERS.stale)).toBe('0')
    expect(Number(res.headers.get(FEED_HEADERS.serverTime))).toBeGreaterThan(1.7e12)
    expect(Number(res.headers.get(FEED_HEADERS.nextPoll))).toBeGreaterThan(0)
    expect(res.headers.get('etag')).toMatch(/^W\/"/)
    const body = (await res.json()) as FeedBody
    expect(body.id).toBe('aircraft')
    expect(body.payload).toMatchObject({ shape: 'entities' })
    expect(body.payload.shape === 'entities' && body.payload.entities).toHaveLength(40)
  })

  it('answers 304 when the client already has the snapshot', async () => {
    const instance = app()
    const first = await instance.request('/api/feed/aircraft')
    const again = await instance.request('/api/feed/aircraft', {
      headers: { 'if-none-match': first.headers.get('etag')! },
    })
    expect(again.status).toBe(304)
    expect(again.headers.get(FEED_HEADERS.nextPoll)).not.toBeNull()
    expect(await again.text()).toBe('')
  })

  it('compresses when the client accepts it', async () => {
    const res = await app().request('/api/feed/aircraft', { headers: { 'accept-encoding': 'gzip' } })
    expect(res.headers.get('content-encoding')).toBe('gzip')
    expect(res.headers.get('vary')).toContain('Accept-Encoding')
  })

  it('rejects unknown feeds, and known ones this server does not carry', async () => {
    expect((await app().request('/api/feed/passwords')).status).toBe(404)
    expect((await app().request('/api/feed/trains')).status).toBe(404)
  })

  it('reports a locked feed without calling it', async () => {
    let called = false
    const locked: FeedRegistry = {
      aircraft: {
        ...aircraft,
        requiresEnv: ['SOME_KEY'],
        load: async () => {
          called = true
          return { shape: 'entities', entities: [] }
        },
      },
    }
    const instance = createApp({ clientDir: null, feeds: locked, cache: new FeedCache({ log: () => {} }), env: {} })
    expect((await instance.request('/api/feed/aircraft')).status).toBe(503)
    const list = (await (await instance.request('/api/feeds')).json()) as FeedsResponse
    expect(list.feeds[0]).toMatchObject({ id: 'aircraft', status: 'needs-key', count: null })
    expect(called).toBe(false)
  })

  it('lists feed status and attribution', async () => {
    const instance = app()
    const before = (await (await instance.request('/api/feeds')).json()) as FeedsResponse
    expect(before.feeds[0]).toMatchObject({ status: 'idle', updatedAt: null })

    await instance.request('/api/feed/aircraft')
    const after = (await (await instance.request('/api/feeds')).json()) as FeedsResponse
    expect(after.feeds[0]).toMatchObject({ status: 'ok', count: 40, error: null })
    expect(after.feeds[0].attribution[0].label).toBe('Test source')
  })

  it('answers 503 with Retry-After when a feed has never loaded', async () => {
    const failing: FeedRegistry = {
      aircraft: {
        ...aircraft,
        load: async () => {
          throw new Error('boom')
        },
      },
    }
    const instance = createApp({ clientDir: null, feeds: failing, cache: new FeedCache({ log: () => {} }) })
    const res = await instance.request('/api/feed/aircraft')
    expect(res.status).toBe(503)
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0)
    expect(await res.json()).toEqual({ error: 'unavailable', message: 'The feed could not be read' })
  })
})

describe('client files', () => {
  it('serves the app shell uncached', async () => {
    const res = await createApp({ clientDir }).request('/')
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-cache')
    expect(await res.text()).toContain('id="root"')
  })

  it('serves hashed assets as immutable', async () => {
    const res = await createApp({ clientDir }).request('/assets/app-abc123.js')
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toContain('immutable')
  })

  it('falls back to the app shell for navigations', async () => {
    const res = await createApp({ clientDir }).request('/some/deep/route')
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('id="root"')
  })

  it('returns a real 404 for a missing file instead of the app shell', async () => {
    const res = await createApp({ clientDir }).request('/assets/gone-000000.js')
    expect(res.status).toBe(404)
    expect(await res.text()).not.toContain('id="root"')
  })

  it('explains itself when the client has not been built', async () => {
    const res = await createApp({ clientDir: null }).request('/')
    expect(res.status).toBe(503)
  })
})
