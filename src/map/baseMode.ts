import type { Map } from 'maplibre-gl'
import { type BaseMode, RASTER_BASES } from './basemaps'
import { prefersReducedMotion } from './camera'
import { DARK_ONLY_LAYERS, FIRST_LAYER_OVER_PHOTOS, FIRST_OVERLAY_LAYER, IMAGERY_TEXT_COLOR } from './style'

/** Map source and layer id for one imagery source. */
export function rasterId(id: string): string {
  return `base-${id}`
}

/** Swaps the raster imagery under the roads and labels, or removes it for the dark base. */
export function applyBaseMode(map: Map, mode: BaseMode, now = new Date()): void {
  for (const { sources } of Object.values(RASTER_BASES)) {
    for (const source of sources) {
      const id = rasterId(source.id)
      if (map.getLayer(id)) map.removeLayer(id)
      if (map.getSource(id)) map.removeSource(id)
    }
  }

  const raster = mode !== 'dark'
  for (const id of DARK_ONLY_LAYERS) map.setLayoutProperty(id, 'visibility', raster ? 'none' : 'visible')
  for (const [id, dark, imagery] of IMAGERY_TEXT_COLOR) map.setPaintProperty(id, 'text-color', raster ? imagery : dark)
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
      source.coversStreets ? FIRST_LAYER_OVER_PHOTOS : FIRST_OVERLAY_LAYER,
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
