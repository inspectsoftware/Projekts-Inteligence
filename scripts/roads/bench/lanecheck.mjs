// How well a builder's lane paint matches the paint on the LĢIA orthophoto at the test places, without
// anything drawn by hand:
//  - "ours on paint": of our lane, centre and edge lines (sampled every 0.5 m), the share with paint on the
//    photo within 0.35 m across (for a dashed line, within 3 m along as well, the gaps between dashes);
//  - "paint covered": of the paint on the photo on and round our roads (within 3 m of a carriageway; not
//    zebras, arrows, stop lines or islands), the share within 0.5 m of one of our lines.
//   node lanecheck.mjs <benchOutDir> [place,place]
// Reads <benchOutDir>/<place>.geojson (scripts/roads/bench/run.mjs), writes <benchOutDir>/<place>-lanes.png:
// photo paint grey, paint we cover green, paint we miss red-brown, our lines blue.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const jpeg = require('jpeg-js')
const { PNG } = require('pngjs')
const PLACES = {
  interchange: [24.0085, 56.9305, 24.014, 56.9335],
  juglas: [24.249, 56.954, 24.2565, 56.958],
  centre: [24.1265, 56.956, 24.1335, 56.96],
  station: [24.1165, 56.9455, 24.1235, 56.9495],
  slavu: [24.168, 56.9205, 24.176, 56.9245],
}
const [dir, only] = process.argv.slice(2)
const CACHE = join(process.env.CACHE_DIR ?? join(tmpdir(), 'pwh-cache'), 'ortho')
const SERVICE = 'https://geoserver.lvmgeo.lv/wmts8699a6fe9bb543bcbf4e463a88bf9049?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=Orto_LKS&STYLE=raster&TILEMATRIXSET=WebMercatorQuad&FORMAT=image/vnd.jpeg-png8'
const Z = 20, T = 256 * 2 ** Z
const mx = (lon) => ((lon + 180) / 360) * T
const my = (lat) => ((1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2) * T
const R = 0.1 // metres per raster cell

for (const [name, bbox] of Object.entries(PLACES)) {
  if (only && !only.split(',').includes(name)) continue
  const fc = JSON.parse(readFileSync(join(dir, `${name}.geojson`), 'utf8'))
  const lat0 = (bbox[1] + bbox[3]) / 2, kx = 111320 * Math.cos((lat0 * Math.PI) / 180), ky = 110540
  const W = Math.round(((bbox[2] - bbox[0]) * kx) / R), H = Math.round(((bbox[3] - bbox[1]) * ky) / R)
  const toPx = ([lon, lat]) => [((lon - bbox[0]) * kx) / R, ((bbox[3] - lat) * ky) / R]
  const toLL = (x, y) => [bbox[0] + (x * R) / kx, bbox[3] - (y * R) / ky]
  // the photo's paint
  const tiles = new Map()
  for (let ty = Math.floor(my(bbox[3]) / 256); ty <= Math.floor(my(bbox[1]) / 256); ty++) {
    for (let tx = Math.floor(mx(bbox[0]) / 256); tx <= Math.floor(mx(bbox[2]) / 256); tx++) {
      const file = join(CACHE, `z${Z}-${tx}-${ty}.bin`)
      let buf = existsSync(file) ? readFileSync(file) : null
      if (!buf) {
        try {
          const res = await fetch(`${SERVICE}&TILEMATRIX=${Z}&TILEROW=${ty}&TILECOL=${tx}`)
          buf = res.ok ? Buffer.from(await res.arrayBuffer()) : null
        } catch {}
        if (buf) { mkdirSync(CACHE, { recursive: true }); writeFileSync(file, buf) }
      }
      tiles.set(`${tx}-${ty}`, buf ? (buf[0] === 0x89 ? PNG.sync.read(buf) : jpeg.decode(buf, { useTArray: true })) : null)
    }
  }
  // Paint: a pixel clearly lighter (by 30) than the ground round it (1.7 m), and grey-white, not coloured.
  // Faded lines on dark asphalt count; a pale roof or concrete, as light as what is round it, does not.
  const V = new Float32Array(W * H), sat = new Uint8Array(W * H)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const [lon, lat] = toLL(x + 0.5, y + 0.5), X = mx(lon), Y = my(lat), t = tiles.get(`${Math.floor(X / 256)}-${Math.floor(Y / 256)}`)
    if (!t) continue
    const i = ((Math.floor(Y) % 256) * t.width + (Math.floor(X) % 256)) * 4, r = t.data[i], g = t.data[i + 1], b = t.data[i + 2]
    V[y * W + x] = (r + g + b) / 3
    sat[y * W + x] = Math.max(r, g, b) - Math.min(r, g, b)
  }
  const IV = new Float64Array((W + 1) * (H + 1))
  for (let y = 0; y < H; y++) { let row = 0; for (let x = 0; x < W; x++) { row += V[y * W + x]; IV[(y + 1) * (W + 1) + x + 1] = IV[y * (W + 1) + x + 1] + row } }
  const paint = new Uint8Array(W * H)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const a = Math.max(0, x - 8), b = Math.max(0, y - 8), c = Math.min(W, x + 9), d = Math.min(H, y + 9)
    const mean = (IV[d * (W + 1) + c] - IV[b * (W + 1) + c] - IV[d * (W + 1) + a] + IV[b * (W + 1) + a]) / ((c - a) * (d - b))
    const v = V[y * W + x]
    paint[y * W + x] = v > 110 && v - mean > 30 && sat[y * W + x] < 45 ? 1 : 0
  }
  // rasters of ours
  const fillPoly = (rings, out) => {
    const pr = rings.map((r) => r.map(toPx))
    let y0 = Infinity, y1 = -Infinity
    for (const r of pr) for (const p of r) { y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]) }
    for (let y = Math.max(0, Math.floor(y0)); y <= Math.min(H - 1, Math.ceil(y1)); y++) {
      const xs = []
      for (const r of pr) for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xa, ya] = r[i], [xb, yb] = r[j]; if ((ya > y + 0.5) !== (yb > y + 0.5)) xs.push(xa + ((y + 0.5 - ya) * (xb - xa)) / (yb - ya)) }
      xs.sort((a, b) => a - b)
      for (let i = 0; i + 1 < xs.length; i += 2) for (let x = Math.max(0, Math.round(xs[i])); x < Math.min(W, Math.round(xs[i + 1])); x++) out[y * W + x] = 1
    }
  }
  const road = new Uint8Array(W * H), skip = new Uint8Array(W * H), ours = new Uint8Array(W * H)
  const stamp = (out, x, y, r) => { for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const X = Math.round(x) + dx, Y = Math.round(y) + dy; if (X >= 0 && Y >= 0 && X < W && Y < H) out[Y * W + X] = 1 } }
  const lines = []
  for (const f of fc.features) {
    const k = f.properties.kind, g = f.geometry
    if ((k === 'carriageway' || k === 'junction') && g.type === 'Polygon') fillPoly(g.coordinates, road)
    if ((k === 'zebra' || k === 'gore' || k === 'hatch' || k === 'island') && g.type === 'Polygon') fillPoly(g.coordinates, skip)
    if (k === 'arrow') { const [x, y] = toPx(g.coordinates); stamp(skip, x, y, 30) }
    if ((k === 'stop-line' || k === 'chevron') && g.type === 'LineString') { const p = g.coordinates.map(toPx); for (let i = 0; i + 1 < p.length; i++) { const L = Math.hypot(p[i + 1][0] - p[i][0], p[i + 1][1] - p[i][1]); for (let t = 0; t <= L; t += 1) stamp(skip, p[i][0] + ((p[i + 1][0] - p[i][0]) * t) / L, p[i][1] + ((p[i + 1][1] - p[i][1]) * t) / L, 8) } }
    if ((k === 'lane-line' || k === 'centre-line' || k === 'edge-line' || k === 'guide') && g.type === 'LineString') lines.push({ pts: g.coordinates.map(toPx), dashed: k === 'guide' || f.properties.dash === 'short' || f.properties.dash === 'long' || f.properties.dash === 'block' })
  }
  // integral images for "any within r"
  const integral = (src) => { const I = new Float64Array((W + 1) * (H + 1)); for (let y = 0; y < H; y++) { let row = 0; for (let x = 0; x < W; x++) { row += src[y * W + x]; I[(y + 1) * (W + 1) + x + 1] = I[y * (W + 1) + x + 1] + row } } return I }
  const any = (I, x, y, r) => { const a = Math.max(0, Math.round(x) - r), b = Math.max(0, Math.round(y) - r), c = Math.min(W, Math.round(x) + r + 1), d = Math.min(H, Math.round(y) + r + 1); return a < c && b < d && I[d * (W + 1) + c] - I[b * (W + 1) + c] - I[d * (W + 1) + a] + I[b * (W + 1) + a] > 0 }
  // Only thin paint is a painted line: where under half of the metre round is bright (not a pale roof,
  // concrete, a pavement or a white car).
  {
    const I0 = integral(paint), thin = new Uint8Array(W * H)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (!paint[y * W + x]) continue
      const a = Math.max(0, x - 5), b = Math.max(0, y - 5), c = Math.min(W, x + 6), d = Math.min(H, y + 6)
      const n = I0[d * (W + 1) + c] - I0[b * (W + 1) + c] - I0[d * (W + 1) + a] + I0[b * (W + 1) + a]
      thin[y * W + x] = n / ((c - a) * (d - b)) < 0.5 ? 1 : 0
    }
    paint.set(thin)
  }
  const IP = integral(paint)
  // ours on paint
  let samples = 0, hits = 0
  for (const { pts, dashed } of lines) {
    const seq = []
    for (let i = 0; i + 1 < pts.length; i++) {
      const [a, b] = [pts[i], pts[i + 1]], L = Math.hypot(b[0] - a[0], b[1] - a[1])
      if (L < 1e-6) continue
      const ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L
      for (let t = 0; t < L; t += 5) {
        const x = a[0] + ux * t, y = a[1] + uy * t
        if (x < 0 || y < 0 || x >= W || y >= H) continue
        stamp(ours, x, y, 1)
        let hit = false
        for (let s = -3.5; s <= 3.5 && !hit; s += 0.5) if (any(IP, x - uy * s, y + ux * s, 0)) hit = true
        seq.push(hit)
      }
    }
    seq.forEach((h, i) => {
      samples++
      if (h || (dashed && seq.slice(Math.max(0, i - 6), i + 7).some(Boolean))) hits++
    })
  }
  // paint covered
  const IR = integral(road), IO = integral(ours)
  let pc = 0, pcov = 0
  const img = new PNG({ width: W, height: H })
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, o = i * 4
    let c = [0, 0, 0]
    if (paint[i] && !skip[i] && any(IR, x, y, 30)) {
      pc++
      if (any(IO, x, y, 5)) { pcov++; c = [60, 200, 90] } else c = [200, 90, 60]
    } else if (paint[i]) c = [90, 90, 90]
    if (ours[i]) c = [70, 130, 255]
    img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = 255
  }
  writeFileSync(join(dir, `${name}-lanes.png`), PNG.sync.write(img))
  console.log(`${name}: ours on paint ${samples ? Math.round((100 * hits) / samples) : 0}% (${samples} samples), paint covered ${pc ? Math.round((100 * pcov) / pc) : 0}%`)
}
