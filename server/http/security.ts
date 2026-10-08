import type { MiddlewareHandler } from 'hono'
import { buildCsp } from '../../shared/csp'

export function securityHeaders(): MiddlewareHandler {
  const csp = buildCsp()
  return async (c, next) => {
    // Set up front so every response built through the context carries them.
    c.header('Content-Security-Policy', csp)
    c.header('X-Content-Type-Options', 'nosniff')
    // Browsers ignore this over plain http, so local development is unaffected.
    c.header('Strict-Transport-Security', 'max-age=31536000')
    // frame-ancestors in the policy already covers this; older browsers and header scanners read this one.
    c.header('X-Frame-Options', 'DENY')
    c.header('Cross-Origin-Opener-Policy', 'same-origin')
    c.header('Cross-Origin-Resource-Policy', 'same-origin')
    c.header('Referrer-Policy', 'strict-origin-when-cross-origin')
    c.header('Permissions-Policy', 'geolocation=(), camera=(), microphone=()')
    await next()
  }
}
