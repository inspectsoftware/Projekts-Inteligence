// Manual, one-off: builds public/data/world-countries.json from Natural Earth's 1:110m countries
// (public domain). Never runs as part of `npm run build`; the result is committed.
//
//   node scripts/bake-world.mjs
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE_URL = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson'

console.log('downloading', SOURCE_URL)
const res = await fetch(SOURCE_URL)
if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`)
const world = await res.json()

// Two decimals is about a kilometre: the outlines are only ever coloured in from far out.
const round = (coords) => (typeof coords[0] === 'number' ? coords.map((value) => Math.round(value * 100) / 100) : coords.map(round))

const features = world.features.map(({ properties: p, geometry }) => ({
  type: 'Feature',
  properties: { name: p.NAME, long: p.NAME_LONG, iso2: p.ISO_A2_EH, lon: p.LABEL_X, lat: p.LABEL_Y },
  geometry: { type: geometry.type, coordinates: round(geometry.coordinates) },
}))

const out = join(root, 'public/data/world-countries.json')
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, JSON.stringify({ type: 'FeatureCollection', features }))
console.log(features.length, 'countries ->', out)
