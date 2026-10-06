// Manual, one-off: builds the two reference files behind warship recognition and the
// "in Latvian waters" test. Never runs as part of `npm run build`; the results are committed.
//
//   shared/data/warships.ts   vessels Wikidata lists as operated by a navy, by MMSI (CC0)
//   shared/data/lvWaters.ts   Latvia's territorial sea and exclusive economic zone, from
//                             Marine Regions (Flanders Marine Institute), CC BY
//
//   node scripts/bake-naval.mjs
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import mapshaper from 'mapshaper'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const cacheDir = join(root, 'scripts/.cache/naval')
const outDir = join(root, 'shared/data')
const USER_AGENT = 'ProjektsInteligence/0.1 (non-commercial Latvia OSINT dashboard; one-off data bake)'
const today = new Date().toISOString().slice(0, 10)

mkdirSync(cacheDir, { recursive: true })
mkdirSync(outDir, { recursive: true })

async function get(url, accept) {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: accept }, signal: AbortSignal.timeout(90_000) })
  if (!res.ok) throw new Error(`${new URL(url).host} answered HTTP ${res.status}`)
  return res.json()
}

const quote = (text) => `'${text.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`

// ---- Navy vessels with an MMSI ------------------------------------------------------------

// Every ship with an MMSI (P587) whose operator (P137) is a navy (Q4508) or a kind of one.
// Left out are those Wikidata itself calls a bunker vessel, a passenger vessel or ferry, a cruise
// ship or a steamship: some thirty merchant bunker tankers carry a navy as operator (eighteen of
// the twenty-one Russian entries were such), and so do a tourist steamer or two.
const SPARQL = `SELECT ?mmsi ?shipLabel ?operatorLabel WHERE {
  ?ship wdt:P587 ?mmsi ; wdt:P137 ?operator .
  ?operator wdt:P31/wdt:P279* wd:Q4508 .
  FILTER NOT EXISTS { VALUES ?civil { wd:Q1009600 wd:Q2055880 wd:Q2072352 wd:Q39804 wd:Q12859788 } ?ship wdt:P31 ?civil }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
} LIMIT 3000`

const answer = await get(`https://query.wikidata.org/sparql?query=${encodeURIComponent(SPARQL)}`, 'application/sparql-results+json')
// A label Wikidata has no English for comes back as the bare item id.
const label = (binding) => (binding && !/^Q\d+$/.test(binding.value) ? binding.value.trim() : '')

const ships = new Map()
for (const row of answer.results.bindings) {
  const mmsi = row.mmsi.value.trim()
  if (!/^\d{9}$/.test(mmsi)) continue
  const ship = ships.get(mmsi) ?? { name: label(row.shipLabel), operators: new Set() }
  // A ship handed from one navy to another is listed under both.
  if (label(row.operatorLabel)) ship.operators.add(label(row.operatorLabel))
  ships.set(mmsi, ship)
}
if (ships.size < 300) throw new Error(`Only ${ships.size} ships: the query no longer finds what it used to`)

const rows = [...ships]
  .sort(([a], [b]) => Number(a) - Number(b))
  .map(([mmsi, ship]) => `  ${mmsi}: [${quote(ship.name)}, ${quote([...ship.operators].sort().join(' / '))}],`)
writeFileSync(
  join(outDir, 'warships.ts'),
  `// Baked by scripts/bake-naval.mjs on ${today} from Wikidata (wikidata.org, CC0). Do not edit by hand.

/**
 * Vessels Wikidata lists as operated by a navy, by MMSI: the name it knows them under and the
 * operator. A hint, not a register: entries go stale when a ship is renamed, sold or scrapped.
 */
export const WARSHIPS: Readonly<Record<number, readonly [name: string, operator: string]>> = {
${rows.join('\n')}
}
`,
)
console.log(`warships.ts: ${ships.size} vessels`)

// ---- Latvia's waters ----------------------------------------------------------------------

const eezFile = join(cacheDir, 'lv-eez.geojson')
const simplifiedFile = join(cacheDir, 'lv-eez.simplified.geojson')
const eez = await get(
  "https://geo.vliz.be/geoserver/MarineRegions/wfs?service=WFS&version=1.0.0&request=GetFeature&typeName=MarineRegions:eez&cql_filter=iso_ter1%3D'LVA'&outputFormat=application/json",
  'application/json',
)
if (eez.features?.length !== 1) throw new Error(`Expected one zone for Latvia, got ${eez.features?.length}`)
writeFileSync(eezFile, JSON.stringify(eez))

// About 200 m: the outline runs along the coast, and a harbour mouth should stay where it is.
await mapshaper.runCommands(`-i "${eezFile}" -simplify dp interval=200 keep-shapes -o "${simplifiedFile}" format=geojson precision=0.0001`)
const { geometry } = JSON.parse(readFileSync(simplifiedFile, 'utf8')).features[0]
const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates
// The outer ring only. The few holes are islets, where no vessel will be reported.
const [ring] = polygons.map(([outer]) => outer).sort((a, b) => b.length - a.length)

const points = ring.map(([lon, lat]) => `[${lon}, ${lat}]`)
const lines = []
for (let i = 0; i < points.length; i += 6) lines.push(`  ${points.slice(i, i + 6).join(', ')},`)
writeFileSync(
  join(outDir, 'lvWaters.ts'),
  `// Baked by scripts/bake-naval.mjs on ${today} from Marine Regions (Flanders Marine Institute,
// Maritime Boundaries Geodatabase, marineregions.org, CC BY). Do not edit by hand.

/**
 * Outline of Latvia's territorial sea and exclusive economic zone together, as [lon, lat].
 * Simplified to about 200 m, and without legal value: the source says so of its own data.
 */
export const LV_WATERS: readonly (readonly [number, number])[] = [
${lines.join('\n')}
]
`,
)
console.log(`lvWaters.ts: ${ring.length} points (from ${eez.features[0].geometry.coordinates[0][0].length})`)
