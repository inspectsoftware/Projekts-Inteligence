// Manual, one-off: builds the reference layers and the place-name index from OpenStreetMap
// (via the Overpass API, © OpenStreetMap contributors, ODbL). Never runs as part of
// `npm run build`; the results in public/data/ are committed.
//
//   node scripts/bake-osm.mjs            # uses cached responses when present
//   node scripts/bake-osm.mjs --refresh  # asks Overpass again
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const cacheDir = join(root, 'scripts/.cache/osm')
const outDir = join(root, 'public/data')
const refresh = process.argv.includes('--refresh')

// Public Overpass servers, tried in turn: any one of them is often busy.
const OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
]
const USER_AGENT = 'ProjektsInteligence/0.1 (non-commercial Latvia OSINT dashboard; one-off data bake)'
const LATVIA = 'area["ISO3166-1"="LV"][admin_level=2]->.lv;'
/** Latvia plus its sea approaches, as (south, west, north, east). */
const SEA_BBOX = '55.2,18.5,59.0,25.0'

/** A mirror whose copy of the data is older than this is not trusted. */
const MAX_DATA_AGE_MS = 14 * 24 * 3600_000

/** Queries that no server answered this run. */
const missing = []

mkdirSync(cacheDir, { recursive: true })
mkdirSync(outDir, { recursive: true })

const pause = (ms) => new Promise((done) => setTimeout(done, ms))

/**
 * Why an answer cannot be used, or null. Every query here is known to match something, so an
 * empty answer means the server is broken: mirrors have been seen answering 200 with nothing
 * from a months-old copy of the data.
 */
function problemWith(answer) {
  if (!Array.isArray(answer.elements) || answer.elements.length === 0) return 'empty answer'
  const dataTime = Date.parse(answer.osm3s?.timestamp_osm_base ?? '')
  if (Number.isFinite(dataTime) && Date.now() - dataTime > MAX_DATA_AGE_MS) return `stale data (${answer.osm3s.timestamp_osm_base})`
  return null
}

/** Runs one Overpass query, caching the raw answer so a re-run does not hit the server again. */
async function overpass(name, body) {
  const file = join(cacheDir, `${name}.json`)
  if (!refresh && existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'))
  const query = `[out:json][timeout:90];${body}`
  for (const server of OVERPASS) {
    const host = new URL(server).host
    let wait = 8000
    try {
      const res = await fetch(server, {
        method: 'POST',
        headers: { 'User-Agent': USER_AGENT, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(100_000),
      })
      if (res.ok) {
        const text = await res.text()
        const parsed = JSON.parse(text)
        const problem = problemWith(parsed)
        if (!problem) {
          writeFileSync(file, text)
          console.log(`  ${name}: ${parsed.elements.length} elements from ${host}`)
          // Be a polite guest on a shared public server.
          await pause(4000)
          return parsed
        }
        console.log(`  ${name}: ${problem} from ${host}`)
      } else {
        console.log(`  ${name}: HTTP ${res.status} from ${host}`)
        // 429 means our share of the server is used up for the moment.
        if (res.status === 429) wait = 30_000
      }
    } catch (err) {
      console.log(`  ${name}: ${err.name} from ${host}`)
    }
    await pause(wait)
  }
  console.log(`  ${name}: no server answered; this part is left out (run again later to fill it in)`)
  missing.push(name)
  return { elements: [] }
}

// ---- Geometry helpers ---------------------------------------------------------------------

const round = (value) => Math.round(value * 1e5) / 1e5

/** Good to a fraction of a percent at these latitudes and distances. */
function distanceKm([lon1, lat1], [lon2, lat2]) {
  const x = (lon2 - lon1) * Math.cos((((lat1 + lat2) / 2) * Math.PI) / 180)
  return Math.hypot(x, lat2 - lat1) * 111.19
}

const lengthKm = (line) => line.slice(1).reduce((sum, point, i) => sum + distanceKm(line[i], point), 0)

/** Douglas-Peucker, same idea as shared/geo/simplify.ts (kept separate: this script is plain JS). */
function simplify(points, tolerance) {
  if (points.length <= 2) return points
  const keep = new Uint8Array(points.length)
  keep[0] = keep[points.length - 1] = 1
  const stack = [[0, points.length - 1]]
  while (stack.length) {
    const [first, last] = stack.pop()
    let worst = 0
    let index = -1
    const [ax, ay] = points[first]
    const [bx, by] = points[last]
    const dx = bx - ax
    const dy = by - ay
    const length2 = dx * dx + dy * dy
    for (let i = first + 1; i < last; i++) {
      const [px, py] = points[i]
      const t = length2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length2))
      const distance = Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
      if (distance > worst) {
        worst = distance
        index = i
      }
    }
    if (index !== -1 && worst > tolerance) {
      keep[index] = 1
      stack.push([first, index], [index, last])
    }
  }
  return points.filter((_, i) => keep[i])
}

const lineOf = (way, tolerance) => simplify(way.geometry.map((p) => [p.lon, p.lat]), tolerance).map(([x, y]) => [round(x), round(y)])
const centreOf = (element) =>
  element.type === 'node' ? [round(element.lon), round(element.lat)] : [round(element.center.lon), round(element.center.lat)]
const clean = (properties) => Object.fromEntries(Object.entries(properties).filter(([, v]) => v !== undefined && v !== ''))
const englishName = (tags) => tags['name:en'] ?? tags.name

function feature(geometry, properties) {
  const points = geometry.type === 'Point' ? [geometry.coordinates] : geometry.coordinates
  // An Overpass "out" statement that leaves coordinates out would otherwise bake silently into nulls.
  if (!points.every(([lon, lat]) => Number.isFinite(lon) && Number.isFinite(lat))) {
    throw new Error(`A ${properties.class} feature has no coordinates: check the query's "out" statement`)
  }
  return { type: 'Feature', geometry, properties: clean(properties) }
}

function save(name, value) {
  const file = join(outDir, name)
  writeFileSync(file, JSON.stringify(value))
  const count = Array.isArray(value) ? value.length : value.features.length
  console.log(`${name}: ${(statSync(file).size / 1024).toFixed(0)} kB, ${count} items`)
}

/** Highest voltage on a line or substation, in kV ("330000;110000" -> 330). */
const kilovolts = (voltage) => Math.max(0, ...String(voltage ?? '').split(';').map((v) => Number(v) / 1000 || 0))

/** "908 MW" or "20700 kW" in megawatts. Mappers also write "yes", which says nothing. */
function megawatts(output) {
  const match = /^([\d.]+)\s*([kMG])W$/.exec(String(output ?? '').trim())
  if (!match) return undefined
  const value = Number(match[1]) * { k: 0.001, M: 1, G: 1000 }[match[2]]
  return Number.isFinite(value) && value > 0 ? Math.round(value * 100) / 100 : undefined
}

// ---- Place names, for search -------------------------------------------------------------

const places = await overpass('places', `${LATVIA}node(area.lv)[place~"^(city|town|village)$"][name];out;`)
if (places.elements.length > 0) {
  save(
    'lv-places.json',
    places.elements
      .map((node) => ({
        name: node.tags.name,
        kind: node.tags.place,
        lon: round(node.lon),
        lat: round(node.lat),
        population: Number(node.tags.population) || 0,
      }))
      .sort((a, b) => b.population - a.population || a.name.localeCompare(b.name, 'lv')),
  )
}

// ---- Reference layers -------------------------------------------------------------------

const features = []

const aerodromes = await overpass('aerodromes', `${LATVIA}nwr(area.lv)[aeroway=aerodrome][name];out center tags;`)
for (const element of aerodromes.elements) {
  const tags = element.tags
  if (tags.disused === 'yes' || tags.abandoned === 'yes') continue
  features.push(
    feature(
      { type: 'Point', coordinates: centreOf(element) },
      {
        class: 'aerodrome',
        name: englishName(tags),
        icao: tags.icao,
        iata: tags.iata,
        military: tags.military || tags.landuse === 'military' || tags['aerodrome:type'] === 'military' ? 1 : undefined,
        international: tags['aerodrome:type'] === 'international' || tags.iata ? 1 : undefined,
      },
    ),
  )
}

const lines = await overpass('power-lines', `${LATVIA}way(area.lv)[power=line][voltage~"110000|330000"];out tags geom;`)
for (const way of lines.elements) {
  const kv = kilovolts(way.tags.voltage)
  if (kv >= 110) features.push(feature({ type: 'LineString', coordinates: lineOf(way, 0.0004) }, { class: 'power-line', kv }))
}

const plants = await overpass('power-plants', `${LATVIA}nwr(area.lv)[power=plant];out tags center;`)
for (const element of plants.elements) {
  const tags = element.tags
  const name = englishName(tags)
  const mw = megawatts(tags['plant:output:electricity'])
  // Half of what is mapped is a rooftop-scale array with neither a name nor a size: nothing to show.
  if (!name && mw === undefined) continue
  features.push(
    feature({ type: 'Point', coordinates: centreOf(element) }, { class: 'power-plant', name, source: tags['plant:source']?.split(';')[0], mw }),
  )
}

const substations = await overpass(
  'power-substations',
  `${LATVIA}nwr(area.lv)[power=substation][voltage~"110000|330000"];out tags center;`,
)
for (const element of substations.elements) {
  const kv = kilovolts(element.tags.voltage)
  if (kv >= 110) features.push(feature({ type: 'Point', coordinates: centreOf(element) }, { class: 'substation', name: element.tags.name, kv }))
}

const military = await overpass('military', `${LATVIA}(way(area.lv)[landuse=military];relation(area.lv)[landuse=military];);out tags center;`)
for (const element of military.elements) {
  const tags = element.tags
  const name = englishName(tags)
  // An unnamed patch of military land with no stated use is a fenced field as far as this map can tell.
  if (!name && !tags.military) continue
  features.push(feature({ type: 'Point', coordinates: centreOf(element) }, { class: 'defence', name, kind: tags.military }))
}

// One checkpoint is mapped booth by booth: everything within 1.5 km becomes one point,
// named after what most of its booths are called.
const crossings = await overpass('border-crossings', `${LATVIA}node(area.lv)[barrier=border_control];out;`)
const checkpoints = []
for (const node of crossings.elements) {
  const at = [node.lon, node.lat]
  let checkpoint = checkpoints.find((candidate) => distanceKm(candidate.points[0], at) < 1.5)
  if (!checkpoint) checkpoints.push((checkpoint = { points: [], names: new Map() }))
  checkpoint.points.push(at)
  // "Pāternieki (TIR)" is the lorry lane of Pāternieki.
  const name = englishName(node.tags ?? {})?.replace(/\s*\(.*\)$/, '')
  if (name) checkpoint.names.set(name, (checkpoint.names.get(name) ?? 0) + 1)
}
// Booths mapped without a name, named here after where they stand.
const UNNAMED_CHECKPOINTS = [
  { at: [23.978, 56.923], name: 'Riga Airport' },
  { at: [26.874, 55.718], name: 'Silene' },
  { at: [28.117, 56.392], name: 'Zilupe (rail)' },
  { at: [20.997, 56.528], name: 'Port of Liepāja' },
]
for (const { points, names } of checkpoints) {
  const mean = (axis) => round(points.reduce((sum, point) => sum + point[axis], 0) / points.length)
  const coordinates = [mean(0), mean(1)]
  const [name] = [...names].sort((a, b) => b[1] - a[1])[0] ?? []
  const known = UNNAMED_CHECKPOINTS.find((checkpoint) => distanceKm(checkpoint.at, coordinates) < 2)
  features.push(feature({ type: 'Point', coordinates }, { class: 'border-crossing', name: name ?? known?.name }))
}

// The ten ports named in Latvia's Law on Ports. OpenStreetMap's harbour tagging here is
// almost all yacht clubs, so this short list is kept by hand, at each harbour's basin.
const PORTS = [
  { name: 'Freeport of Riga', lon: 24.074, lat: 57.026, major: 1 },
  { name: 'Freeport of Ventspils', lon: 21.5394, lat: 57.4014, major: 1 },
  { name: 'Port of Liepāja', lon: 20.9978, lat: 56.5283, major: 1 },
  { name: 'Skulte', lon: 24.4071, lat: 57.3153 },
  { name: 'Mērsrags', lon: 23.1335, lat: 57.3345 },
  { name: 'Salacgrīva', lon: 24.3578, lat: 57.7558 },
  { name: 'Pāvilosta', lon: 21.174, lat: 56.889 },
  { name: 'Roja', lon: 22.8049, lat: 57.5082 },
  { name: 'Engure', lon: 23.2312, lat: 57.1622 },
  { name: 'Jūrmala (Lielupe)', lon: 23.878, lat: 56.981 },
]
for (const { name, lon, lat, major } of PORTS) features.push(feature({ type: 'Point', coordinates: [lon, lat] }, { class: 'port', name, major }))

// Asked for by plain tag matches (cheap for the server) and narrowed down here. Only named
// lines are kept: the rest is water mains and cables out to skerries.
const undersea = await overpass(
  'undersea',
  `(way(${SEA_BBOX})[location=underwater][name];way(${SEA_BBOX})[submarine=yes][name];way(${SEA_BBOX})["seamark:type"~"^(cable_submarine|pipeline_submarine)$"][name];);out tags geom;`,
)
const seabed = new Map()
for (const way of undersea.elements) {
  const tags = way.tags ?? {}
  const seamark = tags['seamark:type']
  const isPipeline = tags.man_made === 'pipeline' || seamark === 'pipeline_submarine'
  const isPower = tags.power === 'cable' || tags.power === 'line' || tags['seamark:cable_submarine:category'] === 'power'
  const isTelecom = Boolean(tags.communication || tags.telecom) || seamark === 'cable_submarine'
  const name = englishName(tags)
  if (!name || !way.geometry || !(isPipeline || isPower || isTelecom)) continue
  const line = {
    coordinates: lineOf(way, 0.001),
    properties: {
      class: 'undersea',
      kind: isPipeline ? 'pipeline' : isPower ? 'power' : 'telecom',
      name,
      operator: tags.operator,
      substance: tags.substance ?? tags['seamark:pipeline_submarine:product'],
      rating: tags.rating,
    },
  }
  seabed.set(name, [...(seabed.get(name) ?? []), line])
}
for (const parts of seabed.values()) {
  // A long line is mapped in several pieces; short ones are harbour and island connections.
  if (parts.reduce((sum, part) => sum + lengthKm(part.coordinates), 0) < 25) continue
  for (const part of parts) features.push(feature({ type: 'LineString', coordinates: part.coordinates }, part.properties))
}

save('lv-infrastructure.json', { type: 'FeatureCollection', features })

const counts = {}
for (const f of features) counts[f.properties.class] = (counts[f.properties.class] ?? 0) + 1
console.log(counts)
if (missing.length > 0) console.log('MISSING (no server answered):', missing.join(', '))
