import { Hono } from 'hono'
import { FEED_HEADERS, type FeedMeta, type FeedStatus, type FeedsResponse, isFeedId } from '../../shared/feeds'
import { APP } from '../../shared/meta'
import type { BuildInfo } from '../buildInfo'
import { type FeedCache, type FeedState, FeedUnavailable } from '../core/cache'
import type { FeedRegistry } from '../feeds/registry'
import { cameraFrame } from '../feeds/roads'
import type { FeedDef } from '../feeds/types'

export interface ApiDeps {
  build: BuildInfo
  startedAt: number
  feeds: FeedRegistry
  cache: FeedCache
  env: NodeJS.ProcessEnv
}

function missingKey(def: FeedDef, env: NodeJS.ProcessEnv): boolean {
  return (def.requiresEnv ?? []).some((name) => !env[name])
}

function describe(def: FeedDef, state: FeedState, now: number, env: NodeJS.ProcessEnv): FeedMeta {
  let status: FeedStatus
  if (missingKey(def, env)) status = 'needs-key'
  else if (!state.snapshot) status = state.error ? 'error' : 'idle'
  else {
    const age = now - state.snapshot.updatedAt
    // Nobody may be watching this feed right now; an old copy is then "idle", not a fault.
    if (age < def.ttlMs * 2) status = 'ok'
    else if (state.error) status = 'error'
    else status = age < def.staleMs ? 'stale' : 'idle'
  }
  return {
    id: def.id,
    title: def.title,
    ttlMs: def.ttlMs,
    status,
    updatedAt: state.snapshot?.updatedAt ?? null,
    count: state.snapshot?.count ?? null,
    error: state.error,
    attribution: def.attribution,
  }
}

export function apiRoutes(deps: ApiDeps): Hono {
  const api = new Hono()

  api.get('/health', (c) => {
    c.header('Cache-Control', 'no-store')
    return c.json({
      ok: true,
      name: APP.name,
      commit: deps.build.commit,
      builtAt: deps.build.builtAt,
      node: process.version,
      startedAt: deps.startedAt,
      uptimeS: Math.round((Date.now() - deps.startedAt) / 1000),
      now: Date.now(),
    })
  })

  api.get('/feeds', (c) => {
    const now = Date.now()
    const body: FeedsResponse = {
      serverTime: now,
      feeds: Object.values(deps.feeds).map((def) => describe(def, deps.cache.peek(def.id), now, deps.env)),
    }
    c.header('Cache-Control', 'no-store')
    return c.json(body)
  })

  api.get('/feed/:id', async (c) => {
    const id = c.req.param('id')
    const def = isFeedId(id) ? deps.feeds[id] : undefined
    if (!def) return c.json({ error: 'unknown_feed' }, 404)

    c.header('Cache-Control', 'no-store')
    c.header(FEED_HEADERS.serverTime, String(Date.now()))
    if (missingKey(def, deps.env)) return c.json({ error: 'needs_key' }, 503)

    let hit
    try {
      hit = await deps.cache.get(def)
    } catch (err) {
      if (!(err instanceof FeedUnavailable)) throw err
      c.header('Retry-After', String(Math.ceil(err.retryAfterMs / 1000)))
      return c.json({ error: 'unavailable', message: err.message }, 503)
    }

    const { snapshot } = hit
    c.header(FEED_HEADERS.serverTime, String(Date.now()))
    c.header(FEED_HEADERS.stale, hit.stale ? '1' : '0')
    c.header(FEED_HEADERS.nextPoll, String(Math.round(hit.nextPollMs)))
    c.header('ETag', snapshot.etag)
    c.header('Vary', 'Accept-Encoding')
    if (c.req.header('if-none-match') === snapshot.etag) return c.body(null, 304)

    const { body, encoding } = snapshot.encoded(c.req.header('accept-encoding') ?? '')
    if (encoding) c.header('Content-Encoding', encoding)
    c.header('Content-Type', 'application/json; charset=utf-8')
    return c.body(new Uint8Array(body))
  })

  /** Latest still from one road camera. The frames arrive inside the cameras feed and are kept in memory. */
  api.get('/camera/:id', async (c) => {
    const def = deps.feeds.cameras
    // After a restart nothing is held yet: loading the feed brings the frames back.
    if (def) await deps.cache.get(def).catch(() => undefined)
    const frame = cameraFrame(c.req.param('id'))
    if (!frame) return c.json({ error: 'not_found' }, 404)
    c.header('Content-Type', 'image/jpeg')
    c.header('Cache-Control', 'public, max-age=120')
    return c.body(new Uint8Array(frame))
  })

  api.all('*', (c) => c.json({ error: 'not_found' }, 404))

  return api
}
