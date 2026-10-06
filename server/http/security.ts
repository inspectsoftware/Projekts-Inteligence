import type { MiddlewareHandler } from 'hono'
import { buildCsp } from '../../shared/csp'

export function securityHeaders(): MiddlewareHandler {
  const csp = buildCsp()
  return async (c, next) => {
    // Set up front so every response built through the context carries them.
    c.header('Content-Security-Policy', csp)
    c.header('X-Content-Type-Options', 'nosniff')
    c.header('Referrer-Policy', 'strict-origin-when-cross-origin')
    c.header('Permissions-Policy', 'geolocation=(), camera=(), microphone=()')
    await next()
  }
}
