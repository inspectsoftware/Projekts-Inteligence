// Manual, one-off: builds public/data/lv-border.json and lv-municipalities.json from the
// official administrative territories dataset (data.gov.lv, CC0, published in LKS-92 metres).
// Never runs as part of `npm run build`; the results are committed.
//
//   node scripts/bake-boundaries.mjs
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import mapshaper from 'mapshaper'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const cacheDir = join(root, 'scripts/.cache')
const outDir = join(root, 'public/data')

const SOURCE_URL =
  'https://data.gov.lv/dati/dataset/7bb04db9-97ce-4a30-b93a-10ba8dafd104/resource/f1fe9a47-62af-4156-84ae-b11ac029b00f/download/administrativas_teritorijas_2026.geojson'
const SOURCE_FILE = join(cacheDir, 'administrativas_teritorijas_2026.geojson')

// EPSG:3059 (LKS-92 / Latvia TM), spelled out so the result does not depend on a bundled EPSG table.
const LKS92 = '+proj=tmerc +lat_0=0 +lon_0=24 +k=0.9996 +x_0=500000 +y_0=-6000000 +ellps=GRS80 +units=m +no_defs'

mkdirSync(cacheDir, { recursive: true })
mkdirSync(outDir, { recursive: true })

if (!existsSync(SOURCE_FILE)) {
  console.log('downloading', SOURCE_URL)
  const res = await fetch(SOURCE_URL)
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`)
  writeFileSync(SOURCE_FILE, Buffer.from(await res.arrayBuffer()))
}
console.log('source', (statSync(SOURCE_FILE).size / 1e6).toFixed(1), 'MB')

const reproject = `-proj wgs84 from="${LKS92}"`

// National outline: every territory dissolved into one shape.
await mapshaper.runCommands(
  `-i "${SOURCE_FILE}" ${reproject} -dissolve -simplify 4% keep-shapes -clean ` +
    `-o "${join(outDir, 'lv-border.json')}" format=geojson geojson-type=FeatureCollection precision=0.0001`,
)

// Municipalities and state cities, simplified together so shared edges stay shared.
await mapshaper.runCommands(
  `-i "${SOURCE_FILE}" ${reproject} -simplify 3% keep-shapes -clean ` +
    `-rename-fields name=nosaukums,code=atrib -filter-fields name,code ` +
    `-o "${join(outDir, 'lv-municipalities.json')}" format=geojson precision=0.0001`,
)

for (const name of ['lv-border.json', 'lv-municipalities.json']) {
  const file = join(outDir, name)
  const geojson = JSON.parse(readFileSync(file, 'utf8'))
  console.log(name, (statSync(file).size / 1024).toFixed(0), 'kB,', geojson.features.length, 'features')
}
