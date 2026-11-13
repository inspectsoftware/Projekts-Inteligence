// Draws the lane builder's GeoJSON to a PNG without a browser (pngjs), in the map's light palette.
// export render(fc, bbox, px) -> PNG buffer
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { PNG } = require('pngjs')

const C = {
  land: [242, 243, 237], asphalt: [180, 180, 180], bridge: [189, 189, 189], paint: [255, 255, 255], island: [205, 205, 205],
  grass: [198, 234, 150], pavement: [228, 227, 221], parapet: [140, 140, 140], shadow: [60, 60, 50], tunnel: [180, 180, 180], kerb: [194, 194, 194],
}

export function render(fc, bbox, PX = 1600) {
  const Z = 19, T = 256 * 2 ** Z
  const mx = (lon) => ((lon + 180) / 360) * T
  const my = (lat) => ((1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2) * T
  const x0 = mx(bbox[0]), y0 = my(bbox[3]), x1 = mx(bbox[2]), y1 = my(bbox[1])
  const k = PX / (x1 - x0)
  const W = PX, H = Math.round((y1 - y0) * k)
  const mpp = (40075016.686 * Math.cos((((bbox[1] + bbox[3]) / 2) * Math.PI) / 180)) / T / k
  const m = (metres) => metres / mpp
  const P = ([lon, lat]) => [(mx(lon) - x0) * k, (my(lat) - y0) * k]
  const img = new Uint8Array(W * H * 3)
  for (let i = 0; i < W * H; i++) img.set(C.land, i * 3)

  const blend = (x, y, rgb, a) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return
    const i = (y * W + x) * 3
    for (let c = 0; c < 3; c++) img[i + c] = img[i + c] + (rgb[c] - img[i + c]) * a
  }
  /** Fills polygons (rings in pixels, even-odd), colour per pixel from `paint(x, y)` ([rgb, alpha] or null). */
  function fill(rings, paint) {
    let ymin = Infinity, ymax = -Infinity
    for (const r of rings) {
      for (const p of r) {
        ymin = Math.min(ymin, p[1])
        ymax = Math.max(ymax, p[1])
      }
    }
    for (let y = Math.max(0, Math.floor(ymin)); y <= Math.min(H - 1, Math.ceil(ymax)); y++) {
      const yc = y + 0.5, xs = []
      for (const r of rings) {
        for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
          const [xa, ya] = r[i], [xb, yb] = r[j]
          if ((ya > yc) !== (yb > yc)) xs.push(xa + ((yc - ya) * (xb - xa)) / (yb - ya))
        }
      }
      xs.sort((a, b) => a - b)
      for (let i = 0; i + 1 < xs.length; i += 2) {
        for (let x = Math.max(0, Math.round(xs[i])); x < Math.min(W, Math.round(xs[i + 1])); x++) {
          const c = paint(x, y)
          if (c) blend(x, y, c[0], c[1])
        }
      }
    }
  }
  const solid = (rgb, a = 1) => () => [rgb, a]
  /** A polyline as quads, `width` px, dashed [on, off] px if given. */
  function stroke(pts, width, rgb, a = 1, dash = null) {
    const h = Math.max(width, 1) / 2
    let along = 0
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[i + 1]
      const L = Math.hypot(bx - ax, by - ay)
      if (L < 1e-6) continue
      const ux = (bx - ax) / L, uy = (by - ay) / L, nx = -uy * h, ny = ux * h
      const pieces = []
      if (!dash) pieces.push([0, L])
      else {
        const per = dash[0] + dash[1]
        for (let s = -((along % per) + per) % per; s < L; s += per) pieces.push([Math.max(0, s), Math.min(L, s + dash[0])])
      }
      for (const [s0, s1] of pieces) {
        if (s1 <= s0) continue
        const p0 = [ax + ux * s0, ay + uy * s0], p1 = [ax + ux * s1, ay + uy * s1]
        fill([[[p0[0] + nx, p0[1] + ny], [p1[0] + nx, p1[1] + ny], [p1[0] - nx, p1[1] - ny], [p0[0] - nx, p0[1] - ny]]], solid(rgb, a))
      }
      along += L
    }
  }
  const rings = (f) => (f.geometry.type === 'Polygon' ? f.geometry.coordinates : f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates.flat() : []).map((r) => r.map(P))
  const lw = (metres, px) => Math.max(m(metres), px)
  const F = fc.features
  const levels = [...new Set(F.map((f) => f.properties.layer ?? 0))].sort((a, b) => a - b)
  for (const lv of levels) {
    const at = (kind) => F.filter((f) => f.properties.kind === kind && (f.properties.layer ?? 0) === lv)
    if (lv < 0) {
      for (const f of [...at('carriageway'), ...at('junction')]) fill(rings(f), solid(C.tunnel, 0.4))
      continue
    }
    if (lv > 0) for (const f of at('carriageway')) fill(rings(f).map((r) => r.map(([x, y]) => [x + m(2.5), y + m(3)])), solid(C.shadow, 0.3))
    for (const f of at('sidewalk')) fill(rings(f), solid(C.pavement))
    for (const f of [...at('carriageway'), ...at('junction')]) fill(rings(f), solid(lv > 0 ? C.bridge : C.asphalt))
    if (lv === 0) {
      for (const f of F.filter((f) => f.properties.kind === 'gore')) {
        // Asphalt, edged in paint where unpaved; its chevrons come with the paint.
        fill(rings(f), solid(C.asphalt))
        if (!f.properties.paved && !f.properties.open) for (const r of rings(f)) stroke([...r, r[0]], lw(0.15, 1.5), C.paint, 0.9)
      }
      for (const f of F.filter((f) => f.properties.kind === 'chevron')) stroke(f.geometry.coordinates.map(P), lw(0.5, 2), C.paint, 0.9)
      for (const f of F.filter((f) => f.properties.kind === 'hatch')) {
        const step = Math.max(m(1.8), 5), band = Math.max(m(0.4), 1.5)
        fill(rings(f), (x, y) => [((x + y) % step) < band ? C.paint : C.asphalt, 1])
        for (const r of rings(f)) stroke([...r, r[0]], lw(0.15, 1.5), C.paint, 0.9)
      }
      for (const f of F.filter((f) => f.properties.kind === 'island')) {
        fill(rings(f), solid(f.properties.grass ? C.grass : C.island))
        for (const r of rings(f)) stroke([...r, r[0]], lw(0.2, 1), C.kerb)
      }
    }
    for (const f of at('parapet')) stroke(f.geometry.coordinates.map(P), lw(0.5, 1.5), C.parapet)
    for (const f of [...at('lane-line'), ...at('centre-line'), ...at('edge-line'), ...at('guide'), ...at('stop-line')]) {
      const pts = f.geometry.coordinates.map(P), d = f.properties.dash, kind = f.properties.kind
      if (d === 'double') {
        stroke(pts, lw(0.45, 4), C.paint, 0.9)
        stroke(pts, lw(0.15, 1.4), lv > 0 ? C.bridge : C.asphalt)
      } else if (kind === 'guide') stroke(pts, lw(0.12, 1.2), C.paint, 0.7, [m(0.6), m(1.4)])
      else if (kind === 'stop-line') stroke(pts, lw(0.4, 3), C.paint, 0.9)
      else if (d === 'block') stroke(pts, lw(0.4, 3), C.paint, 0.9, [m(1), m(1)])
      else stroke(pts, lw(0.15, 1.6), C.paint, 0.9, d === 'long' ? [m(4), m(4)] : d === 'short' ? [m(3), m(3)] : null)
    }
    for (const f of at('zebra')) fill(rings(f), solid(C.paint, 0.9))
    for (const f of at('arrow')) {
      const [x, y] = P(f.geometry.coordinates)
      const b = ((f.properties.bearing ?? 0) * Math.PI) / 180
      const fw = [Math.sin(b), -Math.cos(b)], side = [Math.cos(b), Math.sin(b)]
      const L = m(5)
      const tip = (ang) => {
        const dx = fw[0] * Math.cos(ang) + side[0] * Math.sin(ang), dy = fw[1] * Math.cos(ang) + side[1] * Math.sin(ang)
        const e = [x + dx * L * 0.45, y + dy * L * 0.45]
        stroke([[x, y], e], lw(0.2, 1.5), C.paint, 0.9)
        const hx = dx * m(0.9), hy = dy * m(0.9), px_ = -dy * m(0.5), py_ = dx * m(0.5)
        fill([[[e[0] + hx, e[1] + hy], [e[0] + px_, e[1] + py_], [e[0] - px_, e[1] - py_]]], solid(C.paint, 0.9))
      }
      stroke([[x - fw[0] * L * 0.5, y - fw[1] * L * 0.5], [x, y]], lw(0.2, 1.5), C.paint, 0.9)
      const A = { through: 0, left: -1.35, slight_left: -0.45, right: 1.35, slight_right: 0.45, reverse: -2.6 }
      for (const t of String(f.properties.icon ?? 'arrow-through').replace(/^arrow-/, '').split('+')) tip(A[t] ?? 0)
    }
  }
  const png = new PNG({ width: W, height: H })
  for (let i = 0; i < W * H; i++) {
    png.data[i * 4] = img[i * 3]
    png.data[i * 4 + 1] = img[i * 3 + 1]
    png.data[i * 4 + 2] = img[i * 3 + 2]
    png.data[i * 4 + 3] = 255
  }
  return { png: PNG.sync.write(png), W, H }
}
