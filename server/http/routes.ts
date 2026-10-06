import { Hono } from 'hono'
import { APP } from '../../shared/meta'
import type { BuildInfo } from '../buildInfo'

export interface ApiDeps {
  build: BuildInfo
  startedAt: number
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

  api.all('*', (c) => c.json({ error: 'not_found' }, 404))

  return api
}
