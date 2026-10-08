import { type Map, Marker } from 'maplibre-gl'
import { t } from '../i18n'
import { formatLat, formatLon, formatMgrs } from '../lib/coords'
import { useSelection } from '../state/selection'
import { prefersReducedMotion } from './camera'

let pin: Marker | null = null

/** Flies to a typed position, marks it and opens it in the inspector. The mark goes when the selection does. */
export function goToCoords(map: Map, lon: number, lat: number): void {
  pin?.remove()
  const marker = new Marker({ color: '#4fd6ff' }).setLngLat([lon, lat]).addTo(map)
  pin = marker
  useSelection.getState().selectFeature({
    lon,
    lat,
    model: {
      kicker: t('Coordinates'),
      title: `${formatLat(lat)}  ${formatLon(lon)}`,
      badges: [],
      rows: [
        { label: t('Latitude'), value: formatLat(lat) },
        { label: t('Longitude'), value: formatLon(lon) },
        { label: 'MGRS', value: formatMgrs(lon, lat) },
      ],
      links: [],
    },
  })
  const stop = useSelection.subscribe((state) => {
    if (state.feature?.lon === lon && state.feature.lat === lat) return
    stop()
    marker.remove()
    if (pin === marker) pin = null
  })
  map.flyTo({ center: [lon, lat], zoom: Math.max(map.getZoom(), 13), duration: prefersReducedMotion() ? 0 : 2200, essential: true })
}
