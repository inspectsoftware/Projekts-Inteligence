// A sharp top-down photo of Rīga, for checking and fitting roads where the LĢIA orthophoto (25 cm) is too
// coarse to show lane paint well. Drawn from the photographed 3D surfaces GEO RĪGA streams as I3S
// integrated meshes (the layers listed in public/data/city-3d.json `meshes`, see scripts/bake-city-3d.mjs):
// LĢIA's 2021 mesh of all of Rīga (about 7 cm) and the city's own mesh of its centre (1-2 cm, 2022-2025),
// which wins where it has triangles. Each triangle is laid flat, straight down, so the result is a true
// orthophoto: roofs stand where their walls are, not leaning. Where surfaces lie one over another the
// highest is kept, as seen from above: bridge decks and tree tops hide what is under them. Asked to keep
// the lowest instead, the ground under a bridge shows, but dark and smeared: the mesh is a shell, and
// under a deck or a canopy it was never photographed. Walls are left out.
// Node pages, geometry and photos fetched are kept in the server's cache folder (riga-photo/).
// Data: Rīgas valstspilsētas pašvaldība (GEO RĪGA), CC BY 4.0; LĢIA's mesh © Latvijas Ģeotelpiskās
// informācijas aģentūra, 2021, CC BY 4.0.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync, gzipSync } from 'node:zlib'

const require = createRequire(import.meta.url)
const jpeg = require('jpeg-js')

const CACHE = join(process.env.CACHE_DIR ?? join(tmpdir(), 'pwh-cache'), 'riga-photo')
const USER_AGENT = 'ProjektsInteligence/0.1 (non-commercial Latvia OSINT dashboard; road checks)'
const HALF_WORLD = 20037508.342789244
const DEGREE = Math.PI / 180
/** Requests at once, all layers together: the services are the city's, so gently. */
const AT_ONCE = 4
/** Bytes a vertex of each array a mesh's uncompressed geometry may carry, in I3S's order. */
const ARRAY_BYTES = { position: 12, normal: 12, uv0: 8, color: 4 }
/** Steeper than this (the up part of a face's normal), a face is a wall and is not drawn. */
const WALL = 0.3
/** Largest picture asked for, pixels a side. */
const MAX_SIDE = 16000

const toX = (lon) => (lon / 180) * HALF_WORLD
const toY = (lat) => (Math.log(Math.tan(Math.PI / 4 + (lat * DEGREE) / 2)) / Math.PI) * HALF_WORLD

let catalogue = null
function meshLayers() {
  catalogue ??= JSON.parse(readFileSync(new URL('../../public/data/city-3d.json', import.meta.url), 'utf8')).meshes ?? []
  return catalogue
}

// ---- fetching, a few at a time, everything kept on disk ----------------------------------------------
let running = 0
const waiting = []
async function polite(task) {
  if (running >= AT_ONCE) await new Promise((go) => waiting.push(go))
  running++
  try {
    return await task()
  } finally {
    running--
    waiting.shift()?.()
  }
}

/**
 * The bytes at a URL, from the cache when there; null when the service has none (kept as an empty file).
 * A file named .gz is kept compressed: geometry is plain float arrays, three times smaller so.
 */
async function cached(file, url) {
  const gz = file.endsWith('.gz')
  if (existsSync(file)) {
    const buf = readFileSync(file)
    return buf.length ? (gz ? gunzipSync(buf) : buf) : null
  }
  const buf = await polite(async () => {
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(60000) })
        if (res.status === 404) return Buffer.alloc(0)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return Buffer.from(await res.arrayBuffer())
      } catch (err) {
        if (attempt >= 2) throw new Error(`${url}: ${err.message}`)
        await new Promise((wait) => setTimeout(wait, 2000 * (attempt + 1)))
      }
    }
  })
  mkdirSync(join(file, '..'), { recursive: true })
  writeFileSync(file, gz && buf.length ? gzipSync(buf) : buf)
  return buf.length ? buf : null
}

/** One layer's nodes, a page of 64 at a time as first asked for. */
function layerReader(layer) {
  const dir = join(CACHE, layer.url.match(/services\/([^/]+)\/SceneServer/)?.[1] ?? layer.name.replace(/\W+/g, '_'))
  const pages = new Map()
  const page = (p) => {
    if (!pages.has(p)) {
      pages.set(p, cached(join(dir, `page-${p}.json`), `${layer.url}/nodepages/${p}`).then((buf) => {
        // Past the last page the city's services answer 200 with an error in place of nodes.
        const nodes = buf ? JSON.parse(buf.toString()).nodes : null
        return Array.isArray(nodes) ? nodes : []
      }))
    }
    return pages.get(p)
  }
  return {
    node: async (index) => (await page(Math.floor(index / 64))).find((n) => n.index === index) ?? null,
    geometry: (resource) => cached(join(dir, `geometry-${resource}.bin.gz`), `${layer.url}/nodes/${resource}/geometries/0`),
    texture: (resource) => cached(join(dir, `texture-${resource}.jpg`), `${layer.url}/nodes/${resource}/textures/0`),
  }
}

// ---- choosing nodes ---------------------------------------------------------------------------------
/** A node's box flat on the map, Web Mercator metres: west, south, east, north; and its ground area, m². */
function footprint(obb, cos) {
  const [qx, qy, qz, qw] = obb.quaternion
  const [hx, hy, hz] = obb.halfSize
  // The box's three half axes, turned: the columns of the quaternion's rotation, each times its half size.
  const axes = [
    [(1 - 2 * (qy * qy + qz * qz)) * hx, 2 * (qx * qy + qz * qw) * hx],
    [2 * (qx * qy - qz * qw) * hy, (1 - 2 * (qx * qx + qz * qz)) * hy],
    [2 * (qx * qz + qy * qw) * hz, 2 * (qy * qz - qx * qw) * hz],
  ]
  const across = Math.abs(axes[0][0]) + Math.abs(axes[1][0]) + Math.abs(axes[2][0])
  const along = Math.abs(axes[0][1]) + Math.abs(axes[1][1]) + Math.abs(axes[2][1])
  const [x, y] = obb.center
  return { box: [x - across, y - along, x + across, y + along], area: 4 * across * along * cos * cos }
}

/**
 * The nodes of a layer to draw a box (Web Mercator metres) with: going down the tree from the root,
 * a node gives way to its children until its photo is as fine as a pixel (its texels spread over its
 * box, which flatters it a little: some go to walls) or it has none. Finer than that costs about three
 * times the bytes for a picture hardly sharper.
 */
async function pickNodes(reader, box, metres, cos) {
  const picked = []
  const visit = async (index) => {
    const node = await reader.node(index)
    if (!node) return
    const { box: b, area } = footprint(node.obb, cos)
    if (b[0] > box[2] || b[2] < box[0] || b[1] > box[3] || b[3] < box[1]) return
    const texels = node.mesh?.material?.texelCountHint ?? 0
    const fine = node.mesh && texels > 0 && Math.sqrt(area / texels) <= metres
    if (node.children?.length && !fine) await Promise.all(node.children.map(visit))
    else if (node.mesh) picked.push(node)
  }
  await visit(0)
  return picked
}

// ---- drawing ----------------------------------------------------------------------------------------
/** Whether a point lies inside rings of x, y one after another: inside an odd number of them. */
function inside(x, y, rings) {
  let odd = false
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
      if (ring[i + 1] > y !== ring[j + 1] > y && x < ((ring[j] - ring[i]) * (y - ring[i + 1])) / (ring[j + 1] - ring[i + 1]) + ring[i]) odd = !odd
    }
  }
  return odd
}

/**
 * Lays one node's triangles flat into the picture. `view` holds the picture, its depth, where its
 * corner lies and how big a pixel is; `low` keeps the lowest surface, else the highest.
 */
function drawNode(view, node, geometry, photo, attributes, cuts, low) {
  const { data, depth, width, height, x0, y1, step, cos } = view
  const dv = new DataView(geometry.buffer, geometry.byteOffset, geometry.byteLength)
  const count = geometry.length >= 8 ? dv.getUint32(0, true) : 0
  const sizes = attributes.map((a) => ARRAY_BYTES[a])
  if (count % 3 || geometry.length < 8 + count * sizes.reduce((s, b) => s + b, 0)) return 0
  const at = (name) => 8 + count * sizes.slice(0, attributes.indexOf(name)).reduce((s, b) => s + b, 0)
  const pos = (i, k) => dv.getFloat32(at('position') + (i * 3 + k) * 4, true)
  const uvAt = at('uv0')
  const uv = (i, k) => dv.getFloat32(uvAt + (i * 2 + k) * 4, true)
  const [cx, cy, cz] = node.obb.center
  const tw = photo.width, th = photo.height, tex = photo.data
  let drawn = 0
  for (let t = 0; t < count; t += 3) {
    // Corners in pixels across and down, and metres up.
    const X = [0, 1, 2].map((k) => cx + pos(t + k, 0)), Y = [0, 1, 2].map((k) => cy + pos(t + k, 1))
    const Z = [0, 1, 2].map((k) => cz + pos(t + k, 2))
    const px = X.map((x) => (x - x0) / step), py = Y.map((y) => (y1 - y) / step)
    const minX = Math.max(0, Math.ceil(Math.min(...px) - 0.5)), maxX = Math.min(width - 1, Math.floor(Math.max(...px) - 0.5))
    const minY = Math.max(0, Math.ceil(Math.min(...py) - 0.5)), maxY = Math.min(height - 1, Math.floor(Math.max(...py) - 0.5))
    if (minX > maxX || minY > maxY) continue
    // A wall: its face turned more sideways than up (ground metres across, metres up).
    const ax = (X[1] - X[0]) * cos, ay = (Y[1] - Y[0]) * cos, az = Z[1] - Z[0]
    const bx = (X[2] - X[0]) * cos, by = (Y[2] - Y[0]) * cos, bz = Z[2] - Z[0]
    const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx
    if (Math.abs(nz) < WALL * Math.hypot(nx, ny, nz)) continue
    if (cuts.length && cuts.some((rings) => inside((X[0] + X[1] + X[2]) / 3, (Y[0] + Y[1] + Y[2]) / 3, rings))) continue
    const area = (px[1] - px[0]) * (py[2] - py[0]) - (px[2] - px[0]) * (py[1] - py[0])
    if (area === 0) continue
    const U = [0, 1, 2].map((k) => uv(t + k, 0)), V = [0, 1, 2].map((k) => uv(t + k, 1))
    for (let y = minY; y <= maxY; y++) {
      const sy = y + 0.5
      for (let x = minX; x <= maxX; x++) {
        const sx = x + 0.5
        // Weights of the three corners at the pixel's middle; all of one sign inside.
        const w0 = ((px[1] - sx) * (py[2] - sy) - (px[2] - sx) * (py[1] - sy)) / area
        const w1 = ((px[2] - sx) * (py[0] - sy) - (px[0] - sx) * (py[2] - sy)) / area
        const w2 = 1 - w0 - w1
        if (w0 < 0 || w1 < 0 || w2 < 0) continue
        const z = w0 * Z[0] + w1 * Z[1] + w2 * Z[2], p = y * width + x
        if (low ? z >= depth[p] : z <= depth[p]) continue
        depth[p] = z
        // The photo's pixel, bilinear; its coordinates start at its top left and wrap.
        let u = w0 * U[0] + w1 * U[1] + w2 * U[2], v = w0 * V[0] + w1 * V[1] + w2 * V[2]
        u = (u - Math.floor(u)) * tw - 0.5
        v = (v - Math.floor(v)) * th - 0.5
        const u0 = Math.max(0, Math.floor(u)), v0 = Math.max(0, Math.floor(v)), fu = Math.max(0, u - u0), fv = Math.max(0, v - v0)
        const u1 = Math.min(tw - 1, u0 + 1), v1 = Math.min(th - 1, v0 + 1)
        const a = (v0 * tw + u0) * 4, b = (v0 * tw + u1) * 4, c = (v1 * tw + u0) * 4, d = (v1 * tw + u1) * 4
        for (let k = 0; k < 3; k++) {
          data[p * 4 + k] = (tex[a + k] * (1 - fu) + tex[b + k] * fu) * (1 - fv) + (tex[c + k] * (1 - fu) + tex[d + k] * fu) * fv
        }
        data[p * 4 + 3] = 255
        drawn++
      }
    }
  }
  return drawn
}

/**
 * The photo of a bbox [west, south, east, north] at `cmPerPixel` (on the ground, at the bbox's middle
 * latitude), top-down. Pixels run evenly in Web Mercator, north row first, as map tiles do. Alpha is 0
 * where no mesh has a face; null where no layer reaches the bbox (outside Rīga). `surface: 'low'` keeps
 * the lowest surface instead of the highest (what lies under bridge decks, smeared).
 * @returns {Promise<{ width: number, height: number, data: Uint8Array, bbox: number[], cmPerPixel: number, nodes: number } | null>}
 */
export async function rigaPhotoNear(bbox, cmPerPixel = 4, { surface = 'top' } = {}) {
  const [w, s, e, n] = bbox
  const layers = meshLayers().filter((l) => l.bbox[0] < e && l.bbox[2] > w && l.bbox[1] < n && l.bbox[3] > s)
  if (!layers.length) return null
  const cos = Math.cos(((s + n) / 2) * DEGREE)
  const metres = cmPerPixel / 100
  const step = metres / cos
  const box = [toX(w), toY(s), toX(e), toY(n)]
  const width = Math.round((box[2] - box[0]) / step), height = Math.round((box[3] - box[1]) / step)
  if (width < 1 || height < 1 || width > MAX_SIDE || height > MAX_SIDE) throw new Error(`A picture of ${width} x ${height} pixels`)
  const low = surface === 'low'
  const view = { data: new Uint8Array(width * height * 4), depth: new Float32Array(width * height), width, height, x0: box[0], y1: box[3], step, cos }
  let nodes = 0
  // LĢIA's mesh first (rank 1), then the city's own over it wherever it has faces: their heights are
  // not on one datum, so the depth starts again for each.
  for (const rank of [1, 0]) {
    view.depth.fill(low ? Infinity : -Infinity)
    for (const layer of layers.filter((l) => (l.rank ?? 1) === rank)) {
      const reader = layerReader(layer)
      const cuts = (layer.cuts ?? []).map((polygon) => polygon.map((ring) => ring.flatMap(([lon, lat]) => [toX(lon), toY(lat)])))
      const attributes = layer.attributes ?? ['position', 'uv0']
      const picked = await pickNodes(reader, box, metres, cos)
      // Fetched together (a few at a time), drawn one by one.
      const loads = picked.map((node) => {
        const { geometry, material } = node.mesh
        return Promise.all([reader.geometry(geometry.resource), reader.texture(material?.resource ?? geometry.resource)])
      })
      for (let i = 0; i < picked.length; i++) {
        const [geometry, texture] = await loads[i]
        if (!geometry || !texture) continue
        let photo
        try {
          photo = jpeg.decode(texture, { useTArray: true, maxMemoryUsageInMB: 1024 })
        } catch {
          continue
        }
        drawNode(view, picked[i], geometry, photo, attributes, cuts, low)
        nodes++
      }
    }
  }
  return { width, height, data: view.data, bbox: [w, s, e, n], cmPerPixel, nodes }
}
