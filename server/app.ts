import { Hono } from 'hono'
import { readBuildInfo } from './buildInfo'
import { FeedCache } from './core/cache'
import { createDiskStore } from './core/disk'
import { FEEDS, type FeedRegistry } from './feeds/registry'
import { rateLimit } from './http/ratelimit'
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
}

export function createApp(options: AppOptions = {}): Hono {
  const app = new Hono()
  const env = options.env ?? process.env
  const feeds = options.feeds ?? FEEDS

  app.use('*', securityHeaders())
  app.use('/api/*', rateLimit(options.requestsPerMinute ?? 600))
  app.route(
    '/api',
    apiRoutes({
      build: readBuildInfo(),
      startedAt: Date.now(),
      feeds,
      cache: options.cache ?? new FeedCache({ env, disk: createDiskStore(), resolve: (id) => feeds[id] }),
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
