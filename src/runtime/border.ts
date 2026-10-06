import type { FeatureCollection, MultiPolygon, Polygon } from 'geojson'
import { createRegionTest } from '../../shared/geo/pip'

let test: ((lon: number, lat: number) => boolean) | null = null

/** Called once the national border has been fetched for the map. */
export function setBorder(border: FeatureCollection<Polygon | MultiPolygon>): void {
  test = createRegionTest(border.features.map((feature) => feature.geometry))
}

/** False until the border has loaded: nothing is claimed to be "over Latvia" on a guess. */
export function insideLatvia(lon: number, lat: number): boolean {
  return test ? test(lon, lat) : false
}
