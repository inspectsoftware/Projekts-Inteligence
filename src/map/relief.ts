import type { Map } from 'maplibre-gl'
import { TILE_ORIGINS } from '../../shared/origins'
import { FIRST_LAYER_OVER_PHOTOS } from './style'

export const DEM_TILES = `${TILE_ORIGINS.mapterhorn}/{z}/{x}/{y}.webp`

// Two sources over the same tiles, as MapLibre asks: one shared between the ground mesh and the
// shading leaves seams in the shading. The browser's cache means each tile is still fetched once.
const DEM = 'relief-dem'
const SHADE_DEM = 'relief-shade-dem'
const SHADE = 'relief-shade'

/**
 * The Baltic states top out at 318 m, so true scale looks flat. Kept low all the same: the live
 * layers are drawn at sea level, and the higher the ground is lifted the further a tilted view
 * shifts them off it.
 * ponytail: live layers are not lifted onto the ground; give them map.queryTerrainElevation if
 * trains off their rails in the uplands start to matter.
 */
const EXAGGERATION = 2

/**
 * Lifts the ground into relief and shades it, or lays it flat again. Over imagery the extruded
 * buildings come back as well, since a photo's roofs stay flat. Call after applyBaseMode, which
 * hides them and puts its imagery where the shading would otherwise end up underneath.
 */
export function applyRelief(map: Map, on: boolean, imagery: boolean): void {
  if (on) {
    for (const id of [DEM, SHADE_DEM]) {
      if (!map.getSource(id)) map.addSource(id, { type: 'raster-dem', tiles: [DEM_TILES], tileSize: 512, encoding: 'terrarium', maxzoom: 12 })
    }
    if (!map.getTerrain()) map.setTerrain({ source: DEM, exaggeration: EXAGGERATION })
    if (map.getLayer(SHADE)) map.moveLayer(SHADE, FIRST_LAYER_OVER_PHOTOS)
    else {
      map.addLayer(
        {
          id: SHADE,
          type: 'hillshade',
          source: SHADE_DEM,
          paint: { 'hillshade-exaggeration': 0.6, 'hillshade-shadow-color': '#000000', 'hillshade-highlight-color': '#8fa9bb' },
        },
        FIRST_LAYER_OVER_PHOTOS,
      )
    }
  } else {
    if (map.getTerrain()) map.setTerrain(null)
    if (map.getLayer(SHADE)) map.removeLayer(SHADE)
  }
  if (imagery) map.setLayoutProperty('building-3d', 'visibility', on ? 'visible' : 'none')
  // Thinner over a photo, so the roofs it shows are still seen through the blocks.
  map.setPaintProperty('building-3d', 'fill-extrusion-opacity', imagery ? 0.6 : 0.92)
}
