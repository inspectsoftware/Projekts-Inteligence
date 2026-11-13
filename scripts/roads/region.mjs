// A region's roads, lane by lane, as GeoJSON, for looking at the lane builder's work outside the map:
//   node scripts/roads/region.mjs w,s,e,n out.geojson
import { readFileSync, existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { buildRoads } from '../../server/streets/lanes.mjs'
import { BUCKET_ZOOM, ROADS_DIR, bucketOf } from './buckets.mjs'

const [box, out] = process.argv.slice(2)
const bbox = box.split(',').map(Number)
// Roads reaching this far past the region are read too, so the roads at its edge are whole.
const M = 0.004
const [w, s, e, n] = [bbox[0] - M, bbox[1] - M, bbox[2] + M, bbox[3] + M]
const inBox = ([x, y]) => x > w && x < e && y > s && y < n

const squares = new Set()
for (let x = w; x <= e + 0.05; x += 0.05) for (let y = s; y <= n + 0.03; y += 0.03) squares.add(bucketOf([Math.min(x, e), Math.min(y, n)]))
const ways = new Map(), nodes = []
for (const key of squares) {
  const file = join(ROADS_DIR, String(BUCKET_ZOOM), `${key}.ndjson.gz`)
  if (!existsSync(file)) continue
  for (const line of gunzipSync(readFileSync(file)).toString('utf8').split('\n')) {
    if (!line) continue
    const o = JSON.parse(line)
    if (o.coords) {
      if (o.coords.some(inBox)) ways.set(o.id, o)
    } else nodes.push(o)
  }
}
const used = new Set([...ways.values()].flatMap((wy) => wy.nodes))
const fc = buildRoads([...ways.values()], nodes.filter((nd) => used.has(nd.node)), bbox)
writeFileSync(out, JSON.stringify(fc))
const count = {}
for (const f of fc.features) count[f.properties.kind] = (count[f.properties.kind] ?? 0) + 1
console.log(out, ways.size, 'ways', count)
