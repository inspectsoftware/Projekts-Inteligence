// The LĢIA orthophoto (Orto_LKS: 25 cm aerial photos of all Latvia, free WMTS, no key) over a bbox, as a
// colour lookup by lon/lat. Tiles are kept in the server's cache folder (ortho/). Outside Latvia the service returns
// nothing; `coverage` then tells the builder to go by its rules alone.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const jpeg = require('jpeg-js')
const { PNG } = require('pngjs')

// Kept with the server's other caches (server/core/disk.ts: the system's temp folder, or CACHE_DIR).
const CACHE = join(process.env.CACHE_DIR ?? join(tmpdir(), 'pwh-cache'), 'ortho')
const SERVICE = 'https://geoserver.lvmgeo.lv/wmts8699a6fe9bb543bcbf4e463a88bf9049?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=Orto_LKS&STYLE=raster&TILEMATRIXSET=WebMercatorQuad&FORMAT=image/vnd.jpeg-png8'
const Z = 19, T = 256 * 2 ** Z
const mx = (lon) => ((lon + 180) / 360) * T
const my = (lat) => ((1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2) * T

async function tile(tx, ty) {
  const file = join(CACHE, `${tx}-${ty}.bin`)
  let buf = existsSync(file) ? readFileSync(file) : null
  if (!buf) {
    try {
      const res = await fetch(`${SERVICE}&TILEMATRIX=${Z}&TILEROW=${ty}&TILECOL=${tx}`)
      if (res.ok) buf = Buffer.from(await res.arrayBuffer())
    } catch {}
    if (buf) {
      mkdirSync(CACHE, { recursive: true })
      writeFileSync(file, buf)
    }
  }
  if (!buf || buf.length < 100) return null
  try {
    return buf[0] === 0x89 ? PNG.sync.read(buf) : jpeg.decode(buf, { useTArray: true })
  } catch {
    return null
  }
}

/** { rgb(lon, lat) -> [r, g, b] | null, coverage } over the bbox and a margin round it. */
export async function orthophoto([w, s, e, n], margin = 0.002) {
  const x0 = Math.floor(mx(w - margin * 1.8) / 256), x1 = Math.floor(mx(e + margin * 1.8) / 256)
  const y0 = Math.floor(my(n + margin) / 256), y1 = Math.floor(my(s - margin) / 256)
  const tiles = new Map()
  const jobs = []
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) jobs.push([tx, ty])
  let have = 0
  for (let i = 0; i < jobs.length; i += 8) {
    const got = await Promise.all(jobs.slice(i, i + 8).map(([tx, ty]) => tile(tx, ty)))
    got.forEach((t, k) => {
      if (!t) return
      tiles.set(`${jobs[i + k][0]}-${jobs[i + k][1]}`, t)
      have++
    })
  }
  const rgb = (lon, lat) => {
    const X = mx(lon), Y = my(lat)
    const t = tiles.get(`${Math.floor(X / 256)}-${Math.floor(Y / 256)}`)
    if (!t) return null
    const i = ((Math.floor(Y) % 256) * t.width + (Math.floor(X) % 256)) * 4
    const r = t.data[i], g = t.data[i + 1], b = t.data[i + 2]
    // A tile's no-data (pure white or black) is not ground.
    return r + g + b < 6 || r + g + b > 762 ? null : [r, g, b]
  }
  return { rgb, coverage: jobs.length ? have / jobs.length : 0 }
}
