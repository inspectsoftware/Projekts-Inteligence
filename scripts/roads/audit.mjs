// Checks every road of the Baltic states as the map draws it, and lists the places that look wrong:
//   node scripts/roads/audit.mjs [w,s,e,n]
// In the OSM data: turn lanes that do not match the lane count; a lane merging off the edge of the
// road; turn lanes with no lane count. In what the lane builder draws (server/streets/lanes.mjs), a 5 km
// square at a time: arrows off the asphalt; lane lines off it; slivers.
// Writes scripts/.cache/roads/audit.json (every finding) and audit.geojson (to look at on a map), and
// prints how many of each kind, by country, with a few places each.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { buildRoads } from '../../server/streets/lanes.mjs'
import { BUCKET_ZOOM, ROADS_DIR } from './buckets.mjs'

const only = process.argv[2]?.split(',').map(Number)
const DIR = join(ROADS_DIR, String(BUCKET_ZOOM))
const OUT = join(ROADS_DIR, '..', 'scripts', '.cache', 'roads')

const n = 2 ** BUCKET_ZOOM
const lon = (x) => (x / n) * 360 - 180
const lat = (y) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI
const country = ([x, y]) => (y > 57.52 && x > 21.7 ? 'EE' : y < 56.45 ? 'LT' : 'LV')

const cache = new Map()
function bucket(x, y) {
  const key = `${x}-${y}`
  if (cache.has(key)) return cache.get(key)
  const out = { ways: [], nodes: [] }
  const file = join(DIR, `${key}.ndjson.gz`)
  if (existsSync(file)) {
    for (const line of gunzipSync(readFileSync(file)).toString('utf8').split('\n')) {
      if (!line) continue
      const o = JSON.parse(line)
      if (o.coords) out.ways.push(o)
      else out.nodes.push(o)
    }
  }
  cache.set(key, out)
  if (cache.size > 40) cache.delete(cache.keys().next().value)
  return out
}

const findings = []
const add = (check, where, detail) => findings.push({ check, country: country(where), lon: +where[0].toFixed(6), lat: +where[1].toFixed(6), detail })

// ---- the data ----------------------------------------------------------------------------------
const lanesOf = (t, dir) => {
  const v = t[`lanes:${dir}`]
  if (v != null) return Number(v)
  if (t.lanes == null) return null
  const oneway = t.oneway === 'yes' || t.oneway === '-1' || t.junction === 'roundabout' || /^motorway/.test(t.highway)
  return oneway ? Number(t.lanes) : null
}
function checkData(w) {
  const t = w.tags
  const mid = w.coords[Math.floor(w.coords.length / 2)]
  for (const [key, dir] of [['turn:lanes', 'forward'], ['turn:lanes:forward', 'forward'], ['turn:lanes:backward', 'backward']]) {
    const v = t[key]
    if (!v) continue
    const lanes = v.split('|')
    const count = lanesOf(t, dir)
    if (t.lanes == null && t[`lanes:${dir}`] == null) add('turn-lanes-without-lanes', mid, `way ${w.id}: ${key}=${v}, no lanes tag`)
    else if (count != null && count !== lanes.length) add('turn-lanes-count', mid, `way ${w.id}: lanes ${count}, ${key}=${v} (${lanes.length})`)
    // A lone lane merging either way is a slip road joining: fine.
    // Only a lane that can do nothing but merge (merge_to_right;through may also go on).
    if (lanes.length > 1 && lanes.at(-1) === 'merge_to_right') add('merge-off-the-road', mid, `way ${w.id}: ${key}=${v} (the rightmost lane merges right)`)
    if (lanes.length > 1 && lanes[0] === 'merge_to_left') add('merge-off-the-road', mid, `way ${w.id}: ${key}=${v} (the leftmost lane merges left)`)
  }
}

// ---- what is drawn -------------------------------------------------------------------------------
function inRing([x, y], ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}
function checkDrawn(fc, [w, s, e, nn]) {
  const asphalt = fc.features.filter((f) => f.properties.kind === 'carriageway' || f.properties.kind === 'junction' || f.properties.kind === 'gore')
  const G = 0.0005
  const grid = new Map()
  for (const f of asphalt) {
    const ring = f.geometry.coordinates[0]
    const xs = ring.map((p) => p[0]), ys = ring.map((p) => p[1])
    f.box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
    for (let gx = Math.floor(f.box[0] / G); gx <= Math.floor(f.box[2] / G); gx++) {
      for (let gy = Math.floor(f.box[1] / G); gy <= Math.floor(f.box[3] / G); gy++) {
        const k = `${gx},${gy}`
        if (!grid.has(k)) grid.set(k, [])
        grid.get(k).push(f)
      }
    }
  }
  // A line between two carriageways (the centre line of a two-way road) lies on both their edges:
  // on the asphalt if any point 30 cm round it is.
  const NEAR = 0.000004
  const onAsphalt = (p, layer) => [[0, 0], [NEAR, 0], [-NEAR, 0], [0, NEAR], [0, -NEAR]].some(([dx, dy]) => onAsphaltAt([p[0] + dx, p[1] + dy], layer))
  const onAsphaltAt = (p, layer) =>
    (grid.get(`${Math.floor(p[0] / G)},${Math.floor(p[1] / G)}`) ?? []).some(
      (f) => (f.properties.layer ?? 0) === layer && p[0] >= f.box[0] && p[0] <= f.box[2] && p[1] >= f.box[1] && p[1] <= f.box[3] && inRing(p, f.geometry.coordinates[0]),
    )
  const inside = (p) => p[0] >= w && p[0] < e && p[1] >= s && p[1] < nn
  for (const f of fc.features) {
    const { kind, layer = 0 } = f.properties
    if (kind === 'arrow') {
      const p = f.geometry.coordinates
      if (inside(p) && !onAsphalt(p, layer)) add('arrow-off-asphalt', p, `${f.properties.icon} at bearing ${f.properties.bearing}`)
    } else if (kind === 'lane-line' || kind === 'centre-line') {
      const c = f.geometry.coordinates
      const p = c[Math.floor(c.length / 2)]
      if (inside(p) && !onAsphalt(p, layer)) add('line-off-asphalt', p, `${kind} (${f.properties.dash})`)
    } else if (kind === 'carriageway') {
      const ring = f.geometry.coordinates[0]
      let area = 0
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) area += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1])
      const m2 = Math.abs(area / 2) * 111_320 * 111_320 * Math.cos((ring[0][1] * Math.PI) / 180)
      const p = ring[0]
      if (inside(p) && m2 < 2) add('sliver', p, `a carriageway of ${m2.toFixed(2)} m²`)
    }
  }
}

// ---- every square ----------------------------------------------------------------------------------
const t0 = Date.now()
const keys = readdirSync(DIR).map((f) => f.replace('.ndjson.gz', '').split('-').map(Number)).sort((a, b) => a[1] - b[1] || a[0] - b[0])
const seen = new Set()
let done = 0
for (const [x, y] of keys) {
  const box = [lon(x), lat(y + 1), lon(x + 1), lat(y)]
  if (only && (box[2] < only[0] || box[0] > only[2] || box[3] < only[1] || box[1] > only[3])) continue
  const here = bucket(x, y)
  for (const w of here.ways) {
    if (seen.has(w.id)) continue
    seen.add(w.id)
    if (w.tags.highway) checkData(w)
  }
  // Drawn with the roads of the squares round it, so junctions on its edge are whole.
  const M = 0.004
  const ways = new Map(), nodes = new Map()
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const b = bucket(x + dx, y + dy)
      for (const w of b.ways) if (w.coords.some(([a, c]) => a > box[0] - M && a < box[2] + M && c > box[1] - M / 2 && c < box[3] + M / 2)) ways.set(w.id, w)
      for (const nd of b.nodes) nodes.set(nd.node, nd)
    }
  }
  if (ways.size) {
    try {
      const fc = buildRoads([...ways.values()], [...nodes.values()], box, { laneGraph: true })
      checkDrawn(fc, box)
      // Where the lanes as a navigator links them break, and where the kerbs step.
      const inBox = (p) => p[0] >= box[0] && p[0] < box[2] && p[1] >= box[1] && p[1] < box[3]
      for (const b of fc.laneGraph.broken) if (inBox(b.at) && !/^(service|living_street|track|pedestrian)$/.test(b.highway)) add(`lane-${b.what.replace(' ', '-')}`, b.at, `${b.way} lane ${b.lane + 1} of ${b.of} (${b.highway})`)
      for (const st of fc.steps) if (inBox(st.at)) add(st.what.startsWith('width') ? 'width-jump' : 'kerb-step', st.at, `${st.what}: ${st.d} m`)
    } catch (err) {
      add('build-failed', [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2], String(err?.message ?? err))
    }
  }
  if (++done % 200 === 0) console.log(`${done} squares, ${findings.length} findings, ${((Date.now() - t0) / 60000).toFixed(1)} min`)
}

mkdirSync(OUT, { recursive: true })
writeFileSync(join(OUT, 'audit.json'), JSON.stringify(findings, null, 1))
writeFileSync(join(OUT, 'audit.geojson'), JSON.stringify({ type: 'FeatureCollection', features: findings.map((f) => ({ type: 'Feature', properties: { check: f.check, detail: f.detail }, geometry: { type: 'Point', coordinates: [f.lon, f.lat] } })) }))
const by = {}
for (const f of findings) {
  by[f.check] ??= { all: 0, LV: 0, LT: 0, EE: 0, some: [] }
  by[f.check].all++
  by[f.check][f.country]++
  if (by[f.check].some.length < 5) by[f.check].some.push(`${f.lat},${f.lon} ${f.detail}`)
}
console.log(`\n${done} squares in ${((Date.now() - t0) / 60000).toFixed(1)} min; ${findings.length} findings:`)
for (const [check, v] of Object.entries(by).sort((a, b) => b[1].all - a[1].all)) {
  console.log(`${check}: ${v.all} (LV ${v.LV}, LT ${v.LT}, EE ${v.EE})`)
  for (const s of v.some) console.log(`   ${s}`)
}
