/**
 * Fetches and builds the city's geometry off the main thread: a vector tile's buildings
 * extruded, a node of Rīga's city model decoded, or a node's trees; and, for Sat 3D, the air
 * photo of one tile. Only finished arrays and pictures come back, handed over rather than copied.
 */
import { groundUnder } from './dem'
import { decodeModelNode, decodeTrees, extrudeTile } from './mesh'
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
  }
}

function buffersOf(mesh: ChunkMesh): ArrayBuffer[] {
  switch (mesh.kind) {
    case 'extruded':
      return [mesh.positions.buffer, mesh.colors.buffer, mesh.indices.buffer, mesh.polygons.buffer] as ArrayBuffer[]
    case 'model':
      return [mesh.positions.buffer, mesh.buildings.buffer] as ArrayBuffer[]
    case 'trees':
      return [mesh.trees.buffer] as ArrayBuffer[]
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
    if (abort.signal.aborted) return
    scope.postMessage({ id: job.id, mesh } satisfies CityResult, buffersOf(mesh))
  } catch (err) {
    // A cancelled job was forgotten by the page already; anything else is reported so it can try again later.
    if (!abort.signal.aborted) scope.postMessage({ id: job.id, error: err instanceof Error ? err.message : String(err) } satisfies CityResult)
  } finally {
    // The same piece may have been cancelled and asked for again meanwhile: leave the new request be.
    if (running.get(job.id) === abort) running.delete(job.id)
  }
}
