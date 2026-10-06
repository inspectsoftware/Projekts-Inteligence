import type { Map } from 'maplibre-gl'
import { type BaseMode, RASTER_BASES } from './basemaps'
import { DARK_ONLY_LAYERS, FIRST_OVERLAY_LAYER } from './style'

const RASTER_ID = 'base-raster'

/** Swaps the raster imagery under the roads and labels, or removes it for the dark base. */
export function applyBaseMode(map: Map, mode: BaseMode, now = new Date()): void {
  if (map.getLayer(RASTER_ID)) map.removeLayer(RASTER_ID)
  if (map.getSource(RASTER_ID)) map.removeSource(RASTER_ID)

  for (const id of DARK_ONLY_LAYERS) {
    map.setLayoutProperty(id, 'visibility', mode === 'dark' ? 'visible' : 'none')
  }
  if (mode === 'dark') return

  const base = RASTER_BASES[mode]
  map.addSource(RASTER_ID, {
    type: 'raster',
    tiles: [base.tiles(now)],
    tileSize: 256,
    // Beyond this the source has no tiles; the map stretches the last level instead.
    maxzoom: base.maxzoom,
  })
  map.addLayer(
    {
      id: RASTER_ID,
      type: 'raster',
      source: RASTER_ID,
      paint: {
        'raster-brightness-max': base.brightnessMax,
        'raster-saturation': base.saturation,
        'raster-fade-duration': 200,
      },
    },
    FIRST_OVERLAY_LAYER,
  )
}
