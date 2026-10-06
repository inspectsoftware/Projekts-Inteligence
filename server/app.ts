import { Hono } from 'hono'
import { readBuildInfo } from './buildInfo'
import { FeedCache } from './core/cache'
import { createDiskStore } from './core/disk'
import { FEEDS, type FeedRegistry } from './feeds/registry'
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
}

export function createApp(options: AppOptions = {}): Hono {
  const app = new Hono()
  const env = options.env ?? process.env

  app.use('*', securityHeaders())
  app.route(
    '/api',
    apiRoutes({
      build: readBuildInfo(),
      startedAt: Date.now(),
      feeds: options.feeds ?? FEEDS,
      cache: options.cache ?? new FeedCache({ env, disk: createDiskStore() }),
      env,
    }),
  )
  mountClient(app, options.clientDir === undefined ? findClientDir() : options.clientDir)

  app.onError((err, c) => {
    console.error('[pwh] request failed:', err)
    return c.json({ error: 'internal' }, 500)
  })

  return app
}
