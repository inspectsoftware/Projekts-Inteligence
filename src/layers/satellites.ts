import type { Color } from '@deck.gl/core'
import { IconLayer, PathLayer, TextLayer } from '@deck.gl/layers'
import type { Entity } from '../../shared/entity'
import type { OrbitalElement, SatGroup } from '../../shared/feeds'
import { formatLat, formatLon } from '../lib/coords'
import { formatBearing, formatInt } from '../lib/format'
import { getIconAtlas } from '../map/icons'
import { positionAt } from '../map/motion'
import { getEntities, getPayload, publishEntities } from '../runtime/entityStore'
import { type Region, type Satellite, type Tracked, groundTrack, nearRegion, satelliteId, satellitesIn, track } from '../sat/orbits'
import { useFeeds } from '../state/feeds'
import { HALO, LABEL_FONT, OUTLINE, SELECTED, iconScale, selectionRing } from './common'
import type { InspectorModel, LayerDef } from './types'

/** Entities this layer computes itself are published under this key. */
const SLOT = 'satellites'

/** Sub-satellite points are drawn inside this box: the camera's reach plus a margin to glide in from. */
const REGION: Region = { west: 3, south: 46, east: 46, north: 68 }
const COARSE_INTERVAL_MS = 20_000
const FINE_INTERVAL_MS = 1000
/** "Overhead" means at least this high above Rīga's horizon. */
const OVERHEAD_ELEVATION = 10

const GROUP_LABEL: Record<SatGroup, string> = {
  stations: 'Space station',
  military: 'Military',
  weather: 'Weather',
  resource: 'Earth observation',
  gnss: 'Navigation',
}

const GROUP_COLOR: Record<SatGroup, Color> = {
  stations: [255, 255, 255],
  military: [255, 138, 61],
  weather: [120, 200, 255],
  resource: [183, 140, 255],
  gnss: [120, 230, 160],
}

let source: OrbitalElement[] | null = null
let tracked: Tracked[] = []
let near: Tracked[] = []
let lastCoarse = 0
let lastFine = 0
let reported = ''

function reset(): void {
  source = null
  tracked = []
  near = []
  reported = ''
  if (getEntities(SLOT).length > 0) publishEntities(SLOT, [])
}

/** Exact positions for the satellites in view, published for the map and the inspector. */
function refresh(now: number): void {
  const entities = satellitesIn(near, now, REGION)
  publishEntities(SLOT, entities)

  // The layer list only needs telling when the numbers change, not every second.
  const overhead = entities.filter((sat) => sat.props.elevation >= OVERHEAD_ELEVATION).length
  const signature = `${entities.length}|${overhead}`
  if (signature !== reported) {
    reported = signature
    useFeeds.getState().report('satellites', {
      count: entities.length,
      stats: [{ label: 'above Rīga', value: overhead, tone: 'info' }],
    })
  }
}

let trackCache: { key: string; path: [number, number][] } | null = null

/** Ground track of the selected satellite, from a few minutes ago to a quarter of an hour ahead. */
function selectedTrack(id: string, now: number): [number, number][] {
  const key = `${id}|${Math.floor(now / 5000)}`
  if (trackCache?.key === key) return trackCache.path
  const sat = tracked.find(({ element }) => satelliteId(element) === id)
  const path = sat ? groundTrack(sat.rec, now, -4 * 60, 15 * 60, 20) : []
  trackCache = { key, path }
  return path
}

function describe(entity: Entity, now: number): InspectorModel {
  const sat = entity as Satellite
  const { props } = sat
  const ageHours = (now - Date.parse(`${props.epoch}Z`)) / 3_600_000
  const badges: InspectorModel['badges'] = [
    { text: GROUP_LABEL[props.group], tone: props.group === 'military' ? 'mil' : 'info' },
  ]
  if (props.elevation >= OVERHEAD_ELEVATION) badges.push({ text: 'Above Rīga', tone: 'ok' })

  return {
    kicker: 'Satellite',
    title: props.name,
    subtitle: `NORAD ${props.noradId}${props.intlDes ? ` · ${props.intlDes}` : ''}`,
    badges,
    rows: [
      { label: 'Altitude', value: `${formatInt((sat.alt ?? 0) / 1000)} km` },
      { label: 'Orbital speed', value: `${props.speedKmS.toFixed(2)} km/s` },
      { label: 'Ground track', value: formatBearing(sat.trk ?? 0) },
      { label: 'Elevation from Rīga', value: `${props.elevation.toFixed(1)}°` },
      { label: 'Azimuth from Rīga', value: formatBearing(props.azimuth) },
      { label: 'Slant range', value: `${formatInt(props.rangeKm)} km` },
      { label: 'Inclination', value: `${props.inclination.toFixed(1)}°` },
      { label: 'Period', value: `${props.periodMin.toFixed(1)} min` },
      { label: 'Below it', value: `${formatLat(sat.lat)}  ${formatLon(sat.lon)}` },
      { label: 'Orbit data age', value: Number.isFinite(ageHours) ? `${ageHours.toFixed(1)} h` : 'unknown' },
    ],
    links: [
      { label: 'N2YO', href: `https://www.n2yo.com/satellite/?s=${props.noradId}` },
      { label: 'CelesTrak catalogue', href: `https://celestrak.org/satcat/table-satcat.php?CATNR=${props.noradId}` },
    ],
  }
}

export const satellitesLayer: LayerDef = {
  id: 'satellites',
  group: 'space',
  label: 'Satellites',
  hint: 'Stations, weather, Earth-observation, military and navigation satellites passing over the region, computed live from orbital elements',
  defaultOn: true,
  swatch: '#b78cff',
  feeds: ['satellites'],
  describes: ['satellite'],
  describe,

  update(now) {
    const elements = getPayload('satellites', 'elements')?.sats
    if (!elements) {
      if (source) reset()
      return
    }
    if (elements !== source) {
      source = elements
      tracked = track(elements)
      lastCoarse = 0
    }
    if (now - lastCoarse >= COARSE_INTERVAL_MS) {
      lastCoarse = now
      near = nearRegion(tracked, now, COARSE_INTERVAL_MS + 5000, REGION)
      lastFine = 0
    }
    if (now - lastFine >= FINE_INTERVAL_MS) {
      lastFine = now
      refresh(now)
    }
  },

  dispose: reset,

  build({ now, zoom, selectedId, hoveredId, fontsReady }) {
    const data = getEntities(SLOT) as Satellite[]
    const { canvas, mapping } = getIconAtlas()
    const iconAtlas = canvas as unknown as string
    const scale = iconScale(zoom)
    const highlight = `${selectedId}|${hoveredId}`
    const selected = data.filter((sat) => sat.id === selectedId)
    const colorOf = (sat: Satellite): Color =>
      sat.id === selectedId || sat.id === hoveredId ? SELECTED : GROUP_COLOR[sat.props.group]

    const icons = {
      data,
      iconAtlas,
      iconMapping: mapping,
      getIcon: () => 'sat' as const,
      getPosition: (sat: Satellite) => positionAt(sat, now),
      getAngle: (sat: Satellite) => -(sat.trk ?? 0),
      sizeUnits: 'pixels' as const,
      sizeScale: scale,
      billboard: false,
      updateTriggers: { getPosition: now },
    }
    const sizeOf = (sat: Satellite) => (sat.props.group === 'stations' ? 26 : 19)

    return [
      new PathLayer<Satellite>({
        id: 'satellites-track',
        data: selected,
        getPath: (sat) => selectedTrack(sat.id, now),
        getColor: (sat) => [...(GROUP_COLOR[sat.props.group] as [number, number, number]), 170],
        getWidth: 1.4,
        widthUnits: 'pixels',
        updateTriggers: { getPath: Math.floor(now / 5000) },
      }),
      new IconLayer<Satellite>({ ...icons, id: 'satellites-halo', getSize: (sat) => sizeOf(sat) + 6, getColor: HALO }),
      new IconLayer<Satellite>({
        ...icons,
        id: 'satellites',
        pickable: true,
        getSize: sizeOf,
        getColor: colorOf,
        updateTriggers: { ...icons.updateTriggers, getColor: highlight },
      }),
      selectionRing('satellites-selection', selected, now, 19, scale),
      new TextLayer<Satellite>({
        id: 'satellites-labels',
        data,
        visible: fontsReady,
        getText: (sat) => sat.label ?? '',
        getPosition: (sat) => positionAt(sat, now),
        getSize: 10.5,
        getColor: (sat) => [...(colorOf(sat) as [number, number, number]), 235],
        getPixelOffset: [13, 11],
        getTextAnchor: 'start',
        getAlignmentBaseline: 'center',
        fontFamily: LABEL_FONT,
        fontWeight: 500,
        fontSettings: { sdf: true },
        outlineWidth: 2.5,
        outlineColor: OUTLINE,
        characterSet: 'auto',
        updateTriggers: { getPosition: now, getColor: highlight },
      }),
    ]
  },
}
