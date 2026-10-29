/**
 * Fetches and builds the city's geometry off the main thread: a vector tile's buildings
 * extruded, a node of Rīga's city model decoded, or a node's trees; and, for Sat 3D, the air
 * photo of one tile, or a node of Rīga photographed in 3D with its photo. Only finished arrays and
 * pictures come back, handed over rather than copied.
 */
import { groundUnder } from './dem'
import { decodeMeshNode, decodeModelNode, decodeTrees, extrudeTile } from './mesh'
import { overtureTile } from './overture'
import { photoTile } from './photoTiles'
import type { ChunkMesh, CityJob, CityResult } from './types'

const scope = self as unknown as DedicatedWorkerGlobalScope
const running = new Map<string, AbortController>()

async function fetchOk(url: string, signal: AbortSignal): Promise<Response> {
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return res
}

async function build(job: Exclude<CityJob, { kind: 'cancel' | 'photo' }>, signal: AbortSignal): Promise<ChunkMesh> {
  switch (job.kind) {
    case 'extruded':
      return extrudeTile(await (await fetchOk(job.url, signal)).arrayBuffer(), job.z, job.x, job.y)
    case 'model': {
      // The terrain under the node is read alongside it, so each building can stand on the street.
      const [data, ground] = await Promise.all([fetchOk(job.url, signal).then((res) => res.arrayBuffer()), groundUnder(job.obb, job.crs)])
      return decodeModelNode(data, job.obb, job.crs, ground)
    }
    case 'overture':
      return overtureTile(job.z, job.x, job.y, signal)
    case 'trees': {
      const [features, heights] = await Promise.all([
        fetchOk(job.featuresUrl, signal).then((res) => res.json()),
        // A tree with no height of its own is drawn at a usual one, so a missing list is no failure.
        job.heightsUrl ? fetchOk(job.heightsUrl, signal).then((res) => res.arrayBuffer(), () => null) : null,
      ])
      return decodeTrees(features, heights, job.crs)
    }
    case 'mesh': {
      // The photo is on its way while the geometry and the terrain under it are read. It is decoded
      // last, so a node that fails leaves no picture behind.
      const photo = fetchOk(job.photoUrl, signal).then((res) => res.blob())
      photo.catch(() => {})
      const [data, ground] = await Promise.all([fetchOk(job.geometryUrl, signal).then((res) => res.arrayBuffer()), groundUnder(job.obb, 3857)])
      // Without the terrain the mesh would stand metres off the map: it is asked for again later,
      // and what stood there before goes on standing meanwhile.
      if (!ground) throw new Error('no terrain to set the mesh down on')
      const piece = decodeMeshNode(data, job.obb, ground, job.attributes, job.cuts)
      return { ...piece, photo: await photoOf(await photo, job.maxPhoto) }
    }
  }
}

/** A node's photo, decoded here rather than on the page, and no wider or taller than `max`. */
async function photoOf(blob: Blob, max: number): Promise<ImageBitmap> {
  const full = await createImageBitmap(blob)
  const shrink = max / Math.max(full.width, full.height)
  if (shrink >= 1) return full
  const small = await createImageBitmap(full, { resizeWidth: Math.max(1, Math.round(full.width * shrink)), resizeHeight: Math.max(1, Math.round(full.height * shrink)), resizeQuality: 'high' })
  full.close()
  return small
}

function buffersOf(mesh: ChunkMesh): Transferable[] {
  switch (mesh.kind) {
    case 'extruded':
      return [mesh.positions.buffer, mesh.colors.buffer, mesh.indices.buffer, mesh.polygons.buffer] as ArrayBuffer[]
    case 'model':
      return [mesh.positions.buffer, mesh.buildings.buffer] as ArrayBuffer[]
    case 'trees':
      return [mesh.trees.buffer] as ArrayBuffer[]
    case 'mesh':
      return [mesh.positions.buffer, mesh.uvs.buffer, mesh.grounds.buffer, mesh.cover.buffer, mesh.photo] as Transferable[]
  }
}

scope.onmessage = async ({ data: job }: MessageEvent<CityJob>) => {
  if (job.kind === 'cancel') {
    running.get(job.id)?.abort()
    running.delete(job.id)
    return
  }
  const abort = new AbortController()
  running.set(job.id, abort)
  try {
    if (job.kind === 'photo') {
      const photo = await photoTile(job.z, job.x, job.y, abort.signal)
      if (abort.signal.aborted) photo?.close()
      else scope.postMessage({ id: job.id, photo } satisfies CityResult, photo ? [photo] : [])
      return
    }
    const mesh = await build(job, abort.signal)
    if (abort.signal.aborted) {
      if (mesh.kind === 'mesh') mesh.photo.close()
      return
    }
    scope.postMessage({ id: job.id, mesh } satisfies CityResult, buffersOf(mesh))
  } catch (err) {
    // A cancelled job was forgotten by the page already; anything else is reported so it can try again later.
    if (!abort.signal.aborted) scope.postMessage({ id: job.id, error: err instanceof Error ? err.message : String(err) } satisfies CityResult)
  } finally {
    // The same piece may have been cancelled and asked for again meanwhile: leave the new request be.
    if (running.get(job.id) === abort) running.delete(job.id)
  }
}
