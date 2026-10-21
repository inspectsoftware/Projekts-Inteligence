/**
 * The 3D city: what the worker hands the renderer, and what the catalogue of Rīga's city model
 * holds. Geometry is always given in metres east, north and up from a local origin, so that
 * float32 keeps millimetres; the renderer places each piece on the map with one matrix.
 */

/** Where a piece of geometry sits: the Mercator position of its origin, and metres in Mercator units there. */
export interface Placement {
  /** Mercator x and y of the origin, 0..1 across the world, y growing south. */
  origin: [number, number]
  /** One metre in Mercator units at the origin's latitude. */
  scale: number
}

/**
 * The buildings of one OpenFreeMap vector tile, extruded. Indexed triangles; every polygon's
 * triangles (roof, then walls) are one contiguous run of the index list, so a polygon the city
 * model already shows can be left out by drawing the runs around it.
 */
export interface ExtrudedTile extends Placement {
  kind: 'extruded'
  /** x, y, z per vertex, metres from the origin. */
  positions: Float32Array
  /**
   * r, g, b, a per vertex. a = 255: the building's own colour, as mapped. a = 0: none mapped,
   * and r carries the building's height in metres (0-255) for the theme's ramp instead.
   */
  colors: Uint8Array
  indices: Uint32Array
  /**
   * Per polygon, six numbers: first index, index count, centroid x, centroid y (metres from the
   * origin), first vertex, vertex count.
   */
  polygons: Float32Array
}

/**
 * The buildings of one leaf of Rīga's city model (I3S 3DObject). Unindexed triangles. Each
 * building stands on z = 0: the lowest point of its own walls is moved to the ground.
 */
export interface ModelNode extends Placement {
  kind: 'model'
  positions: Float32Array
  /**
   * Per building, seven numbers: first vertex, vertex count, then its footprint box west, south,
   * east, north in metres from the origin, then its height in metres.
   */
  buildings: Float32Array
}

/** The trees of one node of a tree layer: one instance each. */
export interface TreeNode extends Placement {
  kind: 'trees'
  /** x, y, height per tree, metres from the origin. Height falls back to 8 m where none is given. */
  trees: Float32Array
}

export type ChunkMesh = ExtrudedTile | ModelNode | TreeNode

/** A request to the city worker. The worker fetches the URLs itself, so the main thread only receives finished geometry. */
export type CityJob =
  | { kind: 'extruded'; id: string; url: string; z: number; x: number; y: number }
  | { kind: 'model'; id: string; url: string; obb: NodeBox; crs: ModelCrs }
  | { kind: 'trees'; id: string; featuresUrl: string; heightsUrl: string | null; crs: ModelCrs }
  | { kind: 'cancel'; id: string }

export type CityResult = { id: string; mesh: ChunkMesh } | { id: string; error: string }

/** 4326: vertex offsets in degrees (x, y) and metres (z). 3857: offsets in Web Mercator metres. */
export type ModelCrs = 4326 | 3857

/** An I3S oriented bounding box, in the layer's CRS (degrees or Web Mercator metres; z in metres). */
export interface NodeBox {
  center: [number, number, number]
  halfSize: [number, number, number]
  quaternion: [number, number, number, number]
}

/** One scene layer of the city model, as baked into public/data/riga-3d.json. */
export interface CityLayer {
  /** The neighbourhood, as the city names it. */
  name: string
  /** .../SceneServer/layers/0, without a trailing slash. */
  url: string
  crs: ModelCrs
  /** [west, south, east, north] in degrees. */
  bbox: [number, number, number, number]
  /** Tree layers only: the attribute key holding each tree's height (f_2 and the like), if the layer has one. */
  heightKey?: string
  /** Building layers only: the attribute key of each field a click shows, where the layer has it. */
  fields?: Partial<Record<BuildingField, string>>
}

/** What the cadastre says of a building, as the city's model names it. */
export type BuildingField = 'address' | 'mainusetype' | 'exploitstartdate' | 'cadastrename' | 'propertyname' | 'propertycadastrenumber'

export interface CityCatalogue {
  /** When the catalogue was baked, ISO 8601. */
  baked: string
  buildings: CityLayer[]
  trees: CityLayer[]
}
