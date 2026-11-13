// How close the builder's islands (gores) are to islands drawn by hand over the photo (reference/*.geojson:
// the drawn lines as points, with the bbox and width in pixels of the picture they were drawn on).
//   node compare.mjs <features.geojson> [reference.geojson] [outDir]
// For each drawn place: "on line" - the share of our island edges (of the islands there) within 0.6 m of a
// drawn line; "covered" - the share of the drawn lines within 0.6 m of one of our edges. Writes
// <outDir>/compare-<n>.png: the photo's paint white, the drawn lines green, our islands red.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const jpeg = require('jpeg-js')
const { PNG } = require('pngjs')
const here = dirname(fileURLToPath(import.meta.url))
const [gj, refPath = join(here, 'reference/a10-loop.geojson'), outDir = '.'] = process.argv.slice(2)
const fc = JSON.parse(readFileSync(gj, 'utf8'))
const ref = JSON.parse(readFileSync(refPath, 'utf8'))
const CACHE = join(process.env.CACHE_DIR ?? join(tmpdir(), 'pwh-cache'), 'ortho')
const SERVICE = 'https://geoserver.lvmgeo.lv/wmts8699a6fe9bb543bcbf4e463a88bf9049?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=Orto_LKS&STYLE=raster&TILEMATRIXSET=WebMercatorQuad&FORMAT=image/vnd.jpeg-png8'
const Z = 20, T = 256 * 2 ** Z
const mx = (lon) => ((lon + 180) / 360) * T
const my = (lat) => ((1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2) * T
mkdirSync(outDir, { recursive: true })

const scores = []
for (const [n, place] of ref.features.entries()) {
  const { bbox, px } = place.properties
  const x0 = mx(bbox[0]), y0 = my(bbox[3]), k = px / (mx(bbox[2]) - x0)
  const W = px, H = Math.round((my(bbox[1]) - y0) * k)
  const mpp = (40075016.686 * Math.cos((((bbox[1] + bbox[3]) / 2) * Math.PI) / 180)) / T / k
  const P = ([lon, lat]) => [(mx(lon) - x0) * k, (my(lat) - y0) * k]
  const drawn = place.geometry.coordinates.map(P)
  // a grid of the drawn points, for "is there one near"
  const G = 8, grid = new Map()
  const key = (x, y) => `${Math.floor(x / G)},${Math.floor(y / G)}`
  for (const p of drawn) { const kk = key(...p); if (!grid.has(kk)) grid.set(kk, []); grid.get(kk).push(p) }
  const nearDrawn = (p, r) => {
    for (let gx = Math.floor((p[0] - r) / G); gx <= Math.floor((p[0] + r) / G); gx++) for (let gy = Math.floor((p[1] - r) / G); gy <= Math.floor((p[1] + r) / G); gy++) for (const q of grid.get(`${gx},${gy}`) ?? []) if (Math.hypot(q[0] - p[0], q[1] - p[1]) <= r) return true
    return false
  }
  // our islands there: gores with any corner within 3 m of a drawn line
  // An open island's edges are its two sides; the line across its far end is not painted, so not counted.
  const ours = fc.features.filter((f) => f.properties.kind === 'gore' && f.geometry.type === 'Polygon').map((f) => {
    const r = f.geometry.coordinates[0].map(P)
    return f.properties.open && f.properties.edge ? [r.slice(0, f.properties.edge), r.slice(f.properties.edge)] : [r]
  }).filter((parts) => parts.flat().some((p) => nearDrawn(p, 3 / mpp)))
  const edge = []
  for (const r of ours.flat()) for (let i = 0; i + 1 < r.length; i++) {
    const [a, b] = [r[i], r[i + 1]], L = Math.hypot(b[0] - a[0], b[1] - a[1])
    for (let t = 0; t < L; t += 0.25 / mpp) edge.push([a[0] + ((b[0] - a[0]) * t) / L, a[1] + ((b[1] - a[1]) * t) / L])
  }
  const tol = 0.6 / mpp
  const onLine = edge.length ? edge.filter((p) => nearDrawn(p, tol)).length / edge.length : 0
  const egrid = new Map()
  for (const p of edge) { const kk = key(...p); if (!egrid.has(kk)) egrid.set(kk, []); egrid.get(kk).push(p) }
  const nearEdge = (p, r) => {
    for (let gx = Math.floor((p[0] - r) / G); gx <= Math.floor((p[0] + r) / G); gx++) for (let gy = Math.floor((p[1] - r) / G); gy <= Math.floor((p[1] + r) / G); gy++) for (const q of egrid.get(`${gx},${gy}`) ?? []) if (Math.hypot(q[0] - p[0], q[1] - p[1]) <= r) return true
    return false
  }
  const covered = drawn.length ? drawn.filter((p) => nearEdge(p, tol)).length / drawn.length : 0
  scores.push({ place: place.properties.place, islands: ours.length, onLine: Math.round(onLine * 100), covered: Math.round(covered * 100) })

  // the picture
  const tiles = new Map()
  for (let ty = Math.floor(y0 / 256); ty <= Math.floor((y0 + H / k) / 256); ty++) for (let tx = Math.floor(x0 / 256); tx <= Math.floor((x0 + W / k) / 256); tx++) {
    const file = join(CACHE, `z${Z}-${tx}-${ty}.bin`)
    let buf = existsSync(file) ? readFileSync(file) : null
    if (!buf) {
      const res = await fetch(`${SERVICE}&TILEMATRIX=${Z}&TILEROW=${ty}&TILECOL=${tx}`)
      buf = res.ok ? Buffer.from(await res.arrayBuffer()) : null
      if (buf) { mkdirSync(CACHE, { recursive: true }); writeFileSync(file, buf) }
    }
    tiles.set(`${tx}-${ty}`, buf ? (buf[0] === 0x89 ? PNG.sync.read(buf) : jpeg.decode(buf, { useTArray: true })) : null)
  }
  const img = new PNG({ width: W, height: H })
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const wx = x0 + x / k, wy = y0 + y / k, t = tiles.get(`${Math.floor(wx / 256)}-${Math.floor(wy / 256)}`), o = (y * W + x) * 4
    let v = 0
    if (t) { const i = ((Math.floor(wy) % 256) * t.width + (Math.floor(wx) % 256)) * 4; const r = t.data[i], g = t.data[i + 1], b = t.data[i + 2]; v = (r + g + b) / 3 > 175 && Math.max(r, g, b) - Math.min(r, g, b) < 40 ? 200 : 0 }
    img.data[o] = img.data[o + 1] = img.data[o + 2] = v; img.data[o + 3] = 255
  }
  const dot = ([x, y], c) => { for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const X = Math.round(x) + dx, Y = Math.round(y) + dy; if (X < 0 || Y < 0 || X >= W || Y >= H) continue; const o = (Y * W + X) * 4; img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2] } }
  for (const p of drawn) dot(p, [40, 200, 80])
  for (const p of edge) dot(p, [255, 40, 40])
  writeFileSync(join(outDir, `compare-${n}.png`), PNG.sync.write(img))
}
for (const s of scores) console.log(`${s.place}: ${s.islands} islands, on line ${s.onLine}%, covered ${s.covered}%`)
