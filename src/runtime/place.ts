import type { Map } from 'maplibre-gl'
import type { PlaceInfo } from '../../shared/feeds'
import { lang, t } from '../i18n'
import type { InspectorModel } from '../layers/types'
import { formatLat, formatLon, formatMgrs } from '../lib/coords'
import { formatInt } from '../lib/format'
import { prefersReducedMotion } from '../map/camera'
import { useSelection } from '../state/selection'

const waiting = (title: string): InspectorModel => ({ kicker: t('Place'), title, badges: [], rows: [], links: [] })

function describe(place: PlaceInfo, lon: number, lat: number): InspectorModel {
  const rows: InspectorModel['rows'] = []
  if (place.country) rows.push({ label: t('Country'), value: place.countryCode ? `${place.country} (${place.countryCode})` : place.country })
  if (place.population !== null) rows.push({ label: t('Population'), value: formatInt(place.population) })
  if (place.areaKm2 !== null) rows.push({ label: t('Area'), value: `${formatInt(place.areaKm2)} km²` })
  if (place.elevationM !== null) rows.push({ label: t('Elevation'), value: `${formatInt(place.elevationM)} m` })
  rows.push({ label: t('Latitude'), value: formatLat(lat) }, { label: t('Longitude'), value: formatLon(lon) }, { label: 'MGRS', value: formatMgrs(lon, lat) })

  const links: InspectorModel['links'] = []
  if (place.wiki) links.push({ label: 'Wikipedia', href: place.wiki })
  if (place.website) links.push({ label: t('Official site'), href: place.website })
  if (place.osm) links.push({ label: 'OpenStreetMap', href: place.osm })
  return {
    // OpenStreetMap's own word for what the place is: "village", "state", "country".
    kicker: place.kind.replaceAll('_', ' '),
    title: place.name,
    subtitle: place.chain.join(' · ') || undefined,
    note: place.extract ?? undefined,
    badges: [],
    rows,
    links,
  }
}

async function ask(query: string): Promise<PlaceInfo | null> {
  const res = await fetch(`/api/place?${query}&lang=${lang}`)
  return res.ok ? ((await res.json()) as PlaceInfo) : null
}

/** Whatever is still on show when the answer arrives is left alone: the reader has moved on. */
function showWhen(asked: InspectorModel, lon: number, lat: number, answer: Promise<InspectorModel>): void {
  const { selectFeature } = useSelection.getState()
  selectFeature({ lon, lat, model: asked })
  void answer
    .catch((): InspectorModel => ({ ...asked, badges: [{ text: t('Nothing known about this place'), tone: 'info' }] }))
    .then((model) => {
      if (useSelection.getState().feature?.model === asked) selectFeature({ lon, lat, model })
    })
}

/** Right-click on the map: what is the place under the cursor, at the scale the map is showing. */
export function whatIsHere(map: Map, lon: number, lat: number): void {
  const asked = waiting(`${formatLat(lat)}  ${formatLon(lon)}`)
  const answer = ask(`lon=${lon.toFixed(4)}&lat=${lat.toFixed(4)}&zoom=${Math.round(map.getZoom())}`).then((place) => {
    if (!place) throw new Error('not found')
    return describe(place, lon, lat)
  })
  showWhen(asked, lon, lat, answer)
}

/** A place anywhere on Earth by name: flies there and says what it is. */
export function searchWorld(map: Map, query: string): void {
  const { lng, lat } = map.getCenter()
  const asked = waiting(query)
  const answer = ask(`q=${encodeURIComponent(query)}`).then((place) => {
    if (!place) throw new Error('not found')
    const model = describe(place, place.lon, place.lat)
    // The answer has its own position: move the selection there before the swap below compares models.
    useSelection.getState().selectFeature({ lon: place.lon, lat: place.lat, model: asked })
    const options = { duration: prefersReducedMotion() ? 0 : 2200, essential: true }
    if (place.bbox) map.fitBounds(place.bbox, { ...options, padding: 80, maxZoom: 14 })
    else map.flyTo({ ...options, center: [place.lon, place.lat], zoom: 11 })
    return model
  })
  showWhen(asked, lng, lat, answer)
}
