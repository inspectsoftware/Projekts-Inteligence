import type { Feature, FeatureCollection } from 'geojson'
import type { ExpressionSpecification, GeoJSONSource, LayerSpecification, Map as MapLibreMap } from 'maplibre-gl'
import { type ZoneState, isCurrent, zoneState } from '../../shared/adapters/zones'
import type { FeedId, FeedPayload, Zone } from '../../shared/feeds'
import { getMap } from '../map/instance'
import { serverNow } from '../runtime/clock'
import { getPayload } from '../runtime/entityStore'
import { useFeeds } from '../state/feeds'
import { isLayerOn, useLayers } from '../state/layers'
import { useSelection } from '../state/selection'
import type { InspectorModel, LayerDef, StaticSelection } from './types'

/**
 * Where military activity is announced before it happens: navigational warnings at sea and
 * airspace closed by NOTAM. Areas and positions, not moving things, so the map draws them itself.
 */
const MIL = '#ff8a3d'

const RIGA_TIME = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Riga',
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

/** Only a zone known to apply at this moment is called in force: one with hours this site cannot read is not. */
const STATE_BADGE: Record<ZoneState, InspectorModel['badges'][number]> = {
  active: { text: 'In force', tone: 'warn' },
  pending: { text: 'Not yet in force', tone: 'info' },
  idle: { text: 'Outside its hours', tone: 'info' },
  unsure: { text: 'See notice for times', tone: 'info' },
}

/** A zone as the inspector shows it, standing at `at`. */
export function zoneSelection(zone: Zone, at: [number, number], now: number): StaticSelection {
  return {
    lon: at[0],
    lat: at[1],
    model: {
      kicker: zone.kind === 'sea' ? 'Sea warning' : 'Airspace restriction',
      title: zone.title,
      subtitle: zone.issuer,
      badges: [{ text: zone.type, tone: zone.military ? 'mil' : 'info' }, STATE_BADGE[zoneState(zone, now)]],
      rows: [
        { label: 'From (Rīga)', value: zone.from === null ? 'Not stated' : RIGA_TIME.format(zone.from) },
        { label: 'Until (Rīga)', value: zone.to === null ? 'Until withdrawn' : RIGA_TIME.format(zone.to) },
        ...(zone.schedule ? [{ label: 'Hours (UTC)', value: zone.schedule }] : []),
        // The inspector lays a row out on one line and wraps it: the notice's own line breaks would be lost without a mark.
        { label: 'Notice', value: zone.text.replaceAll('\n', ' · ') },
      ],
      links: [{ label: 'Official page', href: zone.href }],
    },
  }
}

const closed = (ring: [number, number][]) => {
  const [first, last] = [ring[0], ring[ring.length - 1]]
  return first[0] === last[0] && first[1] === last[1] ? ring : [...ring, first]
}

const extent = (rings: [number, number][][]) => {
  const lons = rings.flat().map((point) => point[0])
  const lats = rings.flat().map((point) => point[1])
  return { west: Math.min(...lons), south: Math.min(...lats), east: Math.max(...lons), north: Math.max(...lats) }
}

const size = (zone: Zone) => {
  if (zone.rings.length === 0) return 0
  const { west, south, east, north } = extent(zone.rings)
  return (east - west) * (north - south)
}

function featuresOf(zones: readonly Zone[], now: number): FeatureCollection {
  const features: Feature[] = []
  // What is drawn last lies on top, and is what a click reaches. So: a small area over a large one, and of
  // several notices for one area (today's and tomorrow's) the one in force, a military one over a routine one.
  const order = zones
    .map((zone) => ({ zone, active: zoneState(zone, now) === 'active' }))
    .sort((a, b) => size(b.zone) - size(a.zone) || Number(a.active) - Number(b.active) || Number(a.zone.military) - Number(b.zone.military))
  for (const { zone, active } of order) {
    const properties = { id: zone.id, military: zone.military, active }
    if (zone.rings.length > 0) {
      features.push({ type: 'Feature', geometry: { type: 'MultiPolygon', coordinates: zone.rings.map((ring) => [closed(ring)]) }, properties })
    } else if (zone.point) {
      features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: zone.point }, properties })
    }
  }
  return { type: 'FeatureCollection', features }
}

const military: ExpressionSpecification = ['==', ['get', 'military'], true]
const areas: ExpressionSpecification = ['==', ['geometry-type'], 'Polygon']
/** What is announced but not in force at this moment is drawn fainter. */
const faded = (opacity: number): ExpressionSpecification => ['case', ['==', ['get', 'active'], true], opacity, opacity * 0.45]

function zoneLayer(def: Pick<LayerDef, 'id' | 'group' | 'label' | 'hint'>, feed: FeedId): LayerDef {
  const source = `zones-${def.id}`
  // Military zones get a filled area and a solid outline; routine ones a faint area and a dashed outline.
  const specs: LayerSpecification[] = [
    {
      id: `${source}-fill`,
      type: 'fill',
      source,
      filter: areas,
      paint: { 'fill-color': MIL, 'fill-opacity': ['case', military, faded(0.2), faded(0.05)] },
    },
    {
      id: `${source}-outline`,
      type: 'line',
      source,
      filter: ['all', areas, military],
      paint: { 'line-color': MIL, 'line-width': 1.6, 'line-opacity': faded(0.95) },
    },
    {
      id: `${source}-outline-routine`,
      type: 'line',
      source,
      filter: ['all', areas, ['!', military]],
      paint: { 'line-color': MIL, 'line-width': 1, 'line-opacity': faded(0.6), 'line-dasharray': [3, 2] },
    },
    {
      // A warning that names a position, not an area.
      id: `${source}-point`,
      type: 'circle',
      source,
      filter: ['==', ['geometry-type'], 'Point'],
      paint: {
        'circle-radius': ['case', military, 5, 3.5],
        'circle-color': ['case', military, MIL, '#05080b'],
        'circle-opacity': faded(0.9),
        'circle-stroke-color': ['case', military, '#05080b', MIL],
        'circle-stroke-width': 1.3,
        'circle-stroke-opacity': faded(0.9),
      },
    },
  ]

  let map: MapLibreMap | null = null
  /** The snapshot the map was last filled from, and the minute it was done in. */
  let drawn: FeedPayload | null = null
  let drawnMinute = 0

  return {
    ...def,
    defaultOn: false,
    swatch: MIL,
    feeds: [feed],
    native: {
      interactive: [`${source}-point`, `${source}-fill`],
      show(target) {
        map = target
        drawn = null
        if (!target.getSource(source)) target.addSource(source, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
        for (const spec of specs) if (!target.getLayer(spec.id)) target.addLayer(spec)
      },
      hide() {
        for (const spec of specs) if (map?.getLayer(spec.id)) map.removeLayer(spec.id)
        if (map?.getSource(source)) map.removeSource(source)
        map = null
      },
      pick(properties, lon, lat) {
        const zone = getPayload(feed, 'zones')?.zones.find((one) => one.id === properties.id)
        return zone ? zoneSelection(zone, [lon, lat], serverNow()) : null
      },
    },

    update(now) {
      const payload = getPayload(feed, 'zones')
      const minute = Math.floor(now / 60_000)
      if (!map || !payload || (payload === drawn && minute === drawnMinute)) return
      // Redrawn every minute as well as with every snapshot: zones come into force and run out in between.
      const zones = payload.zones.filter((zone) => isCurrent(zone, now))
      ;(map.getSource(source) as GeoJSONSource | undefined)?.setData(featuresOf(zones, now))
      if (payload !== drawn) {
        useFeeds.getState().report(feed, {
          count: payload.zones.length,
          stats: [{ label: 'military', value: payload.zones.filter((zone) => zone.military).length, tone: 'mil' }],
        })
      }
      drawn = payload
      drawnMinute = minute
    },

    dispose() {
      drawn = null
    },

    build: () => [],
  }
}

export const seaWarningsLayer = zoneLayer(
  {
    id: 'sea-warnings',
    group: 'sea',
    label: 'Sea warnings',
    hint: 'Navigational warnings in force or starting within two days, Baltic-wide: exercise, firing and danger areas in solid orange, routine notices dashed. Not for navigation',
  },
  'navwarn',
)

export const airspaceLayer = zoneLayer(
  {
    id: 'airspace',
    group: 'air',
    label: 'Airspace restrictions',
    hint: 'Airspace closed, reserved or dangerous by NOTAM, in force or starting within two days, over Latvia and Estonia: military activity in solid orange, the rest dashed. Not for flight planning',
  },
  'airspace',
)

/** Switches the zone's layer on, flies to the zone and opens it in the inspector. A zone that is only text has nowhere to fly to. */
export function showZone(zone: Zone): void {
  const layer = zone.kind === 'sea' ? seaWarningsLayer : airspaceLayer
  const { visible, toggle } = useLayers.getState()
  if (!isLayerOn(visible, layer.id, layer.defaultOn)) toggle(layer.id, layer.defaultOn)
  if (!zone.point) return

  useSelection.getState().selectFeature(zoneSelection(zone, zone.point, serverNow()))
  const { west, south, east, north } = extent(zone.rings.length > 0 ? zone.rings : [[zone.point]])
  getMap()?.fitBounds([west, south, east, north], { padding: 120, maxZoom: 9, duration: 1400 })
}
