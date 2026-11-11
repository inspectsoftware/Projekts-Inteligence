import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { serveStatic } from '@hono/node-server/serve-static'
import type { Hono } from 'hono'

const HAS_EXTENSION = /\.[a-z0-9]{1,8}$/i

function cacheControlFor(urlPath: string): string {
  // Vite content-hashes everything under assets/, so those can be cached forever.
  if (urlPath.startsWith('/assets/')) return 'public, max-age=31536000, immutable'
  // Directory requests resolve to index.html, which must always be revalidated.
  if (!HAS_EXTENSION.test(urlPath) || urlPath.endsWith('.html')) return 'no-cache'
  return 'public, max-age=3600'
}

/**
 * Serves our own vector tiles, a PMTiles file the map reads a few kilobytes at a time with HTTP
 * range requests (serveStatic answers those). Rebuilt weekly at most, so an hour's caching is safe;
 * the client asks for it by a version in the URL when it changes.
 */
export function mountTiles(app: Hono, tilesDir: string | null): void {
  if (!tilesDir) return
  const files = serveStatic({ root: tilesDir, rewriteRequestPath: (path) => path.replace(/^\/tiles/, '') })
  app.use('/tiles/*', (c, next) => {
    c.header('Cache-Control', 'public, max-age=3600')
    return files(c, next)
  })
}

/** Serves the built client and falls back to index.html for app routes. */
export function mountClient(app: Hono, clientDir: string | null): void {
  if (!clientDir) {
    app.get('*', (c) =>
      c.text('Client build not found. Run `npm run build`, or use the Vite dev server on :5173.', 503),
    )
    return
  }

  const files = serveStatic({ root: clientDir, precompressed: true })
  app.use('*', (c, next) => {
    // Set before the file middleware builds its response; its onFound hook runs too late for that.
    c.header('Cache-Control', cacheControlFor(c.req.path))
    return files(c, next)
  })

  // The app has one page and keeps its view in the URL hash, so only / gets the app shell.
  // Anything else is a real 404: a hashed chunk from the previous deploy must not come back
  // as index.html, and a scanner probing /admin or /.git/config must not be told 200.
  let indexHtml: Promise<string> | null = null
  app.get('*', async (c) => {
    if (c.req.path !== '/') {
      c.header('Cache-Control', 'no-store')
      return c.text('Not found', 404)
    }
    indexHtml ??= readFile(join(clientDir, 'index.html'), 'utf8')
    c.header('Cache-Control', 'no-cache')
    return c.html(await indexHtml)
  })
}
