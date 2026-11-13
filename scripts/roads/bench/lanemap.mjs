// The lanes as the navigator graph has them, over the photo: every lane's middle, coloured by what it does -
// grey goes on, orange ends (into the lane beside it), blue is new (from the lane beside it), purple leaves
// with a slip road, green joins from one. A white dot where lanes link.
//   node lanemap.mjs <features.geojson> west south east north px out.png
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const jpeg = require('jpeg-js')
const { PNG } = require('pngjs')
const here = dirname(fileURLToPath(import.meta.url))
const [gj, w, s, e, n, pxs, out] = process.argv.slice(2)
const bbox = [w, s, e, n].map(Number), PX = Number(pxs)
const g = JSON.parse(readFileSync(gj, 'utf8')).laneGraph
const debug = join(here, '../../.cache/roads/sumo/debug.mjs')
execFileSync('node', [debug, w, s, e, n, pxs, out + '.photo.jpg', 'none'])
const ph = jpeg.decode(readFileSync(out + '.photo.jpg'), { useTArray: true })
const W = ph.width, H = ph.height
const img = new PNG({ width: W, height: H })
for (let i = 0; i < W * H; i++) for (let c = 0; c < 3; c++) img.data[i * 4 + c] = ph.data[i * 4 + c] * 0.45
for (let i = 0; i < W * H; i++) img.data[i * 4 + 3] = 255
const T = 256 * 2 ** 20
const mx = (lon) => ((lon + 180) / 360) * T
const my = (lat) => ((1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2) * T
const x0 = mx(bbox[0]), y0 = my(bbox[3]), k = PX / (mx(bbox[2]) - x0)
const P = ([lon, lat]) => [(mx(lon) - x0) * k, (my(lat) - y0) * k]
const dot = (x, y, c, r) => { for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { if (dx * dx + dy * dy > r * r) continue; const X = Math.round(x) + dx, Y = Math.round(y) + dy; if (X < 0 || Y < 0 || X >= W || Y >= H) continue; const o = (Y * W + X) * 4; img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2] } }
const polyline = (pts, c, r) => { const p = pts.map(P); for (let i = 0; i + 1 < p.length; i++) { const L = Math.hypot(p[i + 1][0] - p[i][0], p[i + 1][1] - p[i][1]) || 1; for (let t = 0; t <= L; t += 0.7) dot(p[i][0] + ((p[i + 1][0] - p[i][0]) * t) / L, p[i][1] + ((p[i + 1][1] - p[i][1]) * t) / L, c, r) } }
const COL = { on: [170, 170, 170], ends: [255, 140, 30], new: [60, 140, 255], leaves: [200, 80, 255], joins: [60, 220, 120] }
const role = new Map()
for (const [a, i, b, j, kind] of g.edges) {
  if (kind === 'ends' || kind === 'leaves' && false) role.set(`${a}#${i}`, kind)
  if (kind === 'new' || kind === 'leaves') role.set(`${b}#${j}`, kind)
  if (kind === 'joins') role.set(`${a}#${i}`, kind)
}
for (const [id, lanes] of Object.entries(g.lanes)) lanes.forEach((pts, i) => polyline(pts, COL[role.get(`${id}#${i}`) ?? 'on'], role.has(`${id}#${i}`) ? 2 : 1))
for (const [a, i, b, j] of g.edges) {
  const A = g.lanes[a]?.[i], B = g.lanes[b]?.[j]
  if (!A || !B) continue
  polyline([A[A.length - 1], B[0]], [255, 255, 255], 1)
  const [x, y] = P(B[0]); dot(x, y, [255, 255, 255], 3)
}
writeFileSync(out, PNG.sync.write(img))
console.log(out, W, H)
