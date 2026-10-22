// Manual, now and then: builds public/data/city-3d.json, the catalogue of the city models the 3D
// city draws. Rīga's comes from GEO RĪGA's web scene "3D_RIGA_LOD2" on ArcGIS Online: for every
// neighbourhood the I3S scene layer of its buildings (LOD2, from airborne laser scanning) and,
// where there is one, of its trees. Beyond Rīga, single layers that cover a whole country or city
// are listed by hand below. For each layer: where it is, its coordinate system and its extent. A
// layer of many node pages also gets a leaf index in public/data/city-leaves/, so the browser need
// not read thousands of nodes to find the few near the camera. The browser fetches the geometry
// itself, straight from the scene services. Never runs as part of `npm run build`; the result is
// committed. Run it again when a city adds or replaces a layer.
// Data: Rīgas valstspilsētas pašvaldība (GEO RĪGA), CC BY 4.0; the others as listed in OTHERS.
//
//   node scripts/bake-city-3d.mjs
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outFile = join(root, 'public/data/city-3d.json')
const leafDir = join(root, 'public/data/city-leaves')
const USER_AGENT = 'ProjektsInteligence/0.1 (non-commercial Latvia OSINT dashboard; one-off data bake)'
const WEB_SCENE = 'https://www.arcgis.com/sharing/rest/content/items/e2a5e2ee33d645ea81dcd22c659d2996/data?f=json'
const today = new Date().toISOString().slice(0, 10)

/** Past this many node pages a layer gets a leaf index: Rīga's neighbourhoods have a page or two, Estonia 75. */
const MAX_PAGES_AT_RUNTIME = 10

/** The one vertex layout the city worker reads: I3S's default geometry buffer, uncompressed. */
const LAYOUT = { position: 'Float32x3', normal: 'Float32x3', uv0: 'Float32x2', color: 'UInt8x4', featureId: 'UInt64x1', faceRange: 'UInt32x2' }

/**
 * Building models beyond Rīga, one I3S layer each, in the same vertex layout. Each was added only
 * once its own item on ArcGIS Online (licenseInfo, accessInformation) stated an open licence for
 * the data; the README's data sources give each licence and credit. Fields are named as the layer
 * names its attributes, and looked up below; two names make one value, joined with a space.
 */
const OTHERS = [
  {
    // Maa- ja Ruumiamet's whole country, in its copy in degrees: the other is in Estonia's own grid.
    name: 'Eesti',
    slug: 'estonia',
    url: 'https://tiles.arcgis.com/tiles/ZYGCYltwz5ExeoGm/arcgis/rest/services/Hooned_LOD2_4326/SceneServer/layers/0',
    // katastritunnus links each parcel to the cadastre in HTML; a click shows only the text.
    fields: { address: ['ads_lahiaadress'], mainusetype: ['tyyp2'], propertycadastrenumber: ['katastritunnus'] },
  },
  // Esri Deutschland's copies of the two cities' own LoD2 models, under dl-de/by-2-0. Neither
  // carries an address, a use or a year: only ids and roof types.
  { name: 'Hamburg', slug: 'hamburg', url: 'https://tiles.arcgis.com/tiles/jUpNdisbWqRpMo35/arcgis/rest/services/HH_LOD2/SceneServer/layers/0' },
  { name: 'Berlin', slug: 'berlin', url: 'https://tiles.arcgis.com/tiles/jUpNdisbWqRpMo35/arcgis/rest/services/Berlin_3D/SceneServer/layers/0' },
  {
    // The city's own model, CC0, published by Esri's 3D demo account.
    name: 'Zürich',
    slug: 'zurich',
    url: 'https://services6.arcgis.com/oQnbmhWcCuy4gMUa/arcgis/rest/services/Zurich__Buildings_WM/SceneServer/layers/0',
    fields: { address: ['street_name', 'street_number'], mainusetype: ['description'], exploitstartdate: ['year_built'] },
  },
]

async function get(url) {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(30_000) })
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
  const json = await res.json()
  // ArcGIS answers an error with HTTP 200 and the error in the body.
  if (json.error) throw new Error(`${url}: ${json.error.message}`)
  return json
}

/** What a click on a building shows of it, from the State Land Service's cadastre the city joined to its model. */
const BUILDING_FIELDS = ['address', 'mainusetype', 'exploitstartdate', 'cadastrename', 'propertyname', 'propertycadastrenumber']

/** 4326: vertex offsets in degrees. 102100 (Web Mercator): offsets in metres. */
const crsOf = (layer) => ({ 4326: 4326, 102100: 3857, 3857: 3857 })[layer.spatialReference?.wkid] ?? null

function readable(buffer) {
  if (buffer?.offset !== 8 || buffer.compressedAttributes) return false
  const attributes = Object.keys(buffer).filter((key) => key !== 'offset')
  return attributes.length === 6 && attributes.every((key) => LAYOUT[key] === `${buffer[key].type}x${buffer[key].component}`)
}

/** Why the city worker could not draw a layer, or null when it can. */
function problem(layer) {
  if (layer.layerType === '3DObject' && !layer.nodePages) return 'no node pages'
  if (layer.layerType === '3DObject' && !readable(layer.geometryDefinitions?.[0]?.geometryBuffers?.[0])) return 'no uncompressed geometry in the default layout'
  // The older store 1.6 layers list their nodes another way.
  if (layer.layerType === 'Point' && !layer.pointNodePages) return `no point node pages (store ${layer.store?.version})`
  if (layer.layerType !== '3DObject' && layer.layerType !== 'Point') return `layer type ${layer.layerType}`
  if (!crsOf(layer)) return `coordinate system ${layer.spatialReference?.wkid}`
  if (!layer.fullExtent) return 'no extent'
  return null
}

/** A point in the layer's CRS as [longitude, latitude]. */
const degrees = (x, y, crs) => (crs === 3857 ? [(x / 6378137) * (180 / Math.PI), (2 * Math.atan(Math.exp(y / 6378137)) - Math.PI / 2) * (180 / Math.PI)] : [x, y])

/** [west, south, east, north] in degrees, rounded outward to 5 decimals (about a metre) so the box still holds the whole layer. */
function bbox({ xmin, ymin, xmax, ymax }, crs) {
  const [west, south] = degrees(xmin, ymin, crs)
  const [east, north] = degrees(xmax, ymax, crs)
  return [Math.floor(west * 1e5) / 1e5, Math.floor(south * 1e5) / 1e5, Math.ceil(east * 1e5) / 1e5, Math.ceil(north * 1e5) / 1e5]
}

/**
 * Every node of a layer, and how many pages held them. Pages hold 64 nodes; a shorter one is the
 * last. Past the last page tiles.arcgis.com answers 404, and services*.arcgis.com an error in a 200.
 */
async function allNodes(url) {
  const nodes = []
  for (let page = 0; ; page++) {
    const res = await fetch(`${url}/nodepages/${page}`, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(30_000) })
    if (res.status === 404 && page > 0) return { nodes, pages: page }
    if (!res.ok) throw new Error(`${url}/nodepages/${page}: HTTP ${res.status}`)
    const { nodes: some } = await res.json()
    if (!Array.isArray(some)) {
      if (page === 0) throw new Error(`${url}: no nodes`)
      return { nodes, pages: page }
    }
    nodes.push(...some)
    if (some.length < 64) return { nodes, pages: page + 1 }
  }
}

/**
 * A layer's leaves as the browser reads them: per leaf its resource number, the centre of its box
 * (longitude and latitude to 6 decimals, about 10 cm; height to 0.1 m), how far it reaches from
 * that centre in metres, and its vertex count. Arrays, not objects, as there are thousands.
 */
function leafRows(nodes, crs) {
  return nodes
    .filter((node) => node.mesh && !node.children?.length)
    .map(({ obb, mesh }) => {
      const [lng, lat] = degrees(obb.center[0], obb.center[1], crs)
      // The sphere round the box, as src/map/city/sources.ts boxRadius: a box often lies on its side,
      // its height along the second axis. Web Mercator metres are longer than ground metres away
      // from the equator.
      const radius = Math.hypot(...obb.halfSize) * (crs === 3857 ? Math.cos((lat * Math.PI) / 180) : 1)
      const { resource, vertexCount = 0 } = mesh.geometry
      return [resource, +lng.toFixed(6), +lat.toFixed(6), +obb.center[2].toFixed(1), Math.ceil(radius), vertexCount]
    })
}

// One group per neighbourhood. The names of the services do not say which is which (WSL1 is the
// trees in Pļavnieki and the buildings elsewhere), and neither should a title be trusted, so each
// layer is told apart by what its own description says. The "Pamatdati" group holds feature layers
// (addresses, parcels and the like), which are left out.
const scene = await get(WEB_SCENE)
const sceneLayers = scene.operationalLayers
  .filter((group) => group.layerType === 'GroupLayer')
  .flatMap((group) =>
    (group.layers ?? []).filter((layer) => layer.layerType === 'ArcGISSceneServiceLayer').map((layer) => ({ name: group.title, url: layer.url.replace(/\/$/, '') })),
  )

const buildings = []
const trees = []
// One at a time: some hundred small requests, and nobody is waiting on them.
for (const { name, url } of sceneLayers) {
  const layer = await get(`${url}?f=json`)
  const reason = problem(layer)
  if (reason) {
    console.warn(`skipped ${name} (${url}): ${reason}`)
    continue
  }
  const crs = crsOf(layer)
  const entry = { name, url, crs, bbox: bbox(layer.fullExtent, crs) }
  if (layer.layerType === '3DObject') {
    // The same field sits under a different key in nearly every layer: f_1 here, f_33 there.
    const fields = Object.fromEntries(
      (layer.attributeStorageInfo ?? []).filter((attribute) => BUILDING_FIELDS.includes(attribute.name)).map((attribute) => [attribute.name, attribute.key]),
    )
    buildings.push(Object.keys(fields).length ? { ...entry, fields } : entry)
  } else {
    // "height" in most neighbourhoods, "HEIGHT" in a few.
    const heightKey = layer.attributeStorageInfo?.find((attribute) => attribute.name.toLowerCase() === 'height')?.key
    trees.push(heightKey ? { ...entry, heightKey } : entry)
  }
}

mkdirSync(leafDir, { recursive: true })
for (const other of OTHERS) {
  const layer = await get(`${other.url}?f=json`)
  const reason = problem(layer)
  if (reason) throw new Error(`${other.name} (${other.url}): ${reason}`)
  const crs = crsOf(layer)
  const entry = { name: other.name, region: other.name, url: other.url, crs, bbox: bbox(layer.fullExtent, crs) }
  const { nodes, pages } = await allNodes(other.url)
  if (pages > MAX_PAGES_AT_RUNTIME) {
    const rows = leafRows(nodes, crs)
    const text = `[\n${rows.map((row) => JSON.stringify(row)).join(',\n')}\n]\n`
    writeFileSync(join(leafDir, `${other.slug}.json`), text)
    entry.leaves = `/data/city-leaves/${other.slug}.json`
    console.log(`${other.slug}.json: ${rows.length} leaves of ${nodes.length} nodes in ${pages} pages, ${text.length} bytes`)
  }
  // A misspelt name would quietly show nothing, so it stops the bake instead.
  const keyOf = Object.fromEntries((layer.attributeStorageInfo ?? []).map((attribute) => [attribute.name, attribute.key]))
  const fields = Object.entries(other.fields ?? {}).map(([field, names]) => {
    const missing = names.find((name) => !keyOf[name])
    if (missing) throw new Error(`${other.name}: no attribute ${missing}`)
    return [field, names.map((name) => keyOf[name]).join(' ')]
  })
  buildings.push(fields.length ? { ...entry, fields: Object.fromEntries(fields) } : entry)
}

const byName = (a, b) => a.name.localeCompare(b.name, 'lv')
const lines = (layers) => layers.sort(byName).map((layer) => JSON.stringify(layer)).join(',\n')
writeFileSync(outFile, `{"baked":"${today}","buildings":[\n${lines(buildings)}\n],"trees":[\n${lines(trees)}\n]}\n`)
console.log(`city-3d.json: ${buildings.length} building layers, ${trees.length} tree layers`)
