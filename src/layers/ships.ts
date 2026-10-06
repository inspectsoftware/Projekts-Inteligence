import type { Color } from '@deck.gl/core'
import { IconLayer, PathLayer, TextLayer } from '@deck.gl/layers'
import type { Ship, ShipType } from '../../shared/adapters/ships'
import { type Entity, Flag, KNOTS_TO_MS } from '../../shared/entity'
import { formatLat, formatLon, formatMgrs } from '../lib/coords'
import { formatAge, formatBearing } from '../lib/format'
import { getIconAtlas } from '../map/icons'
import { positionAt } from '../map/motion'
import { getEntities } from '../runtime/entityStore'
import { getTrail } from '../runtime/trails'
import { HALO, LABEL_FONT, OUTLINE, SELECTED, iconScale, selectionRing } from './common'
import type { InspectorModel, LayerDef } from './types'

const TYPE_COLOR: Record<ShipType, Color> = {
  cargo: [126, 214, 170],
  tanker: [255, 150, 122],
  passenger: [130, 182, 255],
  fishing: [240, 204, 120],
  service: [200, 204, 224],
  military: [255, 138, 61],
  pleasure: [214, 160, 255],
  other: [160, 190, 205],
}

const TYPE_LABEL: Record<ShipType, string> = {
  cargo: 'Cargo ship',
  tanker: 'Tanker',
  passenger: 'Passenger ship',
  fishing: 'Fishing vessel',
  service: 'Tug, pilot or rescue vessel',
  military: 'Military or law-enforcement vessel',
  pleasure: 'Pleasure craft',
  other: 'Vessel',
}

const SANCTIONED: Color = [255, 77, 94]
const LABEL_ZOOM = 8

const isSanctioned = (ship: Ship) => (ship.flags & Flag.SANCTIONED) !== 0

function describe(entity: Entity, now: number): InspectorModel {
  const ship = entity as Ship
  const { props } = ship
  const badges: InspectorModel['badges'] = []
  if (isSanctioned(ship)) badges.push({ text: 'On a sanctions list', tone: 'danger' })
  if (props.status) badges.push({ text: props.status, tone: 'info' })

  const rows: InspectorModel['rows'] = [{ label: 'Type', value: TYPE_LABEL[props.type] }]
  if (props.flagState) rows.push({ label: 'Flag', value: props.flagState })
  if (props.destination) rows.push({ label: 'Destination', value: props.destination })
  rows.push({ label: 'Speed', value: `${((ship.spd ?? 0) / KNOTS_TO_MS).toFixed(1)} kn` })
  if (ship.trk !== undefined && (ship.spd ?? 0) > 0.2) rows.push({ label: 'Course', value: formatBearing(ship.trk) })
  if (props.heading !== null) rows.push({ label: 'Heading', value: formatBearing(props.heading) })
  rows.push({ label: 'MMSI', value: String(props.mmsi) })
  if (props.imo) rows.push({ label: 'IMO', value: String(props.imo) })
  if (props.callSign) rows.push({ label: 'Call sign', value: props.callSign })
  rows.push({ label: 'Position', value: `${formatLat(ship.lat)}  ${formatLon(ship.lon)}` })
  rows.push({ label: 'MGRS', value: formatMgrs(ship.lon, ship.lat) })
  rows.push({ label: 'Last report', value: formatAge(now - ship.ts) })
  rows.push({ label: 'Heard by', value: props.source === 'aisstream' ? 'AISStream' : 'Digitraffic (Finland)' })

  return {
    kicker: 'Ship',
    title: props.name ?? `MMSI ${props.mmsi}`,
    subtitle: [props.flagState, props.imo ? `IMO ${props.imo}` : null].filter(Boolean).join(' · ') || undefined,
    badges,
    rows,
    links: [
      { label: 'MarineTraffic', href: `https://www.marinetraffic.com/en/ais/details/ships/mmsi:${props.mmsi}` },
      { label: 'VesselFinder', href: `https://www.vesselfinder.com/vessels/details/${props.imo ?? props.mmsi}` },
    ],
  }
}

export const shipsLayer: LayerDef = {
  id: 'ships',
  group: 'sea',
  label: 'Ships',
  hint: 'Vessels broadcasting AIS. Without an AISStream key only the northern approaches are covered (open Finnish data); with one, all Latvian waters',
  defaultOn: true,
  swatch: '#7ed6aa',
  feeds: ['ships'],
  describes: ['ship'],
  describe,

  stats(entities) {
    const ships = entities as Ship[]
    return [
      { label: 'sanctioned', value: ships.filter(isSanctioned).length, tone: 'danger' },
      { label: 'tankers', value: ships.filter((ship) => ship.props.type === 'tanker').length, tone: 'info' },
    ]
  },

  build({ now, zoom, selectedId, hoveredId, fontsReady }) {
    const data = getEntities('ships') as Ship[]
    const { canvas, mapping } = getIconAtlas()
    const iconAtlas = canvas as unknown as string
    const scale = iconScale(zoom)
    const highlight = `${selectedId}|${hoveredId}`
    const colorOf = (ship: Ship): Color => {
      if (ship.id === selectedId || ship.id === hoveredId) return SELECTED
      return isSanctioned(ship) ? SANCTIONED : TYPE_COLOR[ship.props.type]
    }
    const labelled = (ship: Ship) =>
      zoom >= LABEL_ZOOM || isSanctioned(ship) || ship.id === selectedId || ship.id === hoveredId

    const icons = {
      data,
      iconAtlas,
      iconMapping: mapping,
      getIcon: () => 'ship' as const,
      getPosition: (ship: Ship) => positionAt(ship, now),
      getAngle: (ship: Ship) => -(ship.trk ?? 0),
      sizeUnits: 'pixels' as const,
      sizeScale: scale,
      billboard: false,
      updateTriggers: { getPosition: now },
    }
    const sizeOf = (ship: Ship) => (isSanctioned(ship) ? 24 : 18)

    return [
      new PathLayer<Ship>({
        id: 'ships-trails',
        data,
        getPath: (ship) => [...(getTrail(ship.id)?.path ?? []), positionAt(ship, now)],
        getColor: (ship) => {
          const [r, g, b] = colorOf(ship)
          return [r, g, b, ship.id === selectedId ? 220 : 70]
        },
        getWidth: (ship) => (ship.id === selectedId ? 2 : 1.2),
        widthUnits: 'pixels',
        jointRounded: true,
        capRounded: true,
        updateTriggers: { getPath: now, getColor: highlight, getWidth: selectedId },
      }),
      new IconLayer<Ship>({ ...icons, id: 'ships-halo', getSize: (ship) => sizeOf(ship) + 6, getColor: HALO }),
      new IconLayer<Ship>({
        ...icons,
        id: 'ships',
        pickable: true,
        getSize: sizeOf,
        getColor: colorOf,
        updateTriggers: { ...icons.updateTriggers, getColor: highlight },
      }),
      selectionRing(
        'ships-selection',
        data.filter((ship) => ship.id === selectedId),
        now,
        17,
        scale,
      ),
      new TextLayer<Ship>({
        id: 'ships-labels',
        data,
        visible: fontsReady,
        getText: (ship) => ship.label ?? '',
        getPosition: (ship) => positionAt(ship, now),
        getSize: (ship) => (labelled(ship) ? 10.5 : 0),
        getColor: (ship) => {
          const [r, g, b] = colorOf(ship)
          return [r, g, b, 235]
        },
        getPixelOffset: [12, 9],
        getTextAnchor: 'start',
        getAlignmentBaseline: 'center',
        fontFamily: LABEL_FONT,
        fontWeight: 500,
        fontSettings: { sdf: true },
        outlineWidth: 2.5,
        outlineColor: OUTLINE,
        characterSet: 'auto',
        updateTriggers: { getPosition: now, getSize: `${zoom >= LABEL_ZOOM}|${highlight}`, getColor: highlight },
      }),
    ]
  },
}
