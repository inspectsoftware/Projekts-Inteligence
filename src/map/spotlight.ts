import type { Feature, FeatureCollection, MultiPolygon, Polygon, Position } from 'geojson'
import type { Map } from 'maplibre-gl'

type BorderCollection = FeatureCollection<Polygon | MultiPolygon>

/** Everything except Latvia: a world-sized polygon with the country cut out as holes. */
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
    // Only outer rings: lakes and enclaves inside the country stay lit.
    for (const rings of polygons) holes.push(rings[0])
  }
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [world, ...holes] } }
}

/** Dims the rest of the world and traces the national border. Sits above the basemap labels. */
export function addSpotlight(map: Map, border: BorderCollection): void {
  map.addSource('lv-mask', { type: 'geojson', data: buildMask(border) })
  map.addSource('lv-border', { type: 'geojson', data: border })

  map.addLayer({
    id: 'lv-mask',
    type: 'fill',
    source: 'lv-mask',
    paint: {
      'fill-color': '#04070a',
      // Ease off when zoomed in, so a border town's surroundings stay legible.
      'fill-opacity': ['interpolate', ['linear'], ['zoom'], 5, 0.62, 9, 0.5, 13, 0.3],
    },
  })
  map.addLayer({
    id: 'lv-border-glow',
    type: 'line',
    source: 'lv-border',
    layout: { 'line-join': 'round' },
    paint: {
      'line-color': '#4fd6ff',
      'line-opacity': 0.28,
      'line-blur': 6,
      'line-width': ['interpolate', ['linear'], ['zoom'], 4, 5, 8, 10, 12, 16],
    },
  })
  map.addLayer({
    id: 'lv-border-line',
    type: 'line',
    source: 'lv-border',
    layout: { 'line-join': 'round' },
    paint: {
      'line-color': '#dff4ff',
      'line-opacity': 0.9,
      'line-width': ['interpolate', ['linear'], ['zoom'], 4, 0.8, 8, 1.3, 12, 2],
    },
  })
}
