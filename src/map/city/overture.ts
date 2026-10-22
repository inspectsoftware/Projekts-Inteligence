/**
 * Overture Maps' buildings, the whole world's: footprints from OpenStreetMap and others, with
 * heights, colours and the shape of each roof (https://docs.overturemaps.org/). Overture publishes
 * them as one PMTiles archive per release and takes each release down after 60 days, so the
 * archive's address is looked up in its catalogue rather than written here.
 */
import { VectorTile, classifyRings } from '@mapbox/vector-tile'
import { PbfReader } from 'pbf'
import { metreScale, parseColour } from './mesh'
import { PmTiles } from './pmtiles'
import { flatRoof, pitchedRoof, ringShape, roofFrame, wallTop } from './roofs'
import type { ExtrudedTile } from './types'

const CATALOGUE = 'https://stac.overturemaps.org/'

/** A storey, where only the number of them is mapped. */
const STOREY = 3

/** A building with neither its height nor its storeys mapped. */
const DEFAULT_HEIGHT = 5

/** A pitched roof's height where none is mapped: 35 degrees up from the eaves. */
const PITCH = Math.tan((35 * Math.PI) / 180)

function latitudeOf(y: number): number {
  return (360 / Math.PI) * Math.atan(Math.exp(((180 - y * 360) * Math.PI) / 180)) - 90
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return res.json()
}

let release: Promise<string> | null = null

/**
 * The address of the current buildings archive: the catalogue names its latest release, and the
 * release's buildings catalogue links the archive. Looked up once, until a tile fails (see
 * overtureTile); a failure is not kept, so the next tile asks again. Not cancelled with any one
 * tile, as every tile waits on it.
 */
export function resolveOverture(): Promise<string> {
  if (!release) {
    release = (async () => {
      const latest = ((await fetchJson(`${CATALOGUE}catalog.json`)) as { latest?: unknown } | null)?.latest
      if (typeof latest !== 'string' || !/^[\w.-]+$/.test(latest)) throw new Error('Overture’s catalogue names no latest release')
      const catalog = `${CATALOGUE}${latest}/buildings/catalog.json`
      const links = ((await fetchJson(catalog)) as { links?: unknown } | null)?.links
      const href = Array.isArray(links) ? links.find((link) => link?.rel === 'pmtiles')?.href : undefined
      const url = typeof href === 'string' ? new URL(href, catalog) : null
      if (url?.protocol !== 'https:') throw new Error(`Overture’s ${latest} buildings catalogue links no archive`)
      return url.href
    })()
    release.catch(() => (release = null))
  }
  return release
}

let archive: PmTiles | null = null

/** The Overture buildings of one tile, extruded: what the city worker calls. A tile the archive lacks has none. */
export async function overtureTile(z: number, x: number, y: number, signal: AbortSignal): Promise<ExtrudedTile> {
  const url = await resolveOverture()
  if (archive?.url !== url) archive = new PmTiles(url)
  try {
    return extrudeOverture((await archive.getTile(z, x, y, signal)) ?? new Uint8Array(), z, x, y)
  } catch (error) {
    // A release is taken down after 60 days, and its archive fails every tile from then on: so
    // the release is forgotten, and the next tile looks the latest up again. A tile cancelled
    // says nothing about the archive.
    if (!signal.aborted) {
      release = null
      archive = null
    }
    throw error
  }
}

const numberOr = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined)

/**
 * Where a building starts, where its walls stop and where its roof does, in metres. Overture's
 * height is the top of the roof; where only storeys are mapped, they are the walls and the roof
 * comes on top. A roof's height not mapped is guessed from the building's width, at most half
 * the building.
 */
function heightsOf(properties: Record<string, unknown>, halfWidth: number, pitched: boolean): [number, number, number] {
  const base = numberOr(properties.min_height) ?? (numberOr(properties.min_floor) ?? 0) * STOREY
  const height = numberOr(properties.height)
  const floors = numberOr(properties.num_floors)
  const mapped = pitched ? numberOr(properties.roof_height) : 0
  const roof = (half: number) => Math.max(0, mapped ?? Math.min(halfWidth * PITCH, half))
  if (height === undefined && floors) {
    const walls = Math.max(base, floors * STOREY)
    return [base, walls, walls + roof(walls - base)]
  }
  const top = height ?? DEFAULT_HEIGHT
  return [base, top - Math.min(roof((top - base) / 2), top - base), top]
}

/**
 * The buildings of one Overture tile (the decompressed vector tile) as solids, on the same terms as
 * mesh.ts's extrudeTile: placed at the tile's north-west corner, one contiguous run of triangles
 * per polygon, roof first. Walls take the facade's colour and roofs the roof's, where mapped. A
 * building drawn in parts has its outline left out and its parts drawn instead, as OpenStreetMap's
 * Simple 3D Buildings has it.
 */
export function extrudeOverture(data: Uint8Array, z: number, x: number, y: number): ExtrudedTile {
  const origin: [number, number] = [x / 2 ** z, y / 2 ** z]
  const scale = metreScale(latitudeOf(origin[1]))
  const tile = new VectorTile(new PbfReader(data))
  const positions: number[] = []
  const colors: number[] = []
  const indices: number[] = []
  const polygons: number[] = []
  let colour = [0, 0, 0, 0]
  const vertex = (vx: number, vy: number, vz: number): number => {
    positions.push(vx, vy, vz)
    colors.push(colour[0], colour[1], colour[2], colour[3])
    return positions.length / 3 - 1
  }

  for (const layer of [tile.layers.building, tile.layers.building_part]) {
    const extent = layer?.extent ?? 4096
    // Mercator runs straight across a tile, so tile units become metres by one factor. The tile's
    // y grows south, the local y north.
    const metres = 1 / (extent * 2 ** z * scale)
    // Where the tile's buffer cut a building, the cut is not a wall: MapLibre's isBoundaryEdge.
    const cut = (a: { x: number; y: number }, b: { x: number; y: number }) => (a.x === b.x && (a.x < 0 || a.x > extent)) || (a.y === b.y && (a.y < 0 || a.y > extent))
    for (let f = 0; f < (layer?.length ?? 0); f++) {
      const feature = layer.feature(f)
      const properties = feature.properties
      if (properties.has_parts === true || properties.is_underground === true || feature.type !== 3) continue
      const shape = typeof properties.roof_shape === 'string' && properties.roof_shape !== 'flat' ? properties.roof_shape : null
      const roofRgb = parseColour(properties.roof_color)
      const wallRgb = parseColour(properties.facade_color)
      for (const polygon of classifyRings(feature.loadGeometry())) {
        // Rings arrive closed, their first point repeated at the end.
        const rings = polygon.map((ring) => (ring.length > 1 && ring[0].equals(ring[ring.length - 1]) ? ring.slice(0, -1) : ring))
        const outer = rings[0]
        // A building wholly in the tile's buffer is drawn whole by the tile next door, as MapLibre does.
        if (outer.length < 3 || outer.every((p) => p.x < 0) || outer.every((p) => p.x > extent) || outer.every((p) => p.y < 0) || outer.every((p) => p.y > extent)) continue
        const flat: number[] = []
        const holes: number[] = []
        for (const ring of rings) {
          if (ring !== outer) holes.push(flat.length / 2)
          for (const p of ring) flat.push(p.x * metres, -p.y * metres)
        }
        const [area, centreX, centreY] = ringShape(flat, 0, outer.length)
        if (Math.abs(area) < 1) continue

        // A roof is shaped only over an outline wholly in the tile. One across the tile's edge comes in
        // every tile it crosses, cut by each one's buffer in a different place, so it would get a
        // different roof in each and a step where they meet; flat, it is the same in all of them,
        // each drawn only over its own tile.
        const outline = flat.slice(0, 2 * outer.length)
        const whole = rings.length === 1 && outer.every((p) => p.x >= 0 && p.x <= extent && p.y >= 0 && p.y <= extent)
        const frame = shape && whole ? roofFrame(outline, properties.roof_orientation, properties.roof_direction) : null
        const [base, walls, top] = heightsOf(properties, frame?.halfWidth ?? 0, shape !== null)
        if (!(top > base)) continue
        // A roof that cannot be shaped is drawn flat halfway up it, keeping about the building's bulk.
        const roof = (frame && shape && pitchedRoof(outline, frame, shape, walls, top - walls)) || flatRoof(flat, holes, (walls + top) / 2)
        // Unmapped, the theme colours a building by its height.
        const theme = [Math.min(255, Math.round(top)), 0, 0, 0]

        const firstVertex = positions.length / 3
        const firstIndex = indices.length
        colour = roofRgb ? [...roofRgb, 255] : theme
        for (let i = 0; i < roof.positions.length; i += 3) vertex(roof.positions[i], roof.positions[i + 1], roof.positions[i + 2])
        for (const t of roof.triangles) indices.push(firstVertex + t)

        // Walls get corners of their own, apart from the roof's, so each face can be shaded flat.
        colour = wallRgb ? [...wallRgb, 255] : theme
        let start = 0
        for (let r = 0; r < rings.length; r++) {
          const ring = rings[r]
          const end = start + ring.length
          // Faces turned outwards: away from the building round its outline, into the courtyard round a hole.
          const turn = ringShape(flat, start, end)[0] > 0 === (r === 0)
          for (let k = 0; k < ring.length; k++) {
            if (cut(ring[k], ring[(k + 1) % ring.length])) continue
            const [ax, ay] = [flat[2 * (start + k)], flat[2 * (start + k) + 1]]
            const [bx, by] = [flat[2 * (start + ((k + 1) % ring.length))], flat[2 * (start + ((k + 1) % ring.length)) + 1]]
            // The wall's outline: its foot from a to b, then its top back from b to a, bending under the roof.
            const tops = wallTop(roof.planes, ax, ay, bx, by)
            const v = vertex(ax, ay, base)
            vertex(bx, by, base)
            for (let s = tops.length - 2; s >= 0; s -= 2) vertex(ax + tops[s] * (bx - ax), ay + tops[s] * (by - ay), tops[s + 1])
            // That outline is convex, so a fan from its first corner fills it.
            for (let c = v + 1; c < positions.length / 3 - 1; c++) indices.push(v, turn ? c : c + 1, turn ? c + 1 : c)
          }
          start = end
        }
        polygons.push(firstIndex, indices.length - firstIndex, centreX, centreY, firstVertex, positions.length / 3 - firstVertex)
      }
    }
  }
  return {
    kind: 'extruded',
    origin,
    scale,
    positions: new Float32Array(positions),
    colors: new Uint8Array(colors),
    indices: new Uint32Array(indices),
    polygons: new Float32Array(polygons),
  }
}
