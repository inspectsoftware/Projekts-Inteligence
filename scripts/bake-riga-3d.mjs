// Manual, now and then: builds public/data/riga-3d.json, the catalogue of Rīga's city model, from
// GEO RĪGA's web scene "3D_RIGA_LOD2" on ArcGIS Online. For every neighbourhood it lists the I3S
// scene layer of its buildings (LOD2, from airborne laser scanning) and, where there is one, of
// its trees: where the layer is, its coordinate system and its extent. The browser fetches the
// geometry itself, straight from the city's scene services. Never runs as part of `npm run build`;
// the result is committed. Run it again when the city adds or replaces a neighbourhood.
// Data: Rīgas valstspilsētas pašvaldība (GEO RĪGA), CC BY 4.0.
//
//   node scripts/bake-riga-3d.mjs
import { writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outFile = join(root, 'public/data/riga-3d.json')
const USER_AGENT = 'ProjektsInteligence/0.1 (non-commercial Latvia OSINT dashboard; one-off data bake)'
const WEB_SCENE = 'https://www.arcgis.com/sharing/rest/content/items/e2a5e2ee33d645ea81dcd22c659d2996/data?f=json'
const today = new Date().toISOString().slice(0, 10)

/** The one vertex layout the city worker reads: I3S's default geometry buffer, uncompressed. */
const LAYOUT = { position: 'Float32x3', normal: 'Float32x3', uv0: 'Float32x2', color: 'UInt8x4', featureId: 'UInt64x1', faceRange: 'UInt32x2' }

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

/** [west, south, east, north] in degrees, rounded outward to 5 decimals (about a metre) so the box still holds the whole layer. */
function bbox({ xmin, ymin, xmax, ymax }, crs) {
  const degrees = (x, y) => (crs === 3857 ? [(x / 6378137) * (180 / Math.PI), (2 * Math.atan(Math.exp(y / 6378137)) - Math.PI / 2) * (180 / Math.PI)] : [x, y])
  const [west, south] = degrees(xmin, ymin)
  const [east, north] = degrees(xmax, ymax)
  return [Math.floor(west * 1e5) / 1e5, Math.floor(south * 1e5) / 1e5, Math.ceil(east * 1e5) / 1e5, Math.ceil(north * 1e5) / 1e5]
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

const byName = (a, b) => a.name.localeCompare(b.name, 'lv')
const lines = (layers) => layers.sort(byName).map((layer) => JSON.stringify(layer)).join(',\n')
writeFileSync(outFile, `{"baked":"${today}","buildings":[\n${lines(buildings)}\n],"trees":[\n${lines(trees)}\n]}\n`)
console.log(`riga-3d.json: ${buildings.length} building layers, ${trees.length} tree layers`)
