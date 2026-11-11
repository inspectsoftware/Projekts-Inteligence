import type { Feature, FeatureCollection, MultiPolygon, Polygon, Position } from 'geojson'
import type { Map } from 'maplibre-gl'

type BorderCollection = FeatureCollection<Polygon | MultiPolygon>

/** Twice a ring's area in degrees², positive when it runs anticlockwise. */
function signedArea(ring: readonly Position[]): number {
  let sum = 0
  for (let i = 1; i < ring.length; i++) sum += ring[i - 1][0] * ring[i][1] - ring[i][0] * ring[i - 1][1]
  return sum
}

/** Everything except the Baltic states: a world-sized polygon with them cut out as holes. */
export function buildMask(border: BorderCollection): Feature<Polygon> {
  const world: Position[] = [
    [-180, -85],
    [180, -85],
    [180, 85],
    [-180, 85],
    [-180, -85],
  ]
  const holes: Position[][] = []
  for (const feature of border.features) {
    const { geometry } = feature
    const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates
    // Only outer rings: lakes and enclaves inside the country stay lit. Each turned clockwise, against
    // the world's ring, as GeoJSON has holes run.
    for (const rings of polygons) {
      // Slivers of next to no area (under ~1 km²) touching the coast: triangulated with the rest, they
      // cut wedges of shade across the country. Left out; the shade over them cannot be seen.
      if (Math.abs(signedArea(rings[0])) * 111 * 111 * 0.55 < 1) continue
      holes.push(signedArea(rings[0]) > 0 ? [...rings[0]].reverse() : rings[0])
    }
  }
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [world, ...holes] } }
}

/**
 * Dims the rest of the world and traces the Baltic states' outer border, all under the basemap's
 * labels: above them, the shade greyed out half of a coastal town's name where it hangs over the
 * sea (Ventspils, Liepāja), and the border line struck it through.
 */
export function addSpotlight(map: Map, border: BorderCollection): void {
  // Not simplified per tile (tolerance 0): simplified, the islands' rings off Estonia cross one another
  // at some zooms, and the fill is cut into a dark band right across the country.
  map.addSource('lv-mask', { type: 'geojson', data: buildMask(border), tolerance: 0 })
  map.addSource('lv-border', { type: 'geojson', data: border })

  const firstLabel = map.getStyle().layers.find((layer) => layer.type === 'symbol')?.id
  map.addLayer({
    id: 'lv-mask',
    type: 'fill',
    source: 'lv-mask',
    paint: {
      'fill-color': '#04070a',
      // Eases off closer in and is gone by a town's scale, where the basemap's own, exact border shows.
      'fill-opacity': ['interpolate', ['linear'], ['zoom'], 5, 0.62, 9, 0.45, 11, 0],
    },
  }, firstLabel)
  map.addLayer({
    id: 'lv-border-glow',
    type: 'line',
    source: 'lv-border',
    layout: { 'line-join': 'round' },
    paint: {
      'line-color': '#4fd6ff',
      'line-opacity': ['interpolate', ['linear'], ['zoom'], 8, 0.28, 10.5, 0],
      'line-blur': 6,
      'line-width': ['interpolate', ['linear'], ['zoom'], 4, 5, 8, 10, 12, 16],
    },
  }, firstLabel)
  map.addLayer({
    id: 'lv-border-line',
    type: 'line',
    source: 'lv-border',
    layout: { 'line-join': 'round' },
    paint: {
      'line-color': '#dff4ff',
      'line-opacity': ['interpolate', ['linear'], ['zoom'], 9, 0.9, 11, 0],
      'line-width': ['interpolate', ['linear'], ['zoom'], 4, 0.8, 8, 1.3, 12, 2],
    },
  }, firstLabel)
}
