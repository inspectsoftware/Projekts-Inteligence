// Manual, one-off: builds public/data/timezones.json from Natural Earth's 1:10m time zones
// (public domain). Never runs as part of `npm run build`; the result is committed.
//
//   node scripts/bake-timezones.mjs
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import mapshaper from 'mapshaper'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const cacheDir = join(root, 'scripts/.cache')
const SOURCE_URL = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_time_zones.geojson'
const SOURCE_FILE = join(cacheDir, 'ne_10m_time_zones.geojson')
const OUT = join(root, 'public/data/timezones.json')

mkdirSync(cacheDir, { recursive: true })
if (!existsSync(SOURCE_FILE)) {
  console.log('downloading', SOURCE_URL)
  const res = await fetch(SOURCE_URL)
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`)
  writeFileSync(SOURCE_FILE, Buffer.from(await res.arrayBuffer()))
}

// Zones are seen from far out, so the outlines can be coarse; shared edges are simplified together.
await mapshaper.runCommands(
  `-i "${SOURCE_FILE}" -simplify 3% keep-shapes ` +
    `-rename-fields offset=zone,label=utc_format,iana=tz_name1st -filter-fields offset,label,places,iana ` +
    `-o "${OUT}" format=geojson precision=0.01 force`,
)
console.log(OUT, `${Math.round(statSync(OUT).size / 1024)} kB`)
