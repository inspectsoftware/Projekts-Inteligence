import type { Feature, FeatureCollection } from 'geojson'
import type { RoadNode, RoadWay } from '../lanes.mjs'

/** The prototype lane builder (see lanes-photo.mjs): the rules of lanes.mjs plus what the LĢIA orthophoto shows. */
export function buildRoads(ways: RoadWay[], nodes: RoadNode[], bbox: [number, number, number, number]): FeatureCollection
/** Fetches the orthophoto of a bbox and lends it to the builder; adds the kerbs traced on GeoRīga's photo there. */
export function extra(bbox: [number, number, number, number]): Promise<{ ways?: RoadWay[]; features?: Feature[] }>
