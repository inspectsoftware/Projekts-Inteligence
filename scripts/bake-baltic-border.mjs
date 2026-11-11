// Manual, one-off: builds public/data/baltic-border.json, the outline of Estonia, Latvia and
// Lithuania together, which the map lights up against the rest of the world (src/map/spotlight.ts).
// From geoBoundaries' national outlines (gbOpen: Latvia from its Geoportal under CC BY 4.0,
// Lithuania and Estonia from OpenStreetMap under ODbL). Never runs as part of `npm run build`;
// the result is committed.
//
//   node scripts/bake-baltic-border.mjs
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import mapshaper from 'mapshaper'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const cacheDir = join(root, 'scripts/.cache/baltic-border')
const out = join(root, 'public/data/baltic-border.json')
const RELEASE = 'https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen'

mkdirSync(cacheDir, { recursive: true })

const files = []
for (const country of ['EST', 'LVA', 'LTU']) {
  const file = join(cacheDir, `${country}.geojson`)
  if (!existsSync(file)) {
    const url = `${RELEASE}/${country}/ADM0/geoBoundaries-${country}-ADM0.geojson`
    console.log('downloading', url)
    const res = await fetch(url)
    if (!res.ok) throw new Error(`${country}: HTTP ${res.status}`)
    writeFileSync(file, Buffer.from(await res.arrayBuffer()))
  }
  files.push(file)
}

// One outline for the three: the files come from different surveys, so their shared borders are
// snapped together before they are dissolved, and no sliver of dimmed map is left between two
// countries. Islets under 2 km² are left out (thousands of them, off Estonia), and the line is
// simplified to about 150 m, under a pixel at zoom 9: by the zoom where that
// would show, the spotlight has faded out (spotlight.ts).
await mapshaper.runCommands(
  `-i ${files.map((file) => `"${file}"`).join(' ')} combine-files ` +
    `-merge-layers force -snap interval=0.0005 -dissolve2 -filter-islands min-area=2km2 -simplify interval=150 keep-shapes -clean ` +
    `-filter-fields -o "${out}" format=geojson geojson-type=FeatureCollection precision=0.0001`,
)

// Rounding to 0.0001° after the clean leaves slivers: rings of next to no area, touching the coast,
// which the map's triangulation turns into wedges of shade across the country. Gone, with the rest.
const ringKm2 = (ring) => {
  let sum = 0
  for (let i = 1; i < ring.length; i++) sum += ring[i - 1][0] * ring[i][1] - ring[i][0] * ring[i - 1][1]
  return Math.abs(sum / 2) * 111.32 * 111.32 * Math.cos((ring[0][1] * Math.PI) / 180)
}
const baked = JSON.parse(readFileSync(out, 'utf8'))
for (const feature of baked.features) {
  if (feature.geometry.type === 'MultiPolygon') feature.geometry.coordinates = feature.geometry.coordinates.filter((polygon) => ringKm2(polygon[0]) >= 1)
}
writeFileSync(out, JSON.stringify(baked))

const geojson = JSON.parse(readFileSync(out, 'utf8'))
console.log('baltic-border.json', (statSync(out).size / 1024).toFixed(0), 'kB,', geojson.features.length, 'features')
