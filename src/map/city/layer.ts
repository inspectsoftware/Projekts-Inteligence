import { type CustomLayerInterface, type CustomRenderMethodInput, type Map as MapLibreMap, type MapSourceDataEvent, MercatorCoordinate, type VectorTileSource } from 'maplibre-gl'
import { EXAGGERATION } from '../relief'
import type { MapTheme } from '../style'
import { PHOTO_LEVELS, PhotoCache } from './photo'
import { MESH_COVER } from './mesh'
import { BUILDING_FRAGMENT, BUILDING_VERTEX, MESH_FRAGMENT, MESH_VERTEX, TREE_FRAGMENT, TREE_VERTEX } from './shaders'
import { CityModel, type Leaf, type MeshNode, type MeshPick, type MeshTree, type MeshView, TILE_ZOOM, cameraDistanceMetres, cameraGround, offsetMetres, selectMesh, shrunkTexels, visibleTiles } from './sources'
import type { ChunkMesh, CityJob, CityResult, MeshPiece, ModelNode } from './types'
import CityWorker from './worker?worker'

/**
 * The 3D city, drawn by the map itself so it shares the depth of everything else in 3D.
 *
 * Where a city or country publishes its own laser-scanned model (Rīga, all of Estonia, Hamburg,
 * Berlin, Zürich; see public/data/city-3d.json), every building near the camera is that model,
 * with its real roofs, and in Rīga the city's trees stand beside them. Elsewhere near the camera
 * the buildings are Overture's, with the roof shapes and colours mapped for them; further out,
 * they are extruded from the vector tiles. All of it per building: where a building of a model is
 * drawn, the extruded block that stood in for it is left out, and until the model has arrived the
 * block holds its place. In Sat 3D the roofs are the air photo (photo.ts), and where Rīga is
 * photographed in 3D (LĢIA's textured surface of the whole city, and the city's own, sharper one
 * of its centre over it) that mesh stands in place of all of it, piece by piece as the pieces arrive.
 *
 * Keeps the id of the layer it replaces, so base and relief changes reach it as they did.
 */
export const CITY_LAYER = 'building-3d'

/** Below this the tiles carry no heights, and the blocks grow out of the ground up to the next level. */
const MIN_ZOOM = TILE_ZOOM
/** From here the city model takes over near the camera. */
const MODEL_ZOOM = 15
/**
 * From here, near the camera, the blocks come from Overture's buildings instead, which carry the
 * mapped roof shapes, colours and building parts; the tiles' own blocks stand in until they arrive.
 */
const OVERTURE_ZOOM = 15
const OVERTURE_REACH = 2500
const TREE_ZOOM = 15.5

const coarse = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches
/** What a phone's graphics can hold comfortably, and a desktop's: the city model runs to thousands of vertices a building. */
const MODEL_BUDGET = coarse ? 1_200_000 : 3_500_000
const TREE_BUDGET = coarse ? 12_000 : 40_000
const TILE_LIMIT = coarse ? 40 : 80
/** Pieces kept ready, but not drawn, for when the camera comes back. */
const SPARE_TILES = 60
const SPARE_MODEL = MODEL_BUDGET
const SPARE_TREES = TREE_BUDGET
/**
 * Requests at once, per kind: the blocks are placeholders, so they never hold up the model. The
 * mesh's host speaks HTTP/2, and its small pieces wait mostly on the round trip; a phone keeps
 * fewer full-size photos in hand at once.
 */
const IN_FLIGHT: Record<Exclude<CityJob['kind'], 'cancel' | 'photo'>, number> = { extruded: 3, overture: 3, model: 4, trees: 2, mesh: coarse ? 6 : 12 }

/** Sat 3D, Rīga photographed: bytes on the graphics card at once, and kept besides for when the camera comes back. The photos are most of it. */
const MESH_BUDGET = (coarse ? 96 : 384) * 2 ** 20
const SPARE_MESH = (coarse ? 32 : 128) * 2 ** 20
/**
 * A node's photo is shrunk to this many pixels a side: at full size a street-level view would take
 * about 830 MiB. ponytail: one cap for every node; fetch the nearest leaves again at full size if
 * 1024 looks soft.
 */
const MESH_PHOTO = coarse ? 512 : 1024
/** A phone moves on to finer nodes only once they look twice as large. */
const MESH_DETAIL = coarse ? 0.5 : 1
/** With the relief on, the terrain is drawn into the same depth from the same ground the mesh stands on: the mesh stands this far clear of it, metres. */
const MESH_CLEARANCE = 1
/** How far past the screen's edges a node still counts as in view, so that a turn of the camera finds it there. */
const MESH_MARGIN = 1.3
/** The least detail the budget may push the mesh down to, as a share of the full. */
const MESH_LEAST_DETAIL = 0.3
/**
 * A piece of LĢIA's drawn beside one of the city's own is moved back along the line of sight, so
 * the city's wins where both show the same ground, and neither moves on the screen. Their streets
 * agree to half a metre: it goes back as far as lowers it MESH_DROP, more than that and less than
 * MESH_CLEARANCE, so it never sinks into the relief's own ground; and never further than MESH_PUSH,
 * metres, where a low line of sight would take it far back past what stands behind it.
 */
const MESH_PUSH = 3
const MESH_DROP = 0.75
/** Points tried along each side of a node's box to tell whether a closer mesh covers all of it. */
const MESH_PROBES = 4

/**
 * What a mesh piece will take on the graphics card, from what its node says before it comes: 24
 * bytes a vertex, and its photo once shrunk to MESH_PHOTO a side, with a third more for the smaller
 * copies. The photos are powers of two, square or twice as wide as high.
 */
function meshSize({ vertices, texels }: NonNullable<MeshNode['content']>): number {
  return vertices * 24 + (shrunkTexels(texels, MESH_PHOTO) * 16) / 3
}

/** How far around where the camera looks the city model is drawn: wider when seen from higher up. */
function modelReach(zoom: number): number {
  return zoom >= 19 ? 650 : 650 + ((19 - Math.max(zoom, MODEL_ZOOM)) / 4) * 950
}

interface Look {
  low: string
  high: string
  roof: string
  tagMix: number
  glass: number
  glow: number
  ambient: number
  diffuse: number
  leaf: string
  bark: string
  /** What far buildings fade into: the colour of the land, so they sink into the ground, not into a wall of haze. */
  fog: string
}

const LOOKS: Record<MapTheme | 'photo', Look> = {
  dark: {
    low: '#1b2633',
    high: '#34495c',
    roof: '#263646',
    tagMix: 0.25,
    glass: 0.72,
    glow: 0.22,
    ambient: 0.74,
    diffuse: 0.46,
    leaf: '#1b332d',
    bark: '#2a2520',
    fog: '#0e151c',
  },
  light: {
    low: '#d9d4cb',
    high: '#b3ab9f',
    roof: '#c7b3a1',
    tagMix: 0.6,
    glass: 0.84,
    glow: 0,
    ambient: 0.74,
    diffuse: 0.42,
    leaf: '#88ad80',
    bark: '#7f6b57',
    fog: '#eef1ec',
  },
  // Sat 3D: roofs come from the air photo; walls are a plain plaster tone, tinted by the photo round them.
  photo: {
    low: '#8b867d',
    high: '#a49e94',
    roof: '#6e6962',
    tagMix: 0.35,
    glass: 0.86,
    glow: 0,
    ambient: 0.66,
    diffuse: 0.5,
    leaf: '#2c4632',
    bark: '#3d352c',
    fog: '#39434a',
  },
}

/** Towards the sun: from the south-south-west, 35° up, fixed to the ground so the light does not swing as the map turns. */
const SUN = (() => {
  const azimuth = 210 * (Math.PI / 180)
  const elevation = 35 * (Math.PI / 180)
  return [Math.sin(azimuth) * Math.cos(elevation), Math.cos(azimuth) * Math.cos(elevation), Math.sin(elevation)]
})()

function rgb(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16)
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255]
}

/** A one-metre tree: a three-sided trunk and a seven-sided crown, x, y, z and whether it is crown. */
const UNIT_TREE = (() => {
  const out: number[] = []
  const ring = (sides: number, radius: number, z: number) =>
    Array.from({ length: sides }, (_, i) => [Math.cos((i / sides) * 2 * Math.PI) * radius, Math.sin((i / sides) * 2 * Math.PI) * radius, z])
  const tri = (a: number[], b: number[], c: number[], crown: number) => out.push(...a, crown, ...b, crown, ...c, crown)
  const trunkLow = ring(3, 0.035, 0)
  const trunkHigh = ring(3, 0.03, 0.4)
  for (let i = 0; i < 3; i++) {
    const j = (i + 1) % 3
    tri(trunkLow[i], trunkLow[j], trunkHigh[j], 0)
    tri(trunkLow[i], trunkHigh[j], trunkHigh[i], 0)
  }
  const bottom = [0, 0, 0.3]
  const top = [0, 0, 1]
  const low = ring(7, 0.31, 0.5)
  const high = ring(7, 0.24, 0.78)
  for (let i = 0; i < 7; i++) {
    const j = (i + 1) % 7
    tri(bottom, low[j], low[i], 1)
    tri(low[i], low[j], high[j], 1)
    tri(low[i], high[j], high[i], 1)
    tri(high[i], high[j], top, 1)
  }
  return new Float32Array(out)
})()

type Kind = ChunkMesh['kind']

interface Chunk {
  key: string
  kind: Kind
  job: Exclude<CityJob, { kind: 'cancel' | 'photo' }>
  priority: number
  /** How much of a budget it takes: vertices for the model, trees for trees, 1 for a tile. */
  size: number
  /** Waiting for its turn, asked of a worker, on the graphics card, or failed (tried again after a minute). */
  state: 'queued' | 'loading' | 'ready' | 'failed'
  failedAt: number
  usedAt: number
  origin: [number, number]
  scale: number
  /** Local box: west, south, bottom, east, north, top, metres. */
  box: number[]
  vao: WebGLVertexArrayObject | null
  buffers: WebGLBuffer[]
  ground: WebGLBuffer | null
  groundDone: number
  /** Index count, vertex count or tree count. */
  count: number
  // Kept for leaving blocks out under the city model, and for lifting everything onto the relief.
  indices?: Uint32Array
  polygons?: Float32Array
  coverageDone: number
  hidesAny: boolean
  /** Its own number, to tell pieces apart briefly (MeshCover.piecesIn). */
  serial: number
  /** The mesh cover's version when it last looked, and the mesh pieces over its ground then. */
  meshSeen: number
  meshNear?: string
  /** Blocks only: which of its polygons are left out now, one flag each. */
  hidden?: Uint8Array
  buildings?: Float32Array
  trees?: Float32Array
  vertices: number
  /** A piece of the city model: the leaf it is, whose attributes say what each building is. */
  leaf?: Leaf
  /** A piece of the city model: the ground each building stands on, as last lifted. */
  grounds?: Float32Array
  /** A piece of the city model: its buildings the mesh does not show, as runs of vertices, first and count two by two. */
  runs?: number[]
  /** A piece of the mesh: its photo. */
  texture: WebGLTexture | null
  /** A piece of the mesh: where it has triangles (MeshPiece.cover). */
  cover?: Uint8Array
  /** A piece of the mesh: moved back along the line of sight, so the closer photographed one beside it wins where both are (MESH_PUSH). */
  push?: boolean
}

/** Where a click met a building of the city model: its leaf, its place among the leaf's features, and the point. */
export interface CityHit {
  leaf: Leaf
  feature: number
  lon: number
  lat: number
}

interface Program {
  program: WebGLProgram
  uniforms: Record<string, WebGLUniformLocation | null>
  attributes: Record<string, number>
}

function compile(gl: WebGL2RenderingContext, vertex: string, fragment: string, attributes: string[], uniforms: string[]): Program {
  const program = gl.createProgram()!
  for (const [type, source] of [
    [gl.VERTEX_SHADER, vertex],
    [gl.FRAGMENT_SHADER, fragment],
  ] as const) {
    const shader = gl.createShader(type)!
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(`[city] shader: ${gl.getShaderInfoLog(shader)}`)
    gl.attachShader(program, shader)
  }
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`[city] program: ${gl.getProgramInfoLog(program)}`)
  return {
    program,
    uniforms: Object.fromEntries(uniforms.map((name) => [name, gl.getUniformLocation(program, name)])),
    attributes: Object.fromEntries(attributes.map((name) => [name, gl.getAttribLocation(program, name)])),
  }
}

const SHARED_UNIFORMS = ['u_matrix', 'u_sun', 'u_fogColor', 'u_fog', 'u_opacity', 'u_ambient', 'u_diffuse']

/** column-major 4×4: a · b */
function multiply(a: ArrayLike<number>, b: ArrayLike<number>): Float64Array {
  const out = new Float64Array(16)
  for (let column = 0; column < 4; column++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0
      for (let k = 0; k < 4; k++) sum += a[k * 4 + row] * b[column * 4 + k]
      out[column * 4 + row] = sum
    }
  }
  return out
}

/** True when the box is wholly outside one side of the view, the view widened `margin` times. */
function outside(matrix: ArrayLike<number>, box: number[], heightScale: number, margin = 1): boolean {
  let left = 0
  let right = 0
  let below = 0
  let above = 0
  let behind = 0
  for (let i = 0; i < 8; i++) {
    const x = box[i & 1 ? 3 : 0]
    const y = box[i & 2 ? 4 : 1]
    const z = box[i & 4 ? 5 : 2] * heightScale
    const cx = matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12]
    const cy = matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13]
    const cw = matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15]
    if (cx < -margin * cw) left++
    if (cx > margin * cw) right++
    if (cy < -margin * cw) below++
    if (cy > margin * cw) above++
    if (cw <= 0) behind++
  }
  return left === 8 || right === 8 || below === 8 || above === 8 || behind === 8
}

/** A spatial index of the city model's buildings as drawn this moment, in Mercator units. */
class Coverage {
  private static readonly CELL = 1 / 2 ** 16
  private cells = new Map<string, number[]>()
  version = 0
  /** Mercator box all of it lies within, or null when nothing is covered. */
  bounds: [number, number, number, number] | null = null

  rebuild(chunks: Chunk[]): void {
    this.cells.clear()
    this.bounds = null
    this.version++
    for (const chunk of chunks) {
      const buildings = chunk.buildings!
      const [mx, my] = chunk.origin
      const s = chunk.scale
      for (let i = 0; i < buildings.length; i += 7) {
        const box: [number, number, number, number] = [mx + buildings[i + 2] * s, my - buildings[i + 5] * s, mx + buildings[i + 4] * s, my - buildings[i + 3] * s]
        const b: [number, number, number, number] | null = this.bounds
        this.bounds = b ? [Math.min(b[0], box[0]), Math.min(b[1], box[1]), Math.max(b[2], box[2]), Math.max(b[3], box[3])] : [...box]
        const c = Coverage.CELL
        for (let x = Math.floor(box[0] / c); x <= Math.floor(box[2] / c); x++) {
          for (let y = Math.floor(box[1] / c); y <= Math.floor(box[3] / c); y++) {
            const key = `${x},${y}`
            const list = this.cells.get(key)
            if (list) list.push(...box)
            else this.cells.set(key, [...box])
          }
        }
      }
    }
  }

  covers(x: number, y: number): boolean {
    const list = this.cells.get(`${Math.floor(x / Coverage.CELL)},${Math.floor(y / Coverage.CELL)}`)
    if (!list) return false
    for (let i = 0; i < list.length; i += 4) if (x >= list[i] && x <= list[i + 2] && y >= list[i + 1] && y <= list[i + 3]) return true
    return false
  }
}

/**
 * Where the mesh is drawn: its pieces, filed by squares of about 80 m in Rīga, each telling where
 * in its box it has triangles, so the city's other pieces give way to it exactly there. Its version
 * moves on whenever the pieces drawn change; each of the city's other pieces then looks through its
 * own again only if the pieces over its own ground changed (piecesIn).
 */
class MeshCover {
  private static readonly SIDE = 2 ** 18
  private cells = new Map<number, Chunk[]>()
  private keys = ''
  version = 0
  /** Mercator box all of it lies within, or null when nothing is covered. */
  bounds: [number, number, number, number] | null = null

  rebuild(pieces: Chunk[]): void {
    const keys = pieces.map((piece) => piece.key).join('|')
    if (keys === this.keys) return
    this.keys = keys
    const n = MeshCover.SIDE
    const cells = new Map<number, Chunk[]>()
    let bounds: [number, number, number, number] | null = null
    for (const piece of pieces) {
      const { origin, scale, box } = piece
      const [west, north, east, south] = [origin[0] + box[0] * scale, origin[1] - box[4] * scale, origin[0] + box[3] * scale, origin[1] - box[1] * scale]
      bounds = bounds ? [Math.min(bounds[0], west), Math.min(bounds[1], north), Math.max(bounds[2], east), Math.max(bounds[3], south)] : [west, north, east, south]
      for (let x = Math.floor(west * n); x <= Math.floor(east * n); x++) {
        for (let y = Math.floor(north * n); y <= Math.floor(south * n); y++) {
          const list = cells.get(x * n + y)
          if (list) list.push(piece)
          else cells.set(x * n + y, [piece])
        }
      }
    }
    this.cells = cells
    this.bounds = bounds
    this.version++
  }

  covers(x: number, y: number): boolean {
    return this.squareAt(x, y) > 0
  }

  /** The side of the cover's square at a Mercator point, in Mercator units, where a piece has triangles there; else 0. */
  private squareAt(x: number, y: number): number {
    for (const piece of this.cells.get(Math.floor(x * MeshCover.SIDE) * MeshCover.SIDE + Math.floor(y * MeshCover.SIDE)) ?? []) {
      if (photographed(piece, x, y)) return (Math.max(piece.box[3] - piece.box[0], piece.box[4] - piece.box[1]) * piece.scale) / MESH_COVER
    }
    return 0
  }

  /** Whether a piece's box meets a Mercator box (as outside() takes boxes). */
  meets(box: number[]): boolean {
    const n = MeshCover.SIDE
    for (let x = Math.floor(box[0] * n); x <= Math.floor(box[3] * n); x++) {
      for (let y = Math.floor(box[1] * n); y <= Math.floor(box[4] * n); y++) {
        for (const { origin, scale, box: b } of this.cells.get(x * n + y) ?? []) {
          if (origin[0] + b[3] * scale >= box[0] && origin[0] + b[0] * scale <= box[3] && origin[1] - b[1] * scale >= box[1] && origin[1] - b[4] * scale <= box[4]) return true
        }
      }
    }
    return false
  }

  /** The pieces filed in the squares a Mercator box reaches into, as one string to compare. */
  piecesIn(west: number, north: number, east: number, south: number): string {
    const n = MeshCover.SIDE
    const found = new Set<number>()
    for (let x = Math.floor(west * n); x <= Math.floor(east * n); x++) {
      for (let y = Math.floor(north * n); y <= Math.floor(south * n); y++) for (const piece of this.cells.get(x * n + y) ?? []) found.add(piece.serial)
    }
    return [...found].sort((a, b) => a - b).join()
  }

  /**
   * Whether it covers all of a Mercator box, as far as a few points spread over it can tell: each
   * well inside it, a square of its cover clear of its edge every way, or one `elsewhere` lets off.
   * A square is marked where any triangle reaches into it, so one at the very edge may be mostly bare.
   */
  coversAll(box: number[], elsewhere: (x: number, y: number) => boolean = () => false): boolean {
    for (let i = 0; i < MESH_PROBES; i++) {
      for (let j = 0; j < MESH_PROBES; j++) {
        const x = box[0] + ((i + 0.5) / MESH_PROBES) * (box[3] - box[0])
        const y = box[1] + ((j + 0.5) / MESH_PROBES) * (box[4] - box[1])
        if (elsewhere(x, y)) continue
        const side = this.squareAt(x, y)
        if (!side || !this.squareAt(x - side, y) || !this.squareAt(x + side, y) || !this.squareAt(x, y - side) || !this.squareAt(x, y + side)) return false
      }
    }
    return true
  }
}

/** Whether a mesh piece has triangles at a Mercator point: inside its box, in a square of its cover a triangle reaches. */
function photographed(piece: Chunk, x: number, y: number): boolean {
  const b = piece.box
  const east = (x - piece.origin[0]) / piece.scale
  const north = (piece.origin[1] - y) / piece.scale
  if (!(east >= b[0] && east <= b[3] && north >= b[1] && north <= b[4])) return false
  if (!piece.cover) return true
  const square = (value: number, low: number, high: number) => Math.min(MESH_COVER - 1, Math.max(0, Math.floor(((value - low) / (high - low)) * MESH_COVER)))
  return piece.cover[square(north, b[1], b[4]) * MESH_COVER + square(east, b[0], b[3])] === 1
}

/** Whether a piece's box reaches into a Mercator box. */
function reaches(chunk: Chunk, bounds: [number, number, number, number] | null): boolean {
  const [mx, my] = chunk.origin
  const s = chunk.scale
  const b = chunk.box
  return !!bounds && b.length > 0 && mx + b[3] * s >= bounds[0] && mx + b[0] * s <= bounds[2] && my - b[1] * s >= bounds[1] && my - b[4] * s <= bounds[3]
}

class CityLayer implements CustomLayerInterface {
  readonly id = CITY_LAYER
  readonly type = 'custom'
  readonly renderingMode = '3d'

  private map: MapLibreMap | null = null
  private gl: WebGL2RenderingContext | null = null
  private buildingProgram: Program | null = null
  private treeProgram: Program | null = null
  private meshProgram: Program | null = null
  private anisotropy: { ext: EXT_texture_filter_anisotropic; max: number } | null = null
  private unitTree: WebGLBuffer | null = null
  private workers: Worker[] = []
  private chunks = new Map<string, Chunk>()
  private drawn: Chunk[] = []
  private model = new CityModel(() => this.schedule())
  private coverage = new Coverage()
  private meshCover = new MeshCover()
  /** Where the city's own, closer photographed blocks are drawn: LĢIA's pieces they cover give way. */
  private closeCover = new MeshCover()
  /** The same for a trial of more detail. */
  private trialCover = new MeshCover()
  /** Mesh pieces back from the workers, waiting to be handed to the graphics card while drawing. */
  private arrived: { chunk: Chunk; mesh: MeshPiece }[] = []
  /** The camera as last drawn, for picking the mesh's nodes. */
  private view: MeshView | null = null
  /** How much of the mesh's full detail is asked for: less while what the view asks for does not fit the budget. */
  private meshDetail = 1
  private serials = 0
  private drawnModelKeys = ''
  private tileUrl: string | null = null
  private theme: MapTheme = 'dark'
  private look: Look = LOOKS.dark
  private opacity = 1
  /** The air photos on the roofs, while Sat 3D is the base. */
  private photo: PhotoCache | null = null
  private terrainVersion = 0
  private updateTimer = 0
  private lastUpdate = 0
  private terrainTimer = 0
  private liftsLeft = 0
  /** From Mercator to clip space, as last drawn: what a click on the canvas is traced back through. */
  private matrix: number[] | null = null
  private listeners: ['move' | 'moveend' | 'resize' | 'terrain', () => void][] = []
  private sourceListener: ((event: MapSourceDataEvent) => void) | null = null

  onAdd(map: MapLibreMap, gl: WebGL2RenderingContext): void {
    this.map = map
    this.gl = gl
    this.buildingProgram = compile(gl, BUILDING_VERTEX, BUILDING_FRAGMENT, ['a_pos', 'a_color', 'a_ground'], [
      ...SHARED_UNIFORMS,
      'u_heightScale',
      'u_low',
      'u_high',
      'u_roof',
      'u_tagMix',
      'u_glass',
      'u_glow',
      'u_clip',
      'u_photoTex',
      'u_photo',
      'u_photoTiles',
      'u_photoSize',
      'u_photoOn',
    ])
    this.treeProgram = compile(gl, TREE_VERTEX, TREE_FRAGMENT, ['a_shape', 'a_tree', 'a_ground'], [...SHARED_UNIFORMS, 'u_leaf', 'u_bark'])
    this.meshProgram = compile(gl, MESH_VERTEX, MESH_FRAGMENT, ['a_pos', 'a_uv', 'a_ground'], [...SHARED_UNIFORMS, 'u_relief', 'u_photo', 'u_eye', 'u_push'])
    const anisotropy = gl.getExtension('EXT_texture_filter_anisotropic')
    if (anisotropy) this.anisotropy = { ext: anisotropy, max: Math.min(8, gl.getParameter(anisotropy.MAX_TEXTURE_MAX_ANISOTROPY_EXT) as number) }
    this.unitTree = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, this.unitTree)
    gl.bufferData(gl.ARRAY_BUFFER, UNIT_TREE, gl.STATIC_DRAW)
    // Two workers: an old-town tile takes tens of milliseconds to extrude, and one should not hold up the next.
    this.workers = [0, 1].map(() => {
      const worker = new CityWorker()
      worker.onmessage = ({ data }: MessageEvent<CityResult>) => this.receive(data)
      return worker
    })
    const move = () => this.schedule()
    const terrain = () => this.refreshTerrain()
    this.listeners = [
      ['move', move],
      ['moveend', move],
      ['resize', move],
      ['terrain', terrain],
    ]
    for (const [type, listener] of this.listeners) map.on(type, listener)
    // The relief's elevation arrives tile by tile: lift the city again once a batch has come in.
    this.sourceListener = (event) => {
      if (event.sourceId.startsWith('relief')) this.refreshTerrain()
    }
    map.on('sourcedata', this.sourceListener)
    this.schedule()
  }

  onRemove(map: MapLibreMap, gl: WebGL2RenderingContext): void {
    clearTimeout(this.updateTimer)
    clearTimeout(this.terrainTimer)
    for (const [type, listener] of this.listeners) map.off(type, listener)
    if (this.sourceListener) map.off('sourcedata', this.sourceListener)
    for (const worker of this.workers) worker.terminate()
    for (const chunk of this.chunks.values()) this.release(chunk)
    this.chunks.clear()
    for (const { mesh } of this.arrived.splice(0)) mesh.photo.close()
    this.photo?.dispose(gl, () => {})
    this.photo = null
    for (const program of [this.buildingProgram, this.treeProgram, this.meshProgram]) if (program) gl.deleteProgram(program.program)
    gl.deleteBuffer(this.unitTree)
    this.map = null
    this.gl = null
  }

  setLook(theme: MapTheme): void {
    this.theme = theme
    this.look = this.photo ? LOOKS.photo : LOOKS[theme]
    this.map?.triggerRepaint()
  }

  /** Lays the air photos on the roofs, or takes them off again and frees what they held. */
  setPhoto(on: boolean): void {
    const gl = this.gl
    if (!gl || on === !!this.photo) return
    if (on) {
      this.photo = new PhotoCache(coarse)
      this.photo.create(gl)
    } else {
      this.photo!.dispose(gl, (id) => this.cancel(id))
      this.photo = null
      // The mesh is Sat 3D's alone: what it holds on the graphics card goes with it.
      for (const chunk of [...this.chunks.values()]) {
        if (chunk.kind !== 'mesh') continue
        if (chunk.state === 'loading') this.cancel(chunk.key)
        this.release(chunk)
        this.chunks.delete(chunk.key)
      }
      for (const { mesh } of this.arrived.splice(0)) mesh.photo.close()
      this.drawn = this.drawn.filter((chunk) => chunk.kind !== 'mesh')
      // What gave way to the mesh comes back with the next frame, not the next look round.
      this.meshCover.rebuild([])
      this.closeCover.rebuild([])
      this.trialCover.rebuild([])
      this.meshDetail = 1
    }
    this.setLook(this.theme)
    this.schedule()
  }

  setOpacity(opacity: number): void {
    this.opacity = opacity
    this.map?.triggerRepaint()
  }

  /**
   * The building of the city model drawn at a point of the canvas. The ray from the camera through
   * that point is tried against each building's box, nearest first, and then against the triangles
   * inside. Those are read back from the graphics card for the few buildings in question: keeping
   * millions of vertices in memory as well, only for the odd click, would cost far more.
   */
  pick(x: number, y: number): CityHit | null {
    const map = this.map
    const gl = this.gl
    const matrix = this.matrix
    if (!map || !gl || !matrix || map.getLayoutProperty(CITY_LAYER, 'visibility') === 'none') return null
    const canvas = map.getCanvas()
    const across = (2 * x) / canvas.clientWidth - 1
    const up = 1 - (2 * y) / canvas.clientHeight
    // Two points of the ray in Mercator: on the near plane, and halfway into the depth.
    const [near, deep] = [-1, 0].map((depth) => {
      const p = solve(matrix, [across, up, depth, 1])
      return [p[0] / p[3], p[1] / p[3], p[2] / p[3]]
    })
    const terrain = !!map.getTerrain()
    const boxes: { chunk: Chunk; building: number; t: number; from: number[]; along: number[] }[] = []
    for (const chunk of this.drawn) {
      if (!chunk.leaf || !chunk.buildings) continue
      // The ray in the piece's own metres. A piece's frame is the map's moved and scaled, so a point's
      // t along the ray is the same in every piece, and hits in different pieces compare directly.
      const local = (p: number[]) => [(p[0] - chunk.origin[0]) / chunk.scale, (chunk.origin[1] - p[1]) / chunk.scale, p[2] / chunk.scale]
      const from = local(near)
      const to = local(deep)
      const along = [to[0] - from[0], to[1] - from[1], to[2] - from[2]]
      const b = chunk.buildings
      for (let i = 0; i < b.length; i += 7) {
        const ground = terrain && chunk.grounds ? chunk.grounds[i / 7] : 0
        const t = enterBox(from, along, [b[i + 2], b[i + 3], ground], [b[i + 4], b[i + 5], ground + b[i + 6]])
        if (t !== null) boxes.push({ chunk, building: i / 7, t, from, along })
      }
    }

    let best: { chunk: Chunk; building: number; t: number; from: number[]; along: number[] } | null = null
    for (const box of boxes.sort((a, b) => a.t - b.t)) {
      // A box no nearer than the nearest roof or wall already met cannot hide anything in front of it.
      if (best && box.t >= best.t) break
      const { chunk, building } = box
      const b = chunk.buildings!
      const first = b[building * 7]
      const vertices = new Float32Array(b[building * 7 + 1] * 3)
      // The positions are the piece's first buffer. COPY_READ_BUFFER is a binding the map itself never uses.
      gl.bindBuffer(gl.COPY_READ_BUFFER, chunk.buffers[0])
      gl.getBufferSubData(gl.COPY_READ_BUFFER, first * 12, vertices)
      gl.bindBuffer(gl.COPY_READ_BUFFER, null)
      const ground = terrain && chunk.grounds ? chunk.grounds[building] : 0
      for (let v = 0; v < vertices.length; v += 9) {
        const t = hitTriangle(box.from, box.along, vertices, v, ground)
        // Below the street nothing is drawn (the shader leaves basements out), so nothing is hit either.
        if (t !== null && box.from[2] + t * box.along[2] - ground >= -0.05 && (!best || t < best.t)) best = { ...box, t }
      }
    }
    if (!best) return null
    const { chunk, building, t, from, along } = best
    const at = new MercatorCoordinate(chunk.origin[0] + (from[0] + t * along[0]) * chunk.scale, chunk.origin[1] - (from[1] + t * along[1]) * chunk.scale).toLngLat()
    return { leaf: chunk.leaf!, feature: building, lon: at.lng, lat: at.lat }
  }

  /** Works out what should be loaded and drawn, at most a few times a second while the camera moves. */
  private schedule(): void {
    if (this.updateTimer) return
    const wait = Math.max(0, 250 - (performance.now() - this.lastUpdate))
    this.updateTimer = window.setTimeout(() => {
      this.updateTimer = 0
      this.update()
    }, wait)
  }

  private update(): void {
    const map = this.map
    if (!map) return
    this.lastUpdate = performance.now()
    const now = Date.now()
    const wanted: Chunk[] = []
    // The mesh's pieces to draw. Others of its pieces are wanted without being drawn: those on their
    // way, and those that came before their siblings, kept for when the rest have come too.
    const meshes: Chunk[] = []
    const visible = map.getLayer(CITY_LAYER) && map.getLayoutProperty(CITY_LAYER, 'visibility') !== 'none'
    const zoom = map.getZoom()

    if (visible && zoom >= MIN_ZOOM) {
      const tileUrl = this.tileTemplate()
      const pitch = map.getPitch()
      // Out to where the haze has swallowed everything: no further, since nothing would show.
      const reach = this.fogRange()[1]
      if (tileUrl) {
        for (const tile of visibleTiles(map, reach, TILE_LIMIT)) {
          if (zoom >= OVERTURE_ZOOM && tile.distance <= OVERTURE_REACH) {
            const detailed = this.chunk(`o:${tile.key}`, { kind: 'overture', id: `o:${tile.key}`, z: TILE_ZOOM, x: tile.x, y: tile.y }, tile.distance, 1)
            wanted.push(detailed)
            if (detailed.state === 'ready') continue
          }
          const url = tileUrl.replace('{z}', String(TILE_ZOOM)).replace('{x}', String(tile.x)).replace('{y}', String(tile.y))
          const blocks = this.chunk(`e:${tile.key}`, { kind: 'extruded', id: `e:${tile.key}`, url, z: TILE_ZOOM, x: tile.x, y: tile.y }, tile.distance, 1)
          wanted.push(blocks)
          // Zoomed out past Overture's reach, its tile still stands until the blocks have come.
          const detailed = this.chunks.get(`o:${tile.key}`)
          if (blocks.state !== 'ready' && detailed?.state === 'ready' && !wanted.includes(detailed)) wanted.push(detailed)
        }
      }
      this.updatePhoto()
      if (zoom >= MODEL_ZOOM) {
        this.model.load()
        const look = map.getCenter()
        const ground = cameraGround(map)
        const near = (leaves: Leaf[], reach: number, budget: number) => {
          let used = 0
          const picked: [Leaf, number][] = []
          for (const leaf of leaves) {
            const [east, north] = offsetMetres(look, leaf.centre)
            const distance = Math.max(0, Math.hypot(east, north) - leaf.radius)
            if (distance > reach) continue
            // Seen at a slant, what lies behind the camera never shows: do not spend the budget on it.
            const [back, side] = offsetMetres(ground.at, leaf.centre)
            if (pitch > 45 && back * ground.forward[0] + side * ground.forward[1] < -(leaf.radius + 150)) continue
            picked.push([leaf, distance])
          }
          picked.sort((a, b) => a[1] - b[1])
          return picked.filter(([leaf]) => (used += leaf.size) <= budget)
        }
        const reach = modelReach(zoom)
        for (const [leaf, distance] of near(this.model.leavesNear('buildings', look, reach), reach, MODEL_BUDGET)) {
          const url = `${leaf.layer.url}/nodes/${leaf.resource}/geometries/0`
          const chunk = this.chunk(leaf.key, { kind: 'model', id: leaf.key, url, obb: leaf.obb, crs: leaf.layer.crs }, distance, leaf.size)
          chunk.leaf = leaf
          wanted.push(chunk)
        }
        if (zoom >= TREE_ZOOM) {
          const treeReach = reach * 0.6
          for (const [leaf, distance] of near(this.model.leavesNear('trees', look, treeReach), treeReach, TREE_BUDGET)) {
            const base = `${leaf.layer.url}/nodes/${leaf.resource}`
            const heightsUrl = leaf.layer.heightKey ? `${base}/attributes/${leaf.layer.heightKey}/0` : null
            wanted.push(this.chunk(leaf.key, { kind: 'trees', id: leaf.key, featuresUrl: `${base}/features/0`, heightsUrl, crs: leaf.layer.crs }, distance, leaf.size))
          }
        }
      }
      // Sat 3D: Rīga photographed, out to where the haze ends. Once it is up, it stays up half a
      // level further out, so zooming out a little does not drop it all at once.
      const meshZoom = this.drawn.some((chunk) => chunk.kind === 'mesh') ? MODEL_ZOOM - 0.5 : MODEL_ZOOM
      if (this.photo && this.view && zoom >= meshZoom) {
        this.model.load()
        const detail = this.meshDetail
        const view = { ...this.view, focal: this.view.focal * detail }
        const ready = (node: MeshNode) => this.chunks.get(node.key)?.state === 'ready'
        // A block out of view reads no pages.
        const trees = this.model.meshesNear(cameraGround(map).at, reach).filter((tree) => view.shows(tree.box))
        const { pick, later, need } = this.chooseMesh(trees, view, this.closeCover)
        for (const node of pick.draw) {
          const chunk = this.chunks.get(node.key)!
          // Moved back only beside a piece of the city's own: elsewhere it stands as clear of the relief as theirs.
          chunk.push = node.rank > 0 && this.closeCover.meets(node.box)
          wanted.push(chunk)
          meshes.push(chunk)
        }
        // The targets that have come count first, then those still to come: on the screen before
        // those only beside it, nearest first, those waiting on the city's own last, while the
        // budget lasts. Stand-ins are not counted: they go once what they stand in for has come.
        const sizeOf = (node: MeshNode) => this.chunks.get(node.key)?.size ?? meshSize(node.content!)
        const order = (node: MeshNode) =>
          Math.hypot(node.centre[0] - view.eye[0], node.centre[1] - view.eye[1], node.centre[2] - view.eye[2]) + (view.onScreen(node.box) ? 0 : 1) + (later.has(node) ? 2 : 0)
        let used = 0
        const coming: MeshNode[] = []
        for (const node of pick.targets) {
          if (!ready(node)) coming.push(node)
          else {
            used += sizeOf(node)
            // One that came before its siblings is kept, not drawn, until they have come too.
            wanted.push(this.chunks.get(node.key)!)
          }
        }
        for (const node of coming.sort((a, b) => order(a) - order(b))) {
          const size = sizeOf(node)
          if (used + size > MESH_BUDGET) break
          used += size
          const { geometry, photo, attributes, cuts } = node.content!
          const job = { kind: 'mesh', id: node.key, geometryUrl: geometry, photoUrl: photo, obb: node.obb, attributes, cuts, maxPhoto: MESH_PHOTO } as const
          wanted.push(this.chunk(node.key, job, order(node), size))
        }
        // While what the view asks for does not fit, the next look round asks for less detail. Once
        // it fits, for more again, up to the full, but only where what that would ask for is seen to
        // fit too: it grows unevenly with the detail, in steps and stretches.
        if (need > MESH_BUDGET) this.meshDetail = Math.max(MESH_LEAST_DETAIL, detail * 0.85)
        else if (detail < 1) {
          const up = Math.min(1, detail * 1.15)
          if (this.chooseMesh(trees, { ...view, focal: this.view.focal * up }, this.trialCover).need <= MESH_BUDGET) this.meshDetail = up
        }
        // The new detail is picked at the next look round, even with nothing on its way to call for one.
        if (this.meshDetail !== detail) this.schedule()
      }
    }

    const wantedKeys = new Set(wanted.map((chunk) => chunk.key))
    for (const chunk of wanted) chunk.usedAt = now
    // Asked for but not wanted any more: called off, so the nearer pieces go first.
    for (const chunk of this.chunks.values()) {
      if (chunk.state === 'ready' || wantedKeys.has(chunk.key)) continue
      if (chunk.state === 'loading') this.cancel(chunk.key)
      this.chunks.delete(chunk.key)
    }
    // Nearest first, a few at a time.
    const free = { ...IN_FLIGHT }
    for (const chunk of this.chunks.values()) if (chunk.state === 'loading') free[chunk.job.kind]--
    for (const chunk of [...wanted].sort((a, b) => a.priority - b.priority)) {
      if (free[chunk.job.kind] <= 0) continue
      if (chunk.state !== 'queued' && !(chunk.state === 'failed' && now - chunk.failedAt > 60_000)) continue
      chunk.state = 'loading'
      this.workerForKey(chunk.key).postMessage(chunk.job)
      free[chunk.job.kind]--
    }

    // A mesh piece is drawn only where the traversal chose it.
    this.drawn = [...wanted.filter((chunk) => chunk.state === 'ready' && chunk.kind !== 'mesh'), ...meshes]
    const models = this.drawn.filter((chunk) => chunk.kind === 'model')
    const modelKeys = models.map((chunk) => chunk.key).sort().join('|')
    if (modelKeys !== this.drawnModelKeys) {
      this.drawnModelKeys = modelKeys
      this.coverage.rebuild(models)
    }
    this.meshCover.rebuild(meshes)
    this.evict(wantedKeys)
    map.triggerRepaint()
  }

  /**
   * What of Rīga's photographed blocks a view asks for, the city's own first: a piece of LĢIA's
   * they wholly cover, as `cover` then holds them, is passed over. Until theirs have come, one of
   * LĢIA's under where they will be waits (`later`): it is not counted in what the view asks for
   * (`need`, bytes), and comes only with room to spare.
   */
  private chooseMesh(trees: MeshTree[], view: MeshView, cover: MeshCover): { pick: MeshPick; later: Set<MeshNode>; need: number } {
    const ready = (node: MeshNode) => this.chunks.get(node.key)?.state === 'ready'
    const pick: MeshPick = { targets: [], draw: [] }
    for (const tree of trees) if ((tree.layer.rank ?? 1) === 0) selectMesh(tree, 0, view, ready, pick)
    const close = pick.targets.length
    cover.rebuild(pick.draw.map((node) => this.chunks.get(node.key)!))
    // Out of view nothing is drawn, so nothing need cover it there: the next look round tries again as the camera turns.
    const beyond = (box: number[]) => (x: number, y: number) => !view.shows([x, y, box[2], x, y, box[5]])
    for (const tree of trees) if ((tree.layer.rank ?? 1) !== 0) selectMesh(tree, 0, view, ready, pick, (node) => cover.coversAll(node.box, beyond(node.box)))
    const coming = pick.targets.slice(0, close).filter((node) => !ready(node)).map((node) => node.box)
    const under = (x: number, y: number) => coming.some((b) => x >= b[0] && x <= b[3] && y >= b[1] && y <= b[4])
    const later = new Set(pick.targets.slice(close).filter((node) => coming.length && cover.coversAll(node.box, (x, y) => beyond(node.box)(x, y) || under(x, y))))
    let need = 0
    for (const node of pick.targets) if (!later.has(node)) need += this.chunks.get(node.key)?.size ?? meshSize(node.content!)
    return { pick, later, need }
  }

  /** The chunk for a key, made on first asking. A new one waits for its turn in `update`. */
  private chunk(key: string, job: Exclude<CityJob, { kind: 'cancel' | 'photo' }>, priority: number, size: number): Chunk {
    let chunk = this.chunks.get(key)
    if (!chunk) {
      chunk = {
        key,
        // Overture's buildings come as one more extruded tile.
        kind: job.kind === 'overture' ? 'extruded' : job.kind,
        job,
        priority,
        size,
        state: 'queued',
        failedAt: 0,
        usedAt: 0,
        origin: [0, 0],
        scale: 1,
        box: [],
        vao: null,
        buffers: [],
        ground: null,
        groundDone: -1,
        count: 0,
        coverageDone: -1,
        hidesAny: false,
        serial: this.serials++,
        meshSeen: -1,
        vertices: 0,
        texture: null,
      }
      this.chunks.set(key, chunk)
    }
    chunk.priority = priority
    return chunk
  }

  /** Moves the photo windows and asks for the next photos. */
  private updatePhoto(): void {
    if (this.map) this.photo?.update(this.map, (job) => this.workerForKey(job.id).postMessage(job), (id) => this.cancel(id))
  }

  private workerForKey(key: string): Worker {
    // One piece always goes to the same worker, so a cancel reaches the job it means.
    let hash = 0
    for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) | 0
    return this.workers[Math.abs(hash) % this.workers.length]
  }

  private cancel(id: string): void {
    this.workerForKey(id).postMessage({ kind: 'cancel', id } satisfies CityJob)
  }

  /** Lets go of what was not drawn for longest, past what is kept in reserve. */
  private evict(wanted: Set<string>): void {
    const spare: Record<Kind, number> = { extruded: SPARE_TILES, model: SPARE_MODEL, trees: SPARE_TREES, mesh: SPARE_MESH }
    const idle = [...this.chunks.values()].filter((chunk) => chunk.state === 'ready' && !wanted.has(chunk.key)).sort((a, b) => b.usedAt - a.usedAt)
    for (const chunk of idle) {
      spare[chunk.kind] -= chunk.size
      if (spare[chunk.kind] < 0) {
        this.release(chunk)
        this.chunks.delete(chunk.key)
      }
    }
  }

  private release(chunk: Chunk): void {
    const gl = this.gl
    if (!gl) return
    gl.deleteVertexArray(chunk.vao)
    for (const buffer of chunk.buffers) gl.deleteBuffer(buffer)
    gl.deleteBuffer(chunk.ground)
    gl.deleteTexture(chunk.texture)
    chunk.vao = null
    chunk.buffers = []
    chunk.ground = null
    chunk.texture = null
  }

  private receive(result: CityResult): void {
    if (result.id.startsWith('p:')) {
      if ('photo' in result) {
        if (this.photo) this.photo.receive(result.id, result.photo, false)
        else result.photo?.close()
        // The next photo goes out at once rather than with the next look round, so they come in a steady stream.
        const map = this.map
        if (map && map.getZoom() >= MIN_ZOOM && map.getLayoutProperty(CITY_LAYER, 'visibility') !== 'none') this.updatePhoto()
      } else if ('error' in result) {
        this.photo?.receive(result.id, null, true)
        this.schedule()
      }
      this.map?.triggerRepaint()
      return
    }
    const chunk = this.chunks.get(result.id)
    if (!chunk || chunk.state !== 'loading') {
      if ('mesh' in result && result.mesh.kind === 'mesh') result.mesh.photo.close()
      return
    }
    if ('error' in result) {
      console.warn(`[city] ${result.id}: ${result.error}`)
      chunk.state = 'failed'
      chunk.failedAt = Date.now()
    } else if ('mesh' in result) {
      // A mesh piece waits to be drawn in: handing its photo over takes a few milliseconds, so one goes a frame.
      if (result.mesh.kind === 'mesh') {
        this.arrived.push({ chunk, mesh: result.mesh })
        this.map?.triggerRepaint()
        return
      }
      this.upload(chunk, result.mesh)
      chunk.state = 'ready'
    }
    this.schedule()
  }

  /**
   * Hands one arrived mesh piece a frame to the graphics card, while drawing: its photo alone takes a
   * few milliseconds. The nearest piece still waiting its turn goes out to the workers at once, in
   * the request it leaves free, rather than with the next look round.
   */
  private uploadArrived(): void {
    while (this.arrived.length) {
      const { chunk, mesh } = this.arrived.shift()!
      // Called off meanwhile, or the camera moved on and it is no longer wanted.
      if (this.chunks.get(chunk.key) !== chunk || chunk.state !== 'loading') {
        mesh.photo.close()
        continue
      }
      this.upload(chunk, mesh)
      chunk.state = 'ready'
      let next: Chunk | null = null
      for (const queued of this.chunks.values()) if (queued.kind === 'mesh' && queued.state === 'queued' && (!next || queued.priority < next.priority)) next = queued
      if (next) {
        next.state = 'loading'
        this.workerForKey(next.key).postMessage(next.job)
      }
      this.schedule()
      break
    }
    if (this.arrived.length) this.map?.triggerRepaint()
  }

  /** Hands a finished piece to the graphics card. Only what is needed later stays in memory. */
  private upload(chunk: Chunk, mesh: ChunkMesh): void {
    const gl = this.gl!
    chunk.origin = mesh.origin
    chunk.scale = mesh.scale
    chunk.vao = gl.createVertexArray()
    gl.bindVertexArray(chunk.vao)
    const attribute = (data: ArrayBufferView, location: number, size: number, type: number, normalized: boolean, divisor: number) => {
      const buffer = gl.createBuffer()!
      chunk.buffers.push(buffer)
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW)
      gl.enableVertexAttribArray(location)
      gl.vertexAttribPointer(location, size, type, normalized, 0, 0)
      gl.vertexAttribDivisor(location, divisor)
    }

    if (mesh.kind === 'trees') {
      const { attributes } = this.treeProgram!
      gl.bindBuffer(gl.ARRAY_BUFFER, this.unitTree)
      gl.enableVertexAttribArray(attributes.a_shape)
      gl.vertexAttribPointer(attributes.a_shape, 4, gl.FLOAT, false, 0, 0)
      gl.vertexAttribDivisor(attributes.a_shape, 0)
      attribute(mesh.trees, attributes.a_tree, 3, gl.FLOAT, false, 1)
      chunk.trees = mesh.trees
      chunk.count = mesh.trees.length / 3
      chunk.box = boxOf(mesh.trees, 3)
    } else if (mesh.kind === 'mesh') {
      const { attributes } = this.meshProgram!
      attribute(mesh.positions, attributes.a_pos, 3, gl.FLOAT, false, 0)
      attribute(mesh.uvs, attributes.a_uv, 2, gl.FLOAT, false, 0)
      attribute(mesh.grounds, attributes.a_ground, 1, gl.FLOAT, false, 0)
      chunk.vertices = chunk.count = mesh.positions.length / 3
      chunk.box = boxOf(mesh.positions, 3)
      chunk.cover = mesh.cover
      // Its box reaches as high as the relief can raise it.
      chunk.box[5] += EXAGGERATION * mesh.grounds.reduce((high, ground) => Math.max(high, ground), 0) + MESH_CLEARANCE
      // A node its scene's cuts leave nothing of has no use for its photo.
      if (!chunk.count) {
        chunk.size = 0
        mesh.photo.close()
        gl.bindVertexArray(null)
        return
      }
      chunk.texture = gl.createTexture()
      gl.bindTexture(gl.TEXTURE_2D, chunk.texture)
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
      // I3S puts 0, 0 at the photo's top left, where WebGL puts the first row it is given.
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, mesh.photo)
      gl.generateMipmap(gl.TEXTURE_2D)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      // A street seen at a slant stays sharp along its length.
      if (this.anisotropy) gl.texParameterf(gl.TEXTURE_2D, this.anisotropy.ext.TEXTURE_MAX_ANISOTROPY_EXT, this.anisotropy.max)
      gl.bindTexture(gl.TEXTURE_2D, null)
      // What it really takes: 24 bytes a vertex, four a pixel and a third more for the smaller copies.
      chunk.size = chunk.vertices * 24 + (mesh.photo.width * mesh.photo.height * 16) / 3
      mesh.photo.close()
    } else {
      const { attributes } = this.buildingProgram!
      attribute(mesh.positions, attributes.a_pos, 3, gl.FLOAT, false, 0)
      chunk.box = boxOf(mesh.positions, 3)
      chunk.vertices = mesh.positions.length / 3
      if (mesh.kind === 'extruded') {
        attribute(mesh.colors, attributes.a_color, 4, gl.UNSIGNED_BYTE, true, 0)
        const indices = gl.createBuffer()!
        chunk.buffers.push(indices)
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indices)
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.DYNAMIC_DRAW)
        chunk.indices = mesh.indices
        chunk.polygons = mesh.polygons
        chunk.count = mesh.indices.length
      } else {
        attribute(modelColours(mesh), attributes.a_color, 4, gl.UNSIGNED_BYTE, true, 0)
        chunk.buildings = mesh.buildings
        chunk.count = chunk.vertices
      }
    }
    gl.bindVertexArray(null)
  }

  /** The vector tile URL template, once the map has read the TileJSON that names it. */
  private tileTemplate(): string | null {
    this.tileUrl ??= (this.map?.getSource('omt') as VectorTileSource | undefined)?.tiles?.[0] ?? null
    return this.tileUrl
  }

  /** Where the haze starts and ends, metres from the camera. */
  private fogRange(): [number, number] {
    const distance = cameraDistanceMetres(this.map!)
    return [distance * 1.4 + 250, distance * 4 + 3500]
  }

  private refreshTerrain(): void {
    clearTimeout(this.terrainTimer)
    this.terrainTimer = window.setTimeout(() => {
      this.terrainVersion++
      this.map?.triggerRepaint()
    }, 400)
  }

  /**
   * Lifts each building and tree onto the relief at its middle, as the map's own extrusions are.
   * Called with the piece's vertex array bound. Working out the ground for a whole tile takes a
   * while, so only a few pieces are redone per frame; the rest keep their old ground meanwhile.
   */
  private lift(chunk: Chunk, location: number, divisor: number): void {
    const gl = this.gl!
    const map = this.map!
    if (!map.getTerrain()) {
      gl.disableVertexAttribArray(location)
      return
    }
    if (chunk.groundDone !== this.terrainVersion && this.liftsLeft > 0) {
      this.liftsLeft--
      chunk.groundDone = this.terrainVersion
      const [mx, my] = chunk.origin
      const s = chunk.scale
      const at = (x: number, y: number) => map.queryTerrainElevation(new MercatorCoordinate(mx + x * s, my - y * s).toLngLat()) ?? 0
      let ground: Float32Array
      if (chunk.trees) {
        ground = new Float32Array(chunk.count)
        for (let i = 0; i < chunk.count; i++) ground[i] = at(chunk.trees[i * 3], chunk.trees[i * 3 + 1])
      } else if (chunk.polygons) {
        ground = new Float32Array(chunk.vertices)
        const runs = chunk.polygons
        for (let i = 0; i < runs.length; i += 6) ground.fill(at(runs[i + 2], runs[i + 3]), runs[i + 4], runs[i + 4] + runs[i + 5])
      } else {
        ground = new Float32Array(chunk.vertices)
        const runs = chunk.buildings!
        // Kept per building as well, so that a click looks for each building where it is drawn.
        chunk.grounds = new Float32Array(runs.length / 7)
        for (let i = 0; i < runs.length; i += 7) {
          chunk.grounds[i / 7] = at((runs[i + 2] + runs[i + 4]) / 2, (runs[i + 3] + runs[i + 5]) / 2)
          ground.fill(chunk.grounds[i / 7], runs[i], runs[i] + runs[i + 1])
        }
      }
      chunk.ground ??= gl.createBuffer()
      gl.bindBuffer(gl.ARRAY_BUFFER, chunk.ground)
      gl.bufferData(gl.ARRAY_BUFFER, ground, gl.STATIC_DRAW)
      gl.vertexAttribPointer(location, 1, gl.FLOAT, false, 0, 0)
      gl.vertexAttribDivisor(location, divisor)
    }
    if (chunk.groundDone !== this.terrainVersion) map.triggerRepaint()
    // Still on the old ground, or on none yet, which is sea level.
    if (chunk.ground) gl.enableVertexAttribArray(location)
    else gl.disableVertexAttribArray(location)
  }

  /**
   * Whether the mesh pieces over a piece's ground have changed since it last looked: only then need
   * it look through its blocks, buildings or trees again.
   */
  private meshMoved(chunk: Chunk): boolean {
    const cover = this.meshCover
    if (chunk.meshSeen === cover.version) return false
    chunk.meshSeen = cover.version
    const [mx, my] = chunk.origin
    const s = chunk.scale
    const b = chunk.box
    const near = cover.piecesIn(mx + b[0] * s, my - b[4] * s, mx + b[3] * s, my - b[1] * s)
    if (near === chunk.meshNear) return false
    chunk.meshNear = near
    return true
  }

  /** Leaves out the blocks the city model or the mesh now shows, and brings back those they no longer do. */
  private hideCovered(chunk: Chunk): void {
    const coverage = this.coverage
    const meshCover = this.meshCover
    const meshMoved = this.meshMoved(chunk)
    if (chunk.coverageDone === coverage.version && !meshMoved) return
    chunk.coverageDone = coverage.version
    const [mx, my] = chunk.origin
    const s = chunk.scale
    // A tile wholly outside what the model and the mesh cover keeps every block, and need not be looked through.
    const byModel = reaches(chunk, coverage.bounds)
    const byMesh = reaches(chunk, meshCover.bounds)
    if (!byModel && !byMesh && !chunk.hidesAny) return
    const polygons = chunk.polygons!
    const hidden = new Uint8Array(polygons.length / 6)
    let hidesAny = false
    for (let p = 0; p < hidden.length; p++) {
      const x = mx + polygons[6 * p + 2] * s
      const y = my - polygons[6 * p + 3] * s
      if ((byMesh && meshCover.covers(x, y)) || (byModel && coverage.covers(x, y))) {
        hidden[p] = 1
        hidesAny = true
      }
    }
    // The same blocks left out as before: the index buffer as it stands is right.
    const was = chunk.hidden
    if (was ? was.every((flag, p) => flag === hidden[p]) : !hidesAny) return
    chunk.hidden = hidden
    chunk.hidesAny = hidesAny
    const all = chunk.indices!
    const kept = new Uint32Array(all.length)
    let length = 0
    for (let p = 0; p < hidden.length; p++) {
      if (hidden[p]) continue
      kept.set(all.subarray(polygons[6 * p], polygons[6 * p] + polygons[6 * p + 1]), length)
      length += polygons[6 * p + 1]
    }
    chunk.count = length
    const gl = this.gl!
    gl.bindVertexArray(chunk.vao)
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, kept.subarray(0, length), gl.DYNAMIC_DRAW)
  }

  /**
   * A model piece's buildings the mesh does not show, as runs of vertices. Where the mesh shows a
   * building, the model's is left out; it stays loaded, so that a click still finds it.
   */
  private unmeshed(chunk: Chunk): number[] {
    const cover = this.meshCover
    if (this.meshMoved(chunk) || !chunk.runs) {
      const b = chunk.buildings!
      const [mx, my] = chunk.origin
      const s = chunk.scale
      const byMesh = reaches(chunk, cover.bounds)
      const runs: number[] = []
      for (let i = 0; i < b.length; i += 7) {
        if (byMesh && cover.covers(mx + ((b[i + 2] + b[i + 4]) / 2) * s, my - ((b[i + 3] + b[i + 5]) / 2) * s)) continue
        // A building that follows straight on from the one before lengthens its run.
        const last = runs.length - 2
        if (last >= 0 && runs[last] + runs[last + 1] === b[i]) runs[last + 1] += b[i + 1]
        else runs.push(b[i], b[i + 1])
      }
      chunk.runs = runs
    }
    return chunk.runs
  }

  /** Lays the trees the mesh shows itself down flat, where they draw nothing, and stands them up again where it no longer does. Called with the piece's vertex array bound. */
  private hideMeshedTrees(chunk: Chunk): void {
    const cover = this.meshCover
    if (!this.meshMoved(chunk)) return
    const trees = chunk.trees!
    const byMesh = reaches(chunk, cover.bounds)
    if (!byMesh && !chunk.hidesAny) return
    const [mx, my] = chunk.origin
    const s = chunk.scale
    const shown = trees.slice()
    let hidesAny = false
    for (let i = 0; i < trees.length; i += 3) {
      if (!byMesh || !cover.covers(mx + trees[i] * s, my - trees[i + 1] * s)) continue
      shown[i + 2] = 0
      hidesAny = true
    }
    chunk.hidesAny = hidesAny
    // The trees' own buffer is the piece's first. chunk.trees keeps every height, for lifting them.
    const gl = this.gl!
    gl.bindBuffer(gl.ARRAY_BUFFER, chunk.buffers[0])
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, shown)
  }

  render(gl: WebGL2RenderingContext, args: CustomRenderMethodInput): void {
    const map = this.map
    if (!map) return
    // Shown again after being hidden, or zoomed across a threshold without the camera moving.
    if (performance.now() - this.lastUpdate > 500) this.schedule()
    // Photos are put in place even with nothing to draw yet, so a jump's old photos are gone first.
    const photo = this.photo
    if (photo?.upload(gl)) map.triggerRepaint()
    this.uploadArrived()
    const main = args.defaultProjectionData.mainMatrix
    const m = (this.matrix = Array.from(main))
    // Where the camera is, in Mercator: the one point at which the view's x, y and w all come to 0.
    const eye = solve([m[0], m[1], m[3], 0, m[4], m[5], m[7], 0, m[8], m[9], m[11], 0, m[12], m[13], m[15], 1], [0, 0, 0, 1])
    // At full detail: `update` takes it down as far as the budget asks.
    const focal = ((map.getCanvas().clientHeight / 2) / Math.tan(args.fov / 2)) * MESH_DETAIL
    // The point the camera looks at, which the mesh's detail falls away beyond.
    const target = MercatorCoordinate.fromLngLat(map.getCenter(), map.getCenterElevation())
    this.view = {
      eye: [eye[0], eye[1], eye[2]],
      focal,
      photo: MESH_PHOTO,
      near: Math.hypot(target.x - eye[0], target.y - eye[1], target.z - eye[2]),
      shows: (box) => !outside(m, box, 1, MESH_MARGIN),
      onScreen: (box) => !outside(m, box, 1),
    }
    if (!this.drawn.length) return
    const zoom = map.getZoom()
    const look = this.look
    const centre = map.getCenter()
    // Haze in the units the depth comes in, which are pixels at the centre of the map.
    const pixelsPerMetre = (512 * 2 ** zoom) / (2 * Math.PI * 6371008.8 * Math.cos((centre.lat * Math.PI) / 180))
    const [fogStart, fogEnd] = this.fogRange()

    const shared = (program: Program) => {
      const u = program.uniforms
      gl.useProgram(program.program)
      gl.uniform3fv(u.u_sun, SUN)
      gl.uniform3fv(u.u_fogColor, rgb(look.fog))
      gl.uniform2f(u.u_fog, fogStart * pixelsPerMetre, fogEnd * pixelsPerMetre)
      gl.uniform1f(u.u_opacity, this.opacity)
      gl.uniform1f(u.u_ambient, look.ambient)
      gl.uniform1f(u.u_diffuse, look.diffuse)
    }
    const matrixFor = (chunk: Chunk) => multiply(main, [chunk.scale, 0, 0, 0, 0, -chunk.scale, 0, 0, 0, 0, chunk.scale, 0, chunk.origin[0], chunk.origin[1], 0, 1])

    const draw = () => {
      // Rīga photographed, first: the depth it lays down spares the card what it hides.
      const mesh = this.meshProgram!
      shared(mesh)
      const exaggeration = map.getTerrain()?.exaggeration ?? 0
      gl.uniform2f(mesh.uniforms.u_relief, exaggeration, exaggeration ? MESH_CLEARANCE : 0)
      gl.uniform1i(mesh.uniforms.u_photo, 0)
      gl.activeTexture(gl.TEXTURE0)
      const eye = this.view!.eye
      gl.uniform2f(mesh.uniforms.u_push, 0, 0)
      let pushed = false
      for (const chunk of this.drawn) {
        if (chunk.kind !== 'mesh' || !chunk.count) continue
        const matrix = matrixFor(chunk)
        if (outside(matrix, chunk.box, 1)) continue
        gl.uniformMatrix4fv(mesh.uniforms.u_matrix, false, new Float32Array(matrix))
        if (chunk.push) {
          // The camera in the piece's own metres, for moving it back along the line of sight.
          gl.uniform3f(mesh.uniforms.u_eye, (eye[0] - chunk.origin[0]) / chunk.scale, (chunk.origin[1] - eye[1]) / chunk.scale, eye[2] / chunk.scale)
          if (!pushed) gl.uniform2f(mesh.uniforms.u_push, MESH_PUSH, MESH_DROP)
        } else if (pushed) gl.uniform2f(mesh.uniforms.u_push, 0, 0)
        pushed = !!chunk.push
        gl.bindTexture(gl.TEXTURE_2D, chunk.texture)
        gl.bindVertexArray(chunk.vao)
        gl.drawArrays(gl.TRIANGLES, 0, chunk.count)
      }

      const buildings = this.buildingProgram!
      shared(buildings)
      const u = buildings.uniforms
      gl.uniform1f(u.u_photoOn, photo?.texture ? 1 : 0)
      if (photo?.texture) {
        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, photo.texture)
        gl.uniform1i(u.u_photoTex, 0)
        gl.uniform1f(u.u_photoSize, photo.size)
      }
      gl.uniform3fv(u.u_low, rgb(look.low))
      gl.uniform3fv(u.u_high, rgb(look.high))
      gl.uniform3fv(u.u_roof, rgb(look.roof))
      gl.uniform1f(u.u_tagMix, look.tagMix)
      gl.uniform1f(u.u_glass, look.glass)
      gl.uniform1f(u.u_glow, look.glow)
      gl.vertexAttrib1f(buildings.attributes.a_ground, 0)
      for (const chunk of this.drawn) {
        if (chunk.kind === 'trees' || chunk.kind === 'mesh') continue
        // The blocks rise out of the ground between the two levels, as they always have.
        const heightScale = chunk.kind === 'extruded' ? Math.min(1, Math.max(0, zoom - MIN_ZOOM)) : 1
        const matrix = matrixFor(chunk)
        if (outside(matrix, chunk.box, heightScale)) continue
        gl.uniformMatrix4fv(u.u_matrix, false, new Float32Array(matrix))
        gl.uniform1f(u.u_heightScale, heightScale)
        // A tile's square runs east and south of its origin, its north-west corner. The model is not cut.
        const side = 1 / (2 ** TILE_ZOOM * chunk.scale)
        if (chunk.kind === 'extruded') gl.uniform4f(u.u_clip, 0, -side, side, 0)
        else gl.uniform4f(u.u_clip, -1e9, -1e9, 1e9, 1e9)
        if (photo?.texture) {
          gl.uniform4fv(u.u_photo, photo.placement(chunk.origin))
          gl.uniform1f(u.u_photoTiles, chunk.scale * 2 ** PHOTO_LEVELS[0])
        }
        if (chunk.kind === 'extruded') this.hideCovered(chunk)
        gl.bindVertexArray(chunk.vao)
        this.lift(chunk, buildings.attributes.a_ground, 0)
        if (chunk.kind === 'extruded') gl.drawElements(gl.TRIANGLES, chunk.count, gl.UNSIGNED_INT, 0)
        else {
          const runs = this.unmeshed(chunk)
          for (let r = 0; r < runs.length; r += 2) gl.drawArrays(gl.TRIANGLES, runs[r], runs[r + 1])
        }
      }

      const trees = this.treeProgram!
      shared(trees)
      gl.uniform3fv(trees.uniforms.u_leaf, rgb(look.leaf))
      gl.uniform3fv(trees.uniforms.u_bark, rgb(look.bark))
      gl.vertexAttrib1f(trees.attributes.a_ground, 0)
      for (const chunk of this.drawn) {
        if (chunk.kind !== 'trees') continue
        const matrix = matrixFor(chunk)
        if (outside(matrix, chunk.box, 1)) continue
        gl.uniformMatrix4fv(trees.uniforms.u_matrix, false, new Float32Array(matrix))
        gl.bindVertexArray(chunk.vao)
        this.hideMeshedTrees(chunk)
        this.lift(chunk, trees.attributes.a_ground, 1)
        gl.drawArraysInstanced(gl.TRIANGLES, 0, UNIT_TREE.length / 4, chunk.count)
      }
      gl.bindVertexArray(null)
    }

    this.liftsLeft = 4
    gl.disable(gl.CULL_FACE)
    if (this.opacity < 1) {
      // See-through over a photo: the nearest faces first lay down depth, then only they are coloured,
      // so the walls behind them do not add up into a darker block.
      gl.colorMask(false, false, false, false)
      draw()
      gl.colorMask(true, true, true, true)
      gl.depthFunc(gl.LEQUAL)
      gl.depthMask(false)
      draw()
      gl.depthMask(true)
    } else {
      draw()
    }
  }
}

/** The local box around a list of points: west, south, bottom, east, north, top. It reaches down to 0 at least, and further where a point lies below. */
function boxOf(values: Float32Array, stride: number): number[] {
  const box = [Infinity, Infinity, 0, -Infinity, -Infinity, 0]
  for (let i = 0; i < values.length; i += stride) {
    box[0] = Math.min(box[0], values[i])
    box[1] = Math.min(box[1], values[i + 1])
    box[3] = Math.max(box[3], values[i])
    box[4] = Math.max(box[4], values[i + 1])
    if (stride === 3) {
      box[2] = Math.min(box[2], values[i + 2])
      box[5] = Math.max(box[5], values[i + 2])
    }
  }
  return box
}

/** The x with m · x = b, for a column-major 4×4 m: Gaussian elimination, largest pivot first. */
function solve(m: ArrayLike<number>, b: number[]): number[] {
  const rows = [0, 1, 2, 3].map((r) => [m[r], m[4 + r], m[8 + r], m[12 + r], b[r]])
  for (let c = 0; c < 4; c++) {
    let pivot = c
    for (let r = c + 1; r < 4; r++) if (Math.abs(rows[r][c]) > Math.abs(rows[pivot][c])) pivot = r
    const top = rows[pivot]
    rows[pivot] = rows[c]
    rows[c] = top
    for (let r = 0; r < 4; r++) {
      if (r === c) continue
      const factor = rows[r][c] / top[c]
      for (let k = c; k < 5; k++) rows[r][k] -= factor * top[k]
    }
  }
  return rows.map((row, r) => row[4] / row[r])
}

/** How far along the ray it first enters a box, 0 if it starts inside; null if it misses it. */
function enterBox(from: number[], along: number[], low: number[], high: number[]): number | null {
  let enter = 0
  let leave = Infinity
  for (let k = 0; k < 3; k++) {
    // Running parallel to two of the faces: between them all the way, or never.
    if (along[k] === 0) {
      if (from[k] < low[k] || from[k] > high[k]) return null
      continue
    }
    const a = (low[k] - from[k]) / along[k]
    const b = (high[k] - from[k]) / along[k]
    enter = Math.max(enter, Math.min(a, b))
    leave = Math.min(leave, Math.max(a, b))
  }
  return enter <= leave ? enter : null
}

function cross(a: number[], b: number[]): number[] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

function dot(a: number[], b: number[]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

/**
 * How far along the ray it meets the triangle at `i` in a list of x, y, z, raised by `lift`; null if
 * it misses. Either face counts, as both are drawn. Möller and Trumbore's test.
 */
function hitTriangle(from: number[], along: number[], v: Float32Array, i: number, lift: number): number | null {
  const a = [v[i], v[i + 1], v[i + 2] + lift]
  const edge1 = [v[i + 3] - a[0], v[i + 4] - a[1], v[i + 5] + lift - a[2]]
  const edge2 = [v[i + 6] - a[0], v[i + 7] - a[1], v[i + 8] + lift - a[2]]
  const p = cross(along, edge2)
  const det = dot(edge1, p)
  if (det === 0) return null
  const s = [from[0] - a[0], from[1] - a[1], from[2] - a[2]]
  const u = dot(s, p) / det
  if (u < 0 || u > 1) return null
  const q = cross(s, edge1)
  const w = dot(along, q) / det
  if (w < 0 || u + w > 1) return null
  const t = dot(edge2, q) / det
  return t >= 0 ? t : null
}

/** The model has no colours of its own: each vertex carries its building's height for the palette, as an unmapped block does. */
function modelColours(mesh: ModelNode): Uint8Array {
  const colours = new Uint8Array((mesh.positions.length / 3) * 4)
  const { buildings } = mesh
  for (let i = 0; i < buildings.length; i += 7) {
    const height = Math.min(255, Math.round(buildings[i + 6]))
    for (let v = buildings[i]; v < buildings[i] + buildings[i + 1]; v++) colours[v * 4] = height
  }
  return colours
}

let layer: CityLayer | null = null

/** Puts the city on the map, where the extruded buildings were, under the outlines and labels. */
export function addCity(map: MapLibreMap, before: string): void {
  layer = new CityLayer()
  map.addLayer(layer, map.getLayer(before) ? before : undefined)
}

export function setCityTheme(theme: MapTheme): void {
  layer?.setLook(theme)
}

/** Over a photo the buildings are see-through, so the roofs it shows still come through. */
export function setCityOpacity(opacity: number): void {
  layer?.setOpacity(opacity)
}

/** Sat 3D: the air photo on the roofs. */
export function setCityPhoto(on: boolean): void {
  layer?.setPhoto(on)
}

/** The building of Rīga's city model at a point of the map's canvas, in CSS pixels; null where none is drawn. */
export function pickCity(x: number, y: number): CityHit | null {
  return layer?.pick(x, y) ?? null
}

