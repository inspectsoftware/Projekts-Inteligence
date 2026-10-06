import type { Color } from '@deck.gl/core'
import { IconLayer, TextLayer } from '@deck.gl/layers'
import type { TransitMode, TransitVehicle } from '../../shared/adapters/transit'
import type { Entity } from '../../shared/entity'
import { t } from '../i18n'
import { formatLat, formatLon } from '../lib/coords'
import { formatAge, formatBearing, formatInt } from '../lib/format'
import { getIconAtlas } from '../map/icons'
import { positionAt } from '../map/motion'
import { getEntities } from '../runtime/entityStore'
import { HALO, LABEL_FONT, OUTLINE, SELECTED, iconScale, selectionRing } from './common'
import type { InspectorModel, LayerDef } from './types'

const MODE_COLOR: Record<TransitMode, Color> = {
  bus: [255, 196, 96],
  tram: [255, 128, 170],
  trolleybus: [126, 200, 255],
  minibus: [214, 214, 130],
}

const MODE_LABEL: Record<TransitMode, string> = {
  bus: t('Bus'),
  tram: t('Tram'),
  trolleybus: t('Trolleybus'),
  minibus: t('Minibus'),
}

/** Route numbers only become readable once a town fills a good part of the screen. */
const LABEL_ZOOM = 10.5

function describe(entity: Entity, now: number): InspectorModel {
  const vehicle = entity as TransitVehicle
  const { props } = vehicle
  const rows: InspectorModel['rows'] = [{ label: t('Network'), value: props.network }]
  if (props.vehicle) rows.push({ label: t('Vehicle'), value: props.vehicle })
  rows.push({ label: t('Speed'), value: `${formatInt((vehicle.spd ?? 0) * 3.6)} km/h` })
  if (vehicle.trk !== undefined && (vehicle.spd ?? 0) > 0.5) rows.push({ label: t('Heading'), value: formatBearing(vehicle.trk) })
  rows.push({ label: t('Position'), value: `${formatLat(vehicle.lat)}  ${formatLon(vehicle.lon)}` })
  rows.push({ label: t('Last update'), value: formatAge(now - vehicle.ts) })

  return {
    kicker: MODE_LABEL[props.mode],
    title: props.route ? t('Route {route}', { route: props.route }) : t('Not in service'),
    subtitle: props.network,
    badges: props.route ? [] : [{ text: t('No route'), tone: 'info' }],
    rows,
    links: [{ label: t('Timetables (marsruti.lv)'), href: 'https://marsruti.lv' }],
  }
}

export const transitLayer: LayerDef = {
  id: 'transit',
  group: 'land',
  label: t('Public transport'),
  hint: t('Buses, trams and minibuses in Liepāja and Rēzekne, and regional buses, where the operator publishes live positions'),
  defaultOn: true,
  swatch: '#ffc460',
  feeds: ['transit'],
  describes: ['transit'],
  describe,

  stats(entities) {
    const idle = (entities as TransitVehicle[]).filter((vehicle) => !vehicle.props.route).length
    return [{ label: t('not in service'), value: idle, tone: 'info' }]
  },

  build({ now, zoom, selectedId, hoveredId, fontsReady }) {
    const data = getEntities('transit') as TransitVehicle[]
    const { canvas, mapping } = getIconAtlas()
    const iconAtlas = canvas as unknown as string
    const scale = iconScale(zoom)
    const highlight = `${selectedId}|${hoveredId}`
    const colorOf = (vehicle: TransitVehicle): Color => {
      if (vehicle.id === selectedId || vehicle.id === hoveredId) return SELECTED
      const [r, g, b] = MODE_COLOR[vehicle.props.mode]
      // Vehicles without a route (depot moves, breaks) stay visible but step back.
      return vehicle.props.route ? [r, g, b] : [r, g, b, 110]
    }

    const icons = {
      data,
      iconAtlas,
      iconMapping: mapping,
      getIcon: () => 'bus' as const,
      getPosition: (vehicle: TransitVehicle) => positionAt(vehicle, now),
      getAngle: (vehicle: TransitVehicle) => -(vehicle.trk ?? 0),
      sizeUnits: 'pixels' as const,
      sizeScale: scale,
      billboard: false,
      updateTriggers: { getPosition: now },
    }

    return [
      new IconLayer<TransitVehicle>({ ...icons, id: 'transit-halo', getSize: 19, getColor: HALO }),
      new IconLayer<TransitVehicle>({
        ...icons,
        id: 'transit',
        pickable: true,
        getSize: 14,
        getColor: colorOf,
        updateTriggers: { ...icons.updateTriggers, getColor: highlight },
      }),
      selectionRing(
        'transit-selection',
        data.filter((vehicle) => vehicle.id === selectedId),
        now,
        15,
        scale,
      ),
      new TextLayer<TransitVehicle>({
        id: 'transit-labels',
        data,
        visible: fontsReady,
        getText: (vehicle) => vehicle.label ?? '',
        getPosition: (vehicle) => positionAt(vehicle, now),
        getSize: (vehicle) => (zoom >= LABEL_ZOOM || vehicle.id === selectedId || vehicle.id === hoveredId ? 10 : 0),
        getColor: (vehicle) => {
          const [r, g, b] = colorOf(vehicle)
          return [r, g, b, 235]
        },
        getPixelOffset: [9, -8],
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
