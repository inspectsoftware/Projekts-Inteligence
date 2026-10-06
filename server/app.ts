import { Hono } from 'hono'
import { readBuildInfo } from './buildInfo'
import { apiRoutes } from './http/routes'
import { securityHeaders } from './http/security'
import { mountClient } from './http/static'
import { findClientDir } from './paths'

export interface AppOptions {
  /** Built client directory. Defaults to auto-discovery; null serves the API only. */
  clientDir?: string | null
}

export function createApp(options: AppOptions = {}): Hono {
  const app = new Hono()

  app.use('*', securityHeaders())
  app.route('/api', apiRoutes({ build: readBuildInfo(), startedAt: Date.now() }))
  mountClient(app, options.clientDir === undefined ? findClientDir() : options.clientDir)

  app.onError((err, c) => {
    console.error('[pwh] request failed:', err)
    return c.json({ error: 'internal' }, 500)
  })

  return app
}
