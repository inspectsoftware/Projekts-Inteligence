// Manual, monthly: builds public/data/landmarks.json, the well-known places of Estonia, Latvia and
// Lithuania drawn on the map with a pictogram of their kind (castle, cathedral, museum…), as a city
// map marks its sights. From Wikidata (CC0): places of these kinds with coordinates, ranked by how
// many Wikipedias have an article on them, named in the site's five languages. Never runs as part
// of `npm run build`; the result is committed.
//
//   node scripts/bake-landmarks.mjs
import { writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'public/data/landmarks.json')
const ENDPOINT = 'https://query.wikidata.org/sparql'
const USER_AGENT = 'ProjektsInteligence/0.1 (non-commercial Baltic map; one-off data bake; +https://inteligence.lv)'

/** Our kinds, each the Wikidata classes (and their subclasses) that count as it. First match wins. */
const KINDS = [
  ['castle', ['Q23413', 'Q57821', 'Q1785071']], // castle, fortress, fort
  ['palace', ['Q16560', 'Q879050']], // palace, manor house
  ['cathedral', ['Q2977']],
  ['church', ['Q16970', 'Q108325']], // church building, chapel
  ['museum', ['Q33506', 'Q207694']], // museum, art museum
  ['theatre', ['Q24354', 'Q153562', 'Q1060829']], // theatre, opera house, concert hall
  ['tower', ['Q12518', 'Q11166728', 'Q1440300']], // tower, communications tower, observation tower
  ['monument', ['Q4989906', 'Q575759']], // monument, war memorial
  ['park', ['Q22698', 'Q167346', 'Q43501']], // park, botanical garden, zoo
  ['stadium', ['Q483110', 'Q1076486']], // stadium, sports venue
  ['station', ['Q55488']], // railway station
  ['lighthouse', ['Q39715']],
  ['bridge', ['Q12280']],
  ['university', ['Q3918']],
  ['square', ['Q174782']],
  ['market', ['Q330284', 'Q37654']], // market hall, market
  ['townhall', ['Q543654', 'Q25550691']], // city hall, town hall
]

const COUNTRIES = { Q211: 'LV', Q37: 'LT', Q191: 'EE' }
/** Fewer Wikipedias than this, and a place is not one a visitor would know. */
const MIN_SITELINKS = 5

// `deep` follows subclasses too; a class with too many of them (museum) times out, and is asked again without.
const query = (classes, deep) => `
SELECT ?item ?coord ?country ?links ?en ?lv ?lt ?et ?ru WHERE {
  VALUES ?class { ${classes.map((q) => `wd:${q}`).join(' ')} }
  VALUES ?country { ${Object.keys(COUNTRIES).map((q) => `wd:${q}`).join(' ')} }
  ?item wdt:P17 ?country ; wikibase:sitelinks ?links .
  FILTER(?links >= ${MIN_SITELINKS})
  ?item wdt:P31${deep ? '/wdt:P279*' : ''} ?class ; wdt:P625 ?coord .
  FILTER NOT EXISTS { ?item wdt:P576 [] }
  OPTIONAL { ?item rdfs:label ?en FILTER(LANG(?en) = "en") }
  OPTIONAL { ?item rdfs:label ?lv FILTER(LANG(?lv) = "lv") }
  OPTIONAL { ?item rdfs:label ?lt FILTER(LANG(?lt) = "lt") }
  OPTIONAL { ?item rdfs:label ?et FILTER(LANG(?et) = "et") }
  OPTIONAL { ?item rdfs:label ?ru FILTER(LANG(?ru) = "ru") }
}`

const places = new Map()
for (const [kind, classes] of KINDS) {
  const ask = (deep) =>
    fetch(`${ENDPOINT}?query=${encodeURIComponent(query(classes, deep))}`, {
      headers: { Accept: 'application/sparql-results+json', 'User-Agent': USER_AGENT },
    })
  let res = await ask(true)
  if (!res.ok) {
    console.log(kind, `HTTP ${res.status}, asking without subclasses`)
    await new Promise((r) => setTimeout(r, 3000))
    res = await ask(false)
  }
  if (!res.ok) throw new Error(`${kind}: HTTP ${res.status}`)
  const rows = (await res.json()).results.bindings
  let added = 0
  for (const row of rows) {
    const id = row.item.value.split('/').pop()
    if (places.has(id)) continue
    const [, lon, lat] = row.coord.value.match(/Point\(([-\d.]+) ([-\d.]+)\)/) ?? []
    if (!lon) continue
    const country = COUNTRIES[row.country.value.split('/').pop()]
    const name = Object.fromEntries(['en', 'lv', 'lt', 'et', 'ru'].flatMap((l) => (row[l] ? [[l, row[l].value]] : [])))
    // The local name first: what the sign at the door says.
    const local = name[country.toLowerCase() === 'ee' ? 'et' : country.toLowerCase()] ?? name.en
    if (!local) continue
    places.set(id, { id, kind, country, lon: +(+lon).toFixed(5), lat: +(+lat).toFixed(5), links: +row.links.value, name })
    added++
  }
  console.log(kind.padEnd(11), added)
  // The query service asks for some room between queries.
  await new Promise((r) => setTimeout(r, 1500))
}

// GeoJSON, the best known first, for the map to read as it is: `name` in the local language, the
// rest only where they say something else.
const LOCAL = { LV: 'lv', LT: 'lt', EE: 'et' }
const features = [...places.values()]
  .sort((a, b) => b.links - a.links)
  .map(({ id, kind, country, lon, lat, links, name }) => {
    const local = name[LOCAL[country]] ?? name.en
    const other = Object.fromEntries(Object.entries(name).flatMap(([l, n]) => (n !== local ? [[`name_${l}`, n]] : [])))
    return { type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties: { id, kind, links, name: local, ...other } }
  })
const json = JSON.stringify({ type: 'FeatureCollection', features })
writeFileSync(out, json)
console.log('landmarks.json', features.length, 'places,', Math.round(json.length / 1024), 'kB')
