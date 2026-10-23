import { Hono } from 'hono'
import { readBuildInfo } from './buildInfo'
import { FeedCache } from './core/cache'
import { createDiskStore } from './core/disk'
import { History } from './core/history'
import { FEEDS, type FeedRegistry } from './feeds/registry'
import { proxyHops, rateLimit } from './http/ratelimit'
import type { Room } from './http/room'
import { apiRoutes } from './http/routes'
import { securityHeaders } from './http/security'
import { mountClient } from './http/static'
import { findClientDir } from './paths'

export interface AppOptions {
  /** Built client directory. Defaults to auto-discovery; null serves the API only. */
  clientDir?: string | null
  /** Overridable for tests. */
  feeds?: FeedRegistry
  cache?: FeedCache
  env?: NodeJS.ProcessEnv
  room?: Room
  /** API requests allowed per client address per minute. An open tab makes about forty. */
  requestsPerMinute?: number
  /** Taken down on purpose: every page and API call answers 503, and nothing behind them runs. */
  offline?: boolean
}

const OFFLINE_PAGE =
  '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Projekts Inteliģence: offline</title><p>Projekts Inteliģence is offline for maintenance and will be back soon.</p></html>'

export function createApp(options: AppOptions = {}): Hono {
  const app = new Hono()
  const env = options.env ?? process.env
  const feeds = options.feeds ?? FEEDS

  app.use('*', securityHeaders())
  if (options.offline) {
    app.all('*', (c) => {
      c.header('Retry-After', '3600')
      c.header('Cache-Control', 'no-store')
      return c.html(OFFLINE_PAGE, 503)
    })
    return app
  }
  app.use('/api/*', rateLimit(options.requestsPerMinute ?? 600, Date.now, proxyHops(env)))
  const history = new History()
  app.route(
    '/api',
    apiRoutes({
      build: readBuildInfo(),
      feeds,
      cache:
        options.cache ??
        new FeedCache({ env, disk: createDiskStore(), resolve: (id) => feeds[id], onSnapshot: (id, snapshot) => history.record(id, snapshot) }),
      history,
      env,
      room: options.room,
    }),
  )
  mountClient(app, options.clientDir === undefined ? findClientDir() : options.clientDir)

  app.onError((err, c) => {
    console.error('[pwh] request failed:', err)
    return c.json({ error: 'internal' }, 500)
  })

  return app
}
