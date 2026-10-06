type Position = readonly number[]
type Ring = readonly Position[]

/** The outline of a region: polygons, each an outer ring followed by any holes (GeoJSON order). */
export interface RegionShape {
  type: 'Polygon' | 'MultiPolygon'
  coordinates: readonly Ring[] | readonly (readonly Ring[])[]
}

/** Even-odd ray casting. The ring may be open or closed. */
export function pointInRing(lon: number, lat: number, ring: Ring): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/**
 * Builds a fast "is this point inside the region" test. The bounding box is checked
 * first, so the hundreds of aircraft that are nowhere near cost one comparison each.
 */
export function createRegionTest(shapes: readonly RegionShape[]): (lon: number, lat: number) => boolean {
  const polygons: (readonly Ring[])[] = []
  for (const shape of shapes) {
    if (shape.type === 'Polygon') polygons.push(shape.coordinates as readonly Ring[])
    else polygons.push(...(shape.coordinates as readonly (readonly Ring[])[]))
  }

  let west = Infinity
  let south = Infinity
  let east = -Infinity
  let north = -Infinity
  for (const [outer] of polygons) {
    for (const [lon, lat] of outer) {
      if (lon < west) west = lon
      if (lon > east) east = lon
      if (lat < south) south = lat
      if (lat > north) north = lat
    }
  }

  return (lon, lat) => {
    if (lon < west || lon > east || lat < south || lat > north) return false
    return polygons.some(
      ([outer, ...holes]) => pointInRing(lon, lat, outer) && !holes.some((hole) => pointInRing(lon, lat, hole)),
    )
  }
}
