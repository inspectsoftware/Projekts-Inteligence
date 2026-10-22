/**
 * The air photo for one tile, as the city worker fetches it for the roofs of Sat 3D. The same
 * services as the satellite view, through the same loaders, so Latvia's photo is cut to the
 * border and Estonia's navy edge is taken out here too. Runs in the worker: nothing here may pull
 * in the map's own modules, which bring the page's translations with them.
 */
import type { FeatureCollection, MultiPolygon, Polygon } from 'geojson'
import { TILE_ORIGINS } from '../../../shared/origins'
import { LATVIA_BBOX } from '../../../shared/region'
import { CLIP_SCHEME, TRIM_SCHEME, loadEstoniaTile, loadLatviaTile, setClipBorder } from '../orthoClip'
import { WORLD_ORTHOS, WORLD_SCHEME, loadWorldOrthoTile } from '../worldOrtho'

/** Estonia's service lists level 18, but central Tallinn comes back empty there; 17 is its sharpest. */
const ESTONIA: { bounds: [number, number, number, number]; maxzoom: number } = { bounds: [21.5, 57.45, 28.3, 59.9], maxzoom: 17 }
/** The 10 m mosaic shows nothing finer than this, and only colours a far roof. */
const MOSAIC_MAXZOOM = 15

let border: Promise<void> | null = null

/** Latvia's outline, which the clip needs before its first tile. Asked for again after a failure. */
function loadBorder(): Promise<void> {
  border ??= fetch('/data/lv-border.json')
    .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
    .then((outline: FeatureCollection<Polygon | MultiPolygon>) => setClipBorder(outline))
    .catch((err) => {
      border = null
      throw err
    })
  return border
}

function within([west, south, east, north]: readonly number[], lon: number, lat: number): boolean {
  return lon >= west && lon <= east && lat >= south && lat <= north
}

/** Whatever a loader answered, as a picture, or null for its ways of saying "nothing here". */
async function picture(data: unknown): Promise<ImageBitmap | null> {
  let found: ImageBitmap
  if (data instanceof ImageBitmap) found = data
  else if (data instanceof ArrayBuffer && data.byteLength >= 100) found = await createImageBitmap(new Blob([data]))
  else return null
  if (found.width === 256 && found.height === 256) return found
  // Every slot of the texture is 256 pixels a side; a service that answers larger is scaled to it.
  const resized = await createImageBitmap(found, { resizeWidth: 256, resizeHeight: 256, resizeQuality: 'high' })
  found.close()
  return resized
}

/**
 * The photo of tile z/x/y from the sharpest service that has one there, or null where none does,
 * so the next coarser level shows through. A service that fails is skipped for the next one; if
 * none answered and one failed, the failure is passed on, so the tile is tried again later.
 */
export async function photoTile(z: number, x: number, y: number, signal: AbortSignal): Promise<ImageBitmap | null> {
  const n = 2 ** z
  const lon = ((x + 0.5) / n) * 360 - 180
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 0.5)) / n))) * 180) / Math.PI
  const abort = { signal } as AbortController
  const tries: (() => Promise<unknown>)[] = []
  const latvia = within(LATVIA_BBOX, lon, lat)
  if (latvia) {
    tries.push(async () => {
      await loadBorder()
      return (await loadLatviaTile({ url: `${CLIP_SCHEME}://${z}/${x}/${y}` }, abort)).data
    })
  }
  if (z <= ESTONIA.maxzoom && within(ESTONIA.bounds, lon, lat)) tries.push(async () => (await loadEstoniaTile({ url: `${TRIM_SCHEME}://${z}/${x}/${y}` }, abort)).data)
  // Later ones lie on top where two meet, as in the satellite view.
  for (const ortho of [...WORLD_ORTHOS].reverse()) {
    if (z <= ortho.maxzoom && within(ortho.bounds, lon, lat)) tries.push(async () => (await loadWorldOrthoTile({ url: `${WORLD_SCHEME}://${ortho.id}/${z}/${x}/${y}` }, abort)).data)
  }
  if (z <= MOSAIC_MAXZOOM) {
    tries.push(async () => {
      const res = await fetch(`${TILE_ORIGINS.eox}/wmts/1.0.0/s2cloudless-2025_3857/default/g/${z}/${y}/${x}.jpg`, { signal })
      return res.ok ? res.arrayBuffer() : null
    })
  }
  // Latvia's photo of a tile on its border is cut there and transparent beyond: whatever photo the
  // next service has goes under it.
  let edge: ImageBitmap | null = null
  let failure: unknown = null
  for (const [index, attempt] of tries.entries()) {
    if (signal.aborted) break
    try {
      const data = await attempt()
      const found = await picture(data)
      if (!found) continue
      if (index === 0 && latvia && data instanceof ImageBitmap) {
        edge = found
        continue
      }
      return edge ? layered(found, edge) : found
    } catch (err) {
      if (signal.aborted) break
      failure = err
      console.warn('[city] photo tile failed, trying the next service:', err)
    }
  }
  if (signal.aborted) {
    edge?.close()
    return null
  }
  if (edge) return edge
  // A service that failed may only be having a bad moment: said so, and the tile is asked for again later.
  if (failure) throw failure
  return null
}

/** One picture over another, both let go of. */
function layered(under: ImageBitmap, over: ImageBitmap): ImageBitmap {
  const canvas = new OffscreenCanvas(256, 256)
  const g = canvas.getContext('2d')!
  g.drawImage(under, 0, 0)
  g.drawImage(over, 0, 0)
  under.close()
  over.close()
  return canvas.transferToImageBitmap()
}
