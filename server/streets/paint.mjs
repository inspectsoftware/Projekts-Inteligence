// Where the LĢIA orthophoto (Orto_LKS, free WMTS, no key; Latvia only) shows white road paint, round the
// places asked for: the lane builder puts its islands' edges on the lines painted there (lanes.mjs,
// snapToPaint). Tiles at zoom 20 (about 8 cm, the paint a few pixels wide) are kept in the server's cache
// folder (ortho/). Outside Latvia, or with the service down, there is nothing: the builder goes by its rules.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const jpeg = require('jpeg-js')
const { PNG } = require('pngjs')

const CACHE = join(process.env.CACHE_DIR ?? join(tmpdir(), 'pwh-cache'), 'ortho')
const SERVICE = 'https://geoserver.lvmgeo.lv/wmts8699a6fe9bb543bcbf4e463a88bf9049?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=Orto_LKS&STYLE=raster&TILEMATRIXSET=WebMercatorQuad&FORMAT=image/vnd.jpeg-png8'
const Z = 20, T = 256 * 2 ** Z
const mx = (lon) => ((lon + 180) / 360) * T
const my = (lat) => ((1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2) * T
/** Latvia, roughly: the service has nothing outside it, so no asking there. */
const LATVIA = [20.9, 55.6, 28.3, 58.1]

async function tile(tx, ty) {
  const file = join(CACHE, `z${Z}-${tx}-${ty}.bin`)
  let buf = existsSync(file) ? readFileSync(file) : null
  if (!buf) {
    try {
      const res = await fetch(`${SERVICE}&TILEMATRIX=${Z}&TILEROW=${ty}&TILECOL=${tx}`, { signal: AbortSignal.timeout(10000) })
      if (res.ok) buf = Buffer.from(await res.arrayBuffer())
    } catch {}
    if (buf) {
      mkdirSync(CACHE, { recursive: true })
      writeFileSync(file, buf)
    }
  }
  if (!buf || buf.length < 100) return null
  try {
    return paintMask(buf[0] === 0x89 ? PNG.sync.read(buf) : jpeg.decode(buf, { useTArray: true }))
  } catch {
    return null
  }
}

/**
 * Which pixels of a tile are road paint: clearly lighter (by 30) than the ground round them (17 pixels,
 * about 1.4 m) and grey-white. A faded line on dark asphalt counts; a pale roof, concrete or a pavement,
 * as light as what is round it, does not.
 */
export function paintMask(t) {
  const N = t.width * t.height, V = new Float32Array(N), sat = new Uint8Array(N)
  for (let i = 0; i < N; i++) {
    const r = t.data[i * 4], g = t.data[i * 4 + 1], b = t.data[i * 4 + 2]
    V[i] = (r + g + b) / 3
    sat[i] = Math.max(r, g, b) - Math.min(r, g, b)
  }
  const W = t.width, H = t.height, I = new Float64Array((W + 1) * (H + 1))
  for (let y = 0; y < H; y++) { let row = 0; for (let x = 0; x < W; x++) { row += V[y * W + x]; I[(y + 1) * (W + 1) + x + 1] = I[y * (W + 1) + x + 1] + row } }
  const mask = new Uint8Array(N)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const a = Math.max(0, x - 8), b = Math.max(0, y - 8), c = Math.min(W, x + 9), d = Math.min(H, y + 9)
    const mean = (I[d * (W + 1) + c] - I[b * (W + 1) + c] - I[d * (W + 1) + a] + I[b * (W + 1) + a]) / ((c - a) * (d - b))
    const i = y * W + x
    mask[i] = V[i] > 110 && V[i] - mean > 30 && sat[i] < 45 ? 1 : 0
  }
  return { width: W, mask }
}

/** paint(lon, lat) -> true where the photo shows paint, over the boxes ([w, s, e, n]); null with no photo there. */
export async function paintNear(boxes) {
  const keys = new Set()
  for (const [w, s, e, n] of boxes) {
    if (e < LATVIA[0] || w > LATVIA[2] || n < LATVIA[1] || s > LATVIA[3]) continue
    for (let ty = Math.floor(my(n) / 256); ty <= Math.floor(my(s) / 256); ty++) for (let tx = Math.floor(mx(w) / 256); tx <= Math.floor(mx(e) / 256); tx++) keys.add(`${tx}-${ty}`)
  }
  if (!keys.size) return null
  const list = [...keys]
  const tiles = new Map()
  for (let i = 0; i < list.length; i += 8) {
    const got = await Promise.all(list.slice(i, i + 8).map((k) => tile(...k.split('-').map(Number))))
    got.forEach((t, j) => t && tiles.set(list[i + j], t))
  }
  if (!tiles.size) return null
  const paint = (lon, lat) => {
    const X = mx(lon), Y = my(lat), t = tiles.get(`${Math.floor(X / 256)}-${Math.floor(Y / 256)}`)
    return !!t && t.mask[(Math.floor(Y) % 256) * t.width + (Math.floor(X) % 256)] === 1
  }
  /** Whether the photo is there at all (outside it, no paint says nothing). */
  paint.covers = (lon, lat) => tiles.has(`${Math.floor(mx(lon) / 256)}-${Math.floor(my(lat) / 256)}`)
  return paint
}
