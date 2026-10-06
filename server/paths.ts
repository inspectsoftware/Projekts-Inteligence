import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

/**
 * Directory this module was loaded from: dist/server (or a chunk folder under it)
 * when built, server/ when run from source. Paths are always derived from it and
 * never from cwd, because the host decides the working directory.
 */
export const SERVER_DIR = here

/** Locates the built client (dist/client), or null when it has not been built. */
export function findClientDir(): string | null {
  const candidates = [
    resolve(here, '../client'), // dist/server/index.js
    resolve(here, '../../client'), // dist/server/<chunk dir>/x.js
    resolve(here, '../dist/client'), // server/*.ts run from source
    resolve(here, '../../dist/client'), // server/<dir>/*.ts run from source
  ]
  for (const dir of candidates) {
    if (existsSync(join(dir, 'index.html'))) return dir
  }
  return null
}
