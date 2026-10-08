import type { Map } from 'maplibre-gl'
import type { Aircraft } from '../../shared/entity'
import { AOI_BBOX, inBBox } from '../../shared/region'
import { VIEW_AIRCRAFT, aircraftLayer } from '../layers/aircraft'
import { isLayerOn, useLayers } from '../state/layers'
import { publishEntities } from './entityStore'

/** From here in, the circle the server asks about is a good part of what the map shows. */
const MIN_ZOOM = 5.5
const EVERY_MS = 10_000
/** A map being dragged about ends a move every second or two; it does not ask that often. */
const MIN_GAP_MS = 3000

/**
 * Keeps the aircraft around the middle of the map loaded while the view is outside the Baltic,
 * where the aircraft feed has none. One request every ten seconds at most, none while the tab is
 * hidden, the layer is off, or the map is zoomed out past where single aircraft can be told apart.
 */
export function startViewAircraft(map: Map): () => void {
  let stopped = false
  let shown = false
  let askedAt = 0

  const clear = () => {
    if (shown) publishEntities(VIEW_AIRCRAFT, [])
    shown = false
  }

  const tick = async () => {
    const { lng, lat } = map.getCenter()
    const wanted =
      !document.hidden &&
      map.getZoom() >= MIN_ZOOM &&
      !inBBox(lng, lat, AOI_BBOX) &&
      isLayerOn(useLayers.getState().visible, aircraftLayer.id, aircraftLayer.defaultOn)
    if (!wanted) return clear()
    if (Date.now() - askedAt < MIN_GAP_MS) return
    askedAt = Date.now()
    try {
      const res = await fetch(`/api/aircraft?lat=${lat.toFixed(2)}&lon=${lng.toFixed(2)}`)
      if (stopped || !res.ok) return
      const { entities } = (await res.json()) as { entities: Aircraft[] }
      // Those inside the region are the feed's to draw: it has them fresher, and with their trails.
      publishEntities(
        VIEW_AIRCRAFT,
        entities.filter((aircraft) => !inBBox(aircraft.lon, aircraft.lat, AOI_BBOX)),
      )
      shown = true
    } catch {
      // A refusal or a dropped connection leaves the last picture up until the next turn.
    }
  }

  const timer = setInterval(() => void tick(), EVERY_MS)
  const onMove = () => void tick()
  map.on('moveend', onMove)
  return () => {
    stopped = true
    clearInterval(timer)
    map.off('moveend', onMove)
    clear()
  }
}
