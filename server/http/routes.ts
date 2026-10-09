import { type Context, Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { FEED_HEADERS, type FeedMeta, type FeedStatus, type FeedsResponse, isFeedId } from '../../shared/feeds'
import { isLang } from '../../shared/i18n'
import { APP } from '../../shared/meta'
import { type RadioResponse, isRadioBy } from '../../shared/radio'
import { type ChatResponse, type PresenceResponse, VISITOR_HEADER, isVisitorId } from '../../shared/room'
import type { BuildInfo } from '../buildInfo'
import { type FeedCache, type FeedState, FeedUnavailable } from '../core/cache'
import { camStill } from '../feeds/cams'
import type { FeedRegistry } from '../feeds/registry'
import { cameraFrame } from '../feeds/roads'
import type { FeedDef } from '../feeds/types'
import { PlaceBusy, createPlaceLookup } from './place'
import { createRadioSearch } from './radio'
import { rateLimit } from './ratelimit'
import { type Room, createRoom, ownerFrom } from './room'
import { ViewBusy, createViewAircraft } from './viewAircraft'

export interface ApiDeps {
  build: BuildInfo
  startedAt: number
  feeds: FeedRegistry
  cache: FeedCache
  env: NodeJS.ProcessEnv
  /** Overridable for tests. */
  room?: Room
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
  const places = createPlaceLookup()
  const views = createViewAircraft()
  const room = deps.room ?? createRoom(Date.now, Math.random, ownerFrom(deps.env))
  const radio = createRadioSearch()

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

  /** Latest still of a live camera whose publisher only serves it to its own pages. Cameras on our own list only. */
  api.get('/cam/:id', async (c) => {
    let still
    try {
      still = await camStill(c.req.param('id'))
    } catch {
      return c.json({ error: 'unavailable' }, 503)
    }
    if (!still) return c.json({ error: 'not_found' }, 404)
    c.header('Content-Type', 'image/jpeg')
    c.header('Cache-Control', 'public, max-age=30')
    return c.body(new Uint8Array(still))
  })

  /** Aircraft around a point outside the region the aircraft feed covers, by grid cell (?lat=&lon=). */
  api.get('/aircraft', async (c) => {
    const [lat, lon] = [Number(c.req.query('lat')), Number(c.req.query('lon'))]
    if (!c.req.query('lat') || !c.req.query('lon') || !(Math.abs(lat) <= 90) || !(Math.abs(lon) <= 180)) return c.json({ error: 'bad_request' }, 400)
    try {
      const view = await views.around(lat, lon)
      c.header('Cache-Control', 'public, max-age=5')
      return c.json(view)
    } catch (err) {
      if (err instanceof ViewBusy) c.header('Retry-After', '10')
      return c.json({ error: 'unavailable' }, 503)
    }
  })

  /** What is known about a point on the map (?lon=&lat=&zoom=) or about a place by name (?q=). */
  api.get('/place', async (c) => {
    const { lon, lat, zoom, q } = c.req.query()
    const asked = c.req.query('lang') ?? ''
    const lang = isLang(asked) ? asked : 'en'
    const [x, y] = [Number(lon), Number(lat)]
    const byName = typeof q === 'string' && q.trim().length >= 2
    if (!byName && !(lon && lat && Math.abs(x) <= 180 && Math.abs(y) <= 90)) return c.json({ error: 'bad_request' }, 400)
    try {
      const place = byName ? await places.search(q, lang) : await places.at(x, y, Number(zoom) || 10, lang)
      if (!place) return c.json({ error: 'not_found' }, 404)
      c.header('Cache-Control', 'public, max-age=3600')
      return c.json(place)
    } catch (err) {
      if (err instanceof PlaceBusy) c.header('Retry-After', '5')
      return c.json({ error: 'unavailable' }, 503)
    }
  })

  /** Radio stations anywhere, by name, country or genre (?by=&q=). Each new search costs the directory a request, so it has a limit of its own. */
  api.get('/radio', rateLimit(30), async (c) => {
    const by = c.req.query('by') ?? 'name'
    const q = (c.req.query('q') ?? '').trim()
    if (!isRadioBy(by) || q.length < 2 || q.length > 60) return c.json({ error: 'bad_request' }, 400)
    try {
      const stations = await radio.search(by, q)
      c.header('Cache-Control', 'public, max-age=600')
      return c.json({ stations } satisfies RadioResponse)
    } catch {
      return c.json({ error: 'unavailable' }, 503)
    }
  })

  /** The browser's own made-up id. Asking for it in a header keeps other sites from posting through a visitor's browser. */
  const visitor = (c: Context): string | null => {
    const id = c.req.header(VISITOR_HEADER)
    return isVisitorId(id) ? id : null
  }

  /** How many browsers have been heard from in the last minute and a half. Asking counts as being here. */
  api.get('/presence', (c) => {
    const id = visitor(c)
    if (!id) return c.json({ error: 'bad_request' }, 400)
    room.touch(id)
    c.header('Cache-Control', 'no-store')
    return c.json({ online: room.online(), pinged: room.pinged(id) } satisfies PresenceResponse)
  })

  /** The chat room since a message (?after=), and the name this visitor writes under. */
  api.get('/chat', (c) => {
    const id = visitor(c)
    if (!id) return c.json({ error: 'bad_request' }, 400)
    c.header('Cache-Control', 'no-store')
    return c.json({ name: room.touch(id), messages: room.since(Number(c.req.query('after')) || 0) } satisfies ChatResponse)
  })

  api.post('/chat', rateLimit(20), bodyLimit({ maxSize: 2048, onError: (c) => c.json({ error: 'too_long' }, 413) }), async (c) => {
    const id = visitor(c)
    const body: unknown = await c.req.json().catch(() => null)
    const { text, replyTo } = (body ?? {}) as { text?: unknown; replyTo?: unknown }
    if (!id || typeof text !== 'string') return c.json({ error: 'bad_request' }, 400)
    const result = room.post(id, text, typeof replyTo === 'number' ? replyTo : undefined)
    c.header('Cache-Control', 'no-store')
    if ('refused' in result) return c.json({ error: result.refused }, result.refused === 'too_fast' ? 429 : 400)
    return c.json(result)
  })

  api.all('*', (c) => c.json({ error: 'not_found' }, 404))

  return api
}
