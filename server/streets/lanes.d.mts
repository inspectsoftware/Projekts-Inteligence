import type { FeatureCollection } from 'geojson'

/** A road as scripts/extract-roads.mjs keeps it. */
export interface RoadWay {
  id: number
  tags: Record<string, string>
  nodes: number[]
  coords: [number, number][]
}
/** A node with tags worth keeping: signals, crossings. */
export interface RoadNode {
  node: number
  tags: Record<string, string>
  coord?: [number, number]
}

/** The roads of a region, lane by lane, as GeoJSON features in lon/lat. */
/** With paint(lon, lat): the islands where roads part and join have their edges put on the lines painted there. */
export function buildRoads(ways: RoadWay[], nodes: RoadNode[], bbox: [number, number, number, number], opts?: { paint?: (lon: number, lat: number) => boolean }): FeatureCollection
/** The arrow image name for a lane's turn:lanes directions. */
export function arrowIcon(dirs: string[]): string
