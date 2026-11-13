// The roads, cut into z12 squares (about 5 km), one gzipped NDJSON file each: roads/12/<x>-<y>.ndjson.gz.
// A way goes into every square it touches, a node into the one it stands in; the server reads the
// squares a tile reaches (server/streets/roads.ts). roads/meta.json says when they were built.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

export const BUCKET_ZOOM = 12
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
export const ROADS_DIR = process.env.ROADS_DIR ?? join(ROOT, 'roads')

export function bucketOf([lon, lat]) {
  const n = 2 ** BUCKET_ZOOM
  const r = (lat * Math.PI) / 180
  return `${Math.floor(((lon + 180) / 360) * n)}-${Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n)}`
}

/** ways: {id, tags, nodes, coords}; nodes: {node, tags, coord}. */
export function writeBuckets(ways, nodes, dir = ROADS_DIR, source = '') {
  const lines = new Map()
  const add = (key, line) => {
    if (!lines.has(key)) lines.set(key, [])
    lines.get(key).push(line)
  }
  for (const w of ways) {
    const line = JSON.stringify(w)
    for (const key of new Set(w.coords.map(bucketOf))) add(key, line)
  }
  for (const n of nodes) add(bucketOf(n.coord), JSON.stringify(n))
  rmSync(join(dir, String(BUCKET_ZOOM)), { recursive: true, force: true })
  mkdirSync(join(dir, String(BUCKET_ZOOM)), { recursive: true })
  for (const [key, list] of lines) writeFileSync(join(dir, String(BUCKET_ZOOM), `${key}.ndjson.gz`), gzipSync(list.join('\n') + '\n'))
  writeFileSync(join(dir, 'meta.json'), JSON.stringify({ built: new Date().toISOString(), source, ways: ways.length, nodes: nodes.length, buckets: lines.size }, null, 2))
  return lines.size
}

