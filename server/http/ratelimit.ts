import type { MiddlewareHandler } from 'hono'

const WINDOW_MS = 60_000

/**
 * A courtesy limit per client address. Every feed is cached, so a flood cannot reach the
 * upstreams; this only keeps one runaway script from eating the process. A visitor's own
 * polling stays far below it.
 */
export function rateLimit(perMinute: number, now: () => number = Date.now): MiddlewareHandler {
  const clients = new Map<string, { windowStart: number; count: number }>()
  return async (c, next) => {
    // Behind the host's proxy the caller is the first address in this header. It can be forged,
    // which lets a caller dodge the limit but never lock anyone else out.
    const client = c.req.header('x-forwarded-for')?.split(',')[0].trim() || 'direct'
    const at = now()
    let entry = clients.get(client)
    if (!entry || at - entry.windowStart >= WINDOW_MS) {
      // ponytail: the table is simply emptied when it grows large; use an LRU if that ever shows up in practice.
      if (clients.size > 10_000) clients.clear()
      clients.set(client, (entry = { windowStart: at, count: 0 }))
    }
    entry.count += 1
    if (entry.count > perMinute) {
      c.header('Retry-After', String(Math.ceil((entry.windowStart + WINDOW_MS - at) / 1000)))
      return c.json({ error: 'rate_limited' }, 429)
    }
    await next()
  }
}
