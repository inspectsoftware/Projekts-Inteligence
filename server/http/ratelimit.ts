import type { Context, MiddlewareHandler } from 'hono'

const WINDOW_MS = 60_000

/** PROXY_HOPS: how many of the host's own proxies stand between a visitor and this process. 0 when it is not set. */
export function proxyHops(env: NodeJS.ProcessEnv): number {
  const hops = Number(env.PROXY_HOPS)
  return Number.isInteger(hops) && hops > 0 && hops <= 10 ? hops : 0
}

/** The addresses in X-Forwarded-For, the caller's own claims first and the host's proxies' additions last. */
export function forwardedChain(c: Context): string[] {
  return (c.req.header('x-forwarded-for') ?? '').split(',').map((address) => address.trim()).filter(Boolean)
}

const PRIVATE = /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|::1$|f[cd][0-9a-f]{2}:|fe80:)/i

/**
 * The header's make-up without a single address in it: a letter per distinct address in order of
 * first appearance, starred when it is from a private network. "a b* b*" is one public address
 * followed by the same internal one twice. Enough to work out PROXY_HOPS, and nothing to keep secret.
 */
export function forwardedShape(c: Context): string {
  const letters = new Map<string, string>()
  return forwardedChain(c)
    .map((address) => {
      if (!letters.has(address)) letters.set(address, String.fromCharCode(97 + Math.min(25, letters.size)))
      return `${letters.get(address)}${PRIVATE.test(address) ? '*' : ''}`
    })
    .join(' ')
}

/**
 * Who is calling, or null when nothing says. Each of the host's proxies adds the address it heard
 * from to the end of the header, so with the number of proxies known the caller is that many from
 * the end, and nothing the caller wrote in front of it counts. With the number unknown (0) the
 * first address is taken, which the caller can make up: that dodges a limit, and locks nobody else out.
 */
export function clientAddress(c: Context, hops: number): string | null {
  const chain = forwardedChain(c)
  if (chain.length === 0) return null
  return hops > 0 ? chain[Math.max(0, chain.length - hops)] : chain[0]
}

/**
 * A courtesy limit per client address. Every feed is cached, so a flood cannot reach the
 * upstreams; this only keeps one runaway script from eating the process. A visitor's own
 * polling stays far below it.
 */
export function rateLimit(perMinute: number, now: () => number = Date.now, hops = 0): MiddlewareHandler {
  const clients = new Map<string, { windowStart: number; count: number }>()
  return async (c, next) => {
    const client = clientAddress(c, hops) ?? 'direct'
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
