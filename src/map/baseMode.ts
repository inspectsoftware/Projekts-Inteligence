import type { Map } from 'maplibre-gl'
import { type BaseMode, RASTER_BASES } from './basemaps'
import { prefersReducedMotion } from './camera'
import { currentMapTheme } from '../state/ui'
import { DARK_ONLY_LAYERS, FIRST_LAYER_OVER_PHOTOS, FIRST_OVERLAY_LAYER, IMAGERY_TEXT_COLORS } from './style'

/** Map source and layer id for one imagery source. */
export function rasterId(id: string): string {
  return `base-${id}`
}

/** The tile addresses of the imagery each map shows now, so the same imagery is not laid again. */
const shown = new WeakMap<Map, string>()

/**
 * Where a photo that shows the streets for itself goes in: over the map's own street lines, under our
 * streets lane by lane (map/streets.ts) and the tracks. Our own tiles may come in after the photo, so
 * the answer changes once they have.
 */
function photoAnchor(map: Map): string {
  return ['streets-tunnel', 'own-rail', FIRST_LAYER_OVER_PHOTOS].find((id) => map.getLayer(id)) ?? FIRST_LAYER_OVER_PHOTOS
}

/** Swaps the raster imagery under the roads and labels, or removes it for the dark base. */
export function applyBaseMode(map: Map, mode: BaseMode, now = new Date()): void {
  const raster = mode !== 'dark'
  // Some are there only with our own tiles (map/ownStyle.ts), which may not be.
  for (const id of DARK_ONLY_LAYERS) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', raster ? 'none' : 'visible')
  for (const [id, plain, imagery] of IMAGERY_TEXT_COLORS[currentMapTheme()]) if (map.getLayer(id)) map.setPaintProperty(id, 'text-color', raster ? imagery : plain)

  // Sat and Sat 3D show the very same photos: going from one to the other keeps the tiles already in.
  const next = mode === 'dark' ? null : RASTER_BASES[mode]
  const wanted = next ? next.sources.map((source) => source.tiles(now)).join('|') : ''
  if (next && shown.get(map) === wanted && next.sources.every((source) => map.getLayer(rasterId(source.id)))) {
    // Same photos; only put them back where they belong, should our own layers have come in over them.
    for (const source of next.sources) if (source.coversStreets) map.moveLayer(rasterId(source.id), photoAnchor(map))
    return
  }
  shown.set(map, wanted)

  for (const { sources } of Object.values(RASTER_BASES)) {
    for (const source of sources) {
      const id = rasterId(source.id)
      if (map.getLayer(id)) map.removeLayer(id)
      if (map.getSource(id)) map.removeSource(id)
    }
  }
  if (mode === 'dark') return

  const base = RASTER_BASES[mode]
  for (const source of base.sources) {
    const id = rasterId(source.id)
    map.addSource(id, {
      type: 'raster',
      tiles: [source.tiles(now)],
      tileSize: 256,
      ...(source.minzoom !== undefined && { minzoom: source.minzoom }),
      maxzoom: source.maxzoom,
      ...(source.bounds && { bounds: source.bounds }),
    })
    // Each one goes in just under its anchor, so the last source ends up on top.
    map.addLayer(
      {
        id,
        type: 'raster',
        source: id,
        paint: {
          'raster-brightness-max': base.brightnessMax,
          'raster-saturation': base.saturation,
          'raster-fade-duration': 200,
        },
      },
      source.coversStreets ? photoAnchor(map) : FIRST_OVERLAY_LAYER,
    )
  }
}

/**
 * Sets how deep the camera may go. Lowering the limit under a camera that is already deeper makes
 * the map jump, so in that case the camera is eased out first and the limit follows it.
 * Returns a function that calls all of that off, for when the base changes again meanwhile.
 */
export function applyZoomCeiling(map: Map, ceiling: number): () => void {
  if (map.getZoom() <= ceiling) {
    map.setMaxZoom(ceiling)
    return () => {}
  }
  let easing = true
  const settle = () => {
    easing = false
    map.setMaxZoom(ceiling)
  }
  // Ending a flight already under way fires its own moveend: let that pass before listening.
  map.stop()
  map.once('moveend', settle)
  map.easeTo({ zoom: ceiling, duration: prefersReducedMotion() ? 0 : 900, essential: true })
  return () => {
    map.off('moveend', settle)
    // Left running, the camera would fly on to this limit under a base that allows more.
    if (easing) map.stop()
  }
}
