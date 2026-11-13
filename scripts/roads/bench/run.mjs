// Renders a lane-builder variant at the test places, each beside the LĢIA orthophoto of the same ground.
//   node run.mjs <path/to/lanes.mjs> <outDir> [place,place]   (places: interchange, juglas, centre, station)
// Writes <outDir>/<place>.png (the render), <place>-pair.jpg (render | photo) and <place>.geojson; prints a line a place.
// A variant may export extra(bbox) -> Promise<{ways?, features?}> to add its own data (traced edges, lidar…).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { gunzipSync } from 'node:zlib'
import { paintNear } from '../../../server/streets/paint.mjs'
import { render } from './render.mjs'

const require = createRequire(import.meta.url)
const jpeg = require('jpeg-js')
const { PNG } = require('pngjs')

export const PLACES = {
  interchange: [24.0085, 56.9305, 24.014, 56.9335], // A10 x P133 (Jūrkalnes iela): ramps, bridge, gores
  juglas: [24.249, 56.954, 24.2565, 56.958], // the Juglas/Biķernieku roundabout: islands, hatching, zebras
  centre: [24.1265, 56.956, 24.1335, 56.96], // central Rīga by Avotu/Lāčplēša: city streets, junctions, turn lanes
  station: [24.1165, 56.9455, 24.1235, 56.9495], // Stacijas laukums / Marijas iela: many-lane approaches, split ways
  slavu: [24.168, 56.9205, 24.176, 56.9245], // Slāvu tilts interchange: loops, flyovers, slip roads in a city
}

const [variant, outDir, only] = process.argv.slice(2)
const ROADS = join(process.env.ROADS_DIR ?? join(dirname(fileURLToPath(import.meta.url)), '../../../roads'), '12')
const CACHE = join(process.env.CACHE_DIR ?? join(tmpdir(), 'pwh-cache'), 'ortho')
mkdirSync(outDir, { recursive: true })
mkdirSync(CACHE, { recursive: true })
const mod = await import(pathToFileURL(resolve(variant)).href)

const bucketOf = ([lon, lat]) => {
  const n = 4096, r = (lat * Math.PI) / 180
  return `${Math.floor(((lon + 180) / 360) * n)}-${Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n)}`
}
function roads([w, s, e, n]) {
  const M = 0.004
  const box = [w - M, s - M / 2, e + M, n + M / 2]
  const keys = new Set()
  for (let x = box[0]; x <= box[2] + 0.05; x += 0.05) for (let y = box[1]; y <= box[3] + 0.03; y += 0.03) keys.add(bucketOf([Math.min(x, box[2]), Math.min(y, box[3])]))
  const ways = new Map(), nodes = []
  for (const key of keys) {
    const f = join(ROADS, `${key}.ndjson.gz`)
    if (!existsSync(f)) continue
    for (const l of gunzipSync(readFileSync(f)).toString().split('\n')) {
      if (!l) continue
      const o = JSON.parse(l)
      if (o.coords) {
        if (o.coords.some(([a, b]) => a > box[0] && a < box[2] && b > box[1] && b < box[3])) ways.set(o.id, o)
      } else nodes.push(o)
    }
  }
  const used = new Set([...ways.values()].flatMap((w) => w.nodes))
  return { ways: [...ways.values()], nodes: nodes.filter((n) => used.has(n.node)) }
}

const SERVICE = 'https://geoserver.lvmgeo.lv/wmts8699a6fe9bb543bcbf4e463a88bf9049?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=Orto_LKS&STYLE=raster&TILEMATRIXSET=WebMercatorQuad&FORMAT=image/vnd.jpeg-png8'
async function photo(bbox, W, H) {
  const Z = 19, T = 256 * 2 ** Z
  const mx = (lon) => ((lon + 180) / 360) * T
  const my = (lat) => ((1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2) * T
  const x0 = mx(bbox[0]), y0 = my(bbox[3]), k = W / (mx(bbox[2]) - x0)
  const tiles = new Map()
  const get = async (tx, ty) => {
    const key = `${tx}-${ty}`
    if (!tiles.has(key)) {
      const file = join(CACHE, `${key}.bin`)
      let buf = existsSync(file) ? readFileSync(file) : null
      if (!buf) {
        const res = await fetch(`${SERVICE}&TILEMATRIX=${Z}&TILEROW=${ty}&TILECOL=${tx}`)
        buf = res.ok ? Buffer.from(await res.arrayBuffer()) : null
        if (buf) writeFileSync(file, buf)
      }
      tiles.set(key, buf ? (buf[0] === 0x89 ? PNG.sync.read(buf) : jpeg.decode(buf, { useTArray: true })) : null)
    }
    return tiles.get(key)
  }
  // Every tile first, then the pixels without waiting on each.
  for (let ty = Math.floor(y0 / 256); ty <= Math.floor((y0 + H / k) / 256); ty++) for (let tx = Math.floor(x0 / 256); tx <= Math.floor((x0 + W / k) / 256); tx++) await get(tx, ty)
  const out = Buffer.alloc(W * H * 4)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const wx = x0 + x / k, wy = y0 + y / k
      const t = tiles.get(`${Math.floor(wx / 256)}-${Math.floor(wy / 256)}`)
      const o = (y * W + x) * 4
      if (t) {
        const i = ((Math.floor(wy) % 256) * t.width + (Math.floor(wx) % 256)) * 4
        out[o] = t.data[i]; out[o + 1] = t.data[i + 1]; out[o + 2] = t.data[i + 2]
      }
      out[o + 3] = 255
    }
  }
  return out
}

for (const [name, bbox] of Object.entries(PLACES)) {
  if (only && !only.split(',').includes(name)) continue
  const { ways, nodes } = roads(bbox)
  const extra = mod.extra ? await mod.extra(bbox) : {}
  const paint = process.env.PAINT === '1' ? await paintNear([[bbox[0] - 0.002, bbox[1] - 0.001, bbox[2] + 0.002, bbox[3] + 0.001]]) : undefined
  const fc = mod.buildRoads([...ways, ...(extra.ways ?? [])], nodes, bbox, { paint, laneGraph: true })
  if (fc.laneGraph) console.log(name, 'lane links', fc.laneGraph.links, 'from or to nowhere', fc.laneGraph.broken.length, JSON.stringify(fc.laneGraph.broken.slice(0, 6).map((b) => `${b.what} ${b.way} lane ${b.lane}/${b.of} ${b.highway}`)))
  if (extra.features) fc.features.push(...extra.features)
  writeFileSync(join(outDir, `${name}.geojson`), JSON.stringify(fc))
  const { png, W, H } = render(fc, bbox, 1600)
  writeFileSync(join(outDir, `${name}.png`), png)
  const ours = PNG.sync.read(png)
  const ph = await photo(bbox, W, H)
  const GAP = 10, OW = W * 2 + GAP, both = Buffer.alloc(OW * H * 4, 255)
  for (let y = 0; y < H; y++) {
    ours.data.copy(both, y * OW * 4, y * W * 4, (y + 1) * W * 4)
    ph.copy(both, (y * OW + W + GAP) * 4, y * W * 4, (y + 1) * W * 4)
  }
  writeFileSync(join(outDir, `${name}-pair.jpg`), jpeg.encode({ data: both, width: OW, height: H }, 85).data)
  const count = {}
  for (const f of fc.features) count[f.properties.kind] = (count[f.properties.kind] ?? 0) + 1
  console.log(name, join(outDir, `${name}-pair.jpg`), JSON.stringify(count))
}
