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

/**
 * Where our own vector tiles are (tiles/baltic.pmtiles, built by scripts/build-tiles.mjs): TILES_DIR
 * when set, as on the host, where the file is put by hand; else tiles/ at the project's root.
 */
export function findTilesDir(env: Record<string, string | undefined> = process.env): string | null {
  if (env.TILES_DIR) return existsSync(env.TILES_DIR) ? env.TILES_DIR : null
  for (const dir of [resolve(here, '../tiles'), resolve(here, '../../tiles'), resolve(here, '../../../tiles')]) {
    if (existsSync(join(dir, 'baltic.pmtiles'))) return dir
  }
  return null
}

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
