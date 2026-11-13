// Any spot, drawn by a lane builder beside the LĢIA orthophoto of the same ground:
//   node spot.mjs <lanes.mjs> lon lat [half-width in metres, default 60] out.jpg
// Writes out.jpg (drawing | photo) and out.geojson.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { gunzipSync } from 'node:zlib'
import { paintNear } from '../../../server/streets/paint.mjs'
import { render } from './render.mjs'

const require = createRequire(import.meta.url)
const jpeg = require('jpeg-js')
const { PNG } = require('pngjs')
const here = dirname(fileURLToPath(import.meta.url))
const [builder, lonS, latS, ...rest] = process.argv.slice(2)
const out = rest[rest.length - 1], half = rest.length > 1 ? Number(rest[0]) : 60
const lon = Number(lonS), lat = Number(latS)
const dLon = half / (111320 * Math.cos((lat * Math.PI) / 180)), dLat = half / 110540
const bbox = [lon - dLon, lat - dLat, lon + dLon, lat + dLat]
const mod = await import(pathToFileURL(resolve(builder)).href)
const ROADS = join(process.env.ROADS_DIR ?? join(here, '../../../roads'), '12')
const bucketOf = ([x, y]) => {
  const n = 4096, r = (y * Math.PI) / 180
  return `${Math.floor(((x + 180) / 360) * n)}-${Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n)}`
}
const M = 0.004, box = [bbox[0] - M, bbox[1] - M / 2, bbox[2] + M, bbox[3] + M / 2]
const keys = new Set()
for (let x = box[0]; x <= box[2] + 0.05; x += 0.05) for (let y = box[1]; y <= box[3] + 0.03; y += 0.03) keys.add(bucketOf([Math.min(x, box[2]), Math.min(y, box[3])]))
const ways = new Map(), nodes = []
for (const key of keys) {
  const f = join(ROADS, `${key}.ndjson.gz`)
  if (!existsSync(f)) continue
  for (const l of gunzipSync(readFileSync(f)).toString().split('\n')) {
    if (!l) continue
    const o = JSON.parse(l)
    if (o.coords) { if (o.coords.some(([a, b]) => a > box[0] && a < box[2] && b > box[1] && b < box[3])) ways.set(o.id, o) } else nodes.push(o)
  }
}
const used = new Set([...ways.values()].flatMap((w) => w.nodes))
const fc = mod.buildRoads([...ways.values()], nodes.filter((n) => used.has(n.node)), bbox)
writeFileSync(out.replace(/\.jpg$/, '.geojson'), JSON.stringify(fc))
const { png, W, H } = render(fc, bbox, 900)
const ours = PNG.sync.read(png)
// the photo, from the same cached tiles (z20)
const Z = 20, T = 256 * 2 ** Z
const mx = (v) => ((v + 180) / 360) * T
const my = (v) => ((1 - Math.log(Math.tan(Math.PI / 4 + (v * Math.PI) / 360)) / Math.PI) / 2) * T
await paintNear([bbox]) // fetches and keeps the tiles
const CACHE = join(process.env.CACHE_DIR ?? join((await import('node:os')).tmpdir(), 'pwh-cache'), 'ortho')
const x0 = mx(bbox[0]), y0 = my(bbox[3]), k = W / (mx(bbox[2]) - x0)
const tiles = new Map()
const ph = Buffer.alloc(W * H * 4)
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const wx = x0 + x / k, wy = y0 + y / k, key = `${Math.floor(wx / 256)}-${Math.floor(wy / 256)}`
  if (!tiles.has(key)) {
    const f = join(CACHE, `z${Z}-${key}.bin`)
    const buf = existsSync(f) ? readFileSync(f) : null
    tiles.set(key, buf && buf.length > 100 ? (buf[0] === 0x89 ? PNG.sync.read(buf) : jpeg.decode(buf, { useTArray: true })) : null)
  }
  const t = tiles.get(key), o = (y * W + x) * 4
  if (t) { const i = ((Math.floor(wy) % 256) * t.width + (Math.floor(wx) % 256)) * 4; ph[o] = t.data[i]; ph[o + 1] = t.data[i + 1]; ph[o + 2] = t.data[i + 2] }
  ph[o + 3] = 255
}
const GAP = 8, OW = W * 2 + GAP, both = Buffer.alloc(OW * H * 4, 255)
for (let y = 0; y < H; y++) {
  ours.data.copy(both, y * OW * 4, y * W * 4, (y + 1) * W * 4)
  ph.copy(both, (y * OW + W + GAP) * 4, y * W * 4, (y + 1) * W * 4)
}
writeFileSync(out, jpeg.encode({ data: both, width: OW, height: H }, 85).data)
console.log(out)
