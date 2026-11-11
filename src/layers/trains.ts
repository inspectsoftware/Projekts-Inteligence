import type { Color } from '@deck.gl/core'
import { IconLayer, TextLayer } from '@deck.gl/layers'
import type { Train } from '../../shared/adapters/trains'
import type { Entity } from '../../shared/entity'
import { t } from '../i18n'
import { formatLat, formatLon } from '../lib/coords'
import { formatAge, formatBearing, formatInt } from '../lib/format'
import { getIconAtlas, vehicleFill } from '../map/icons'
import { positionAt } from '../map/motion'
import { getEntities } from '../runtime/entityStore'
import { tripLayers } from './trip'
import { HALO, LABEL_FONT, OUTLINE, selectionRing } from './common'
import { PIN_ZOOM, pinLayer } from './pins'
import { vehiclesIn3d } from '../map/threeD'
import { CITY_ZOOM, DETAIL_PX, PICKED_SCALE, haloPx, vehicleIconPx } from './transit'
import type { InspectorModel, LayerDef } from './types'

/** The train icon's size in atlas units, as getSize uses it. */
const TRAIN_ICON = 18
/** Drawn a little longer than a tram, not at a train's full 80 m, which close in would cover the station. */
const TRAIN_METRES = 18
/** How much of the icon's square the train fills, nose to tail (map/icons.ts). */
const TRAIN_FILL = vehicleFill('train')

const ON_GPS: Color = [124, 255, 178]
/** Position worked out from the timetable, not measured. */
const ESTIMATED: Color = [96, 170, 132]

function describe(entity: Entity, now: number): InspectorModel {
  const train = entity as Train
  const { props } = train
  const badges: InspectorModel['badges'] = []
  if (props.stopped) badges.push({ text: t('At a stop'), tone: 'info' })
  if (!props.gps) badges.push({ text: t('Position estimated'), tone: 'warn' })

  const rows: InspectorModel['rows'] = []
  if (props.nextStop) {
    rows.push({ label: t('Next stop'), value: props.nextStopTime ? `${props.nextStop} · ${props.nextStopTime}` : props.nextStop })
  }
  if (props.destination) rows.push({ label: t('Destination'), value: props.destination })
  if (props.departure && props.arrival) rows.push({ label: t('Timetable'), value: `${props.departure} → ${props.arrival}` })
  if (train.spd !== undefined) rows.push({ label: t('Speed'), value: `${formatInt(train.spd * 3.6)} km/h (${t('estimated')})` })
  if (train.trk !== undefined && (train.spd ?? 0) > 1) rows.push({ label: t('Heading'), value: formatBearing(train.trk) })
  rows.push({
    label: t('Position from'),
    value: props.gps ? t('On-board GPS') : t('Timetable (no GPS signal)'),
  })
  if (props.traction) rows.push({ label: t('Traction'), value: props.traction === 'diesel' ? t('Diesel') : t('Electric') })
  rows.push({ label: t('Position'), value: `${formatLat(train.lat)}  ${formatLon(train.lon)}` })
  rows.push({ label: t('Last update'), value: formatAge(now - train.ts) })

  return {
    kicker: t('Passenger train'),
    title: t('Train {number}', { number: props.number }),
    subtitle: props.route ?? undefined,
    badges,
    rows,
    links: props.operator === 'elron' ? [{ label: 'elron.ee', href: 'https://elron.ee/' }] : [{ label: t('Vivi live map'), href: 'https://trainmap.vivi.lv' }],
  }
}

export const trainsLayer: LayerDef = {
  id: 'trains',
  group: 'land',
  label: t('Trains'),
  hint: t('Passenger trains in service in Latvia and Estonia, from the operators’ own live maps'),
  defaultOn: true,
  swatch: '#7cffb2',
  feeds: ['trains'],
  describes: ['train'],
  describe,

  stats(entities) {
    const estimated = (entities as Train[]).filter((train) => !train.props.gps).length
    return [{ label: t('estimated'), value: estimated, tone: 'warn' }]
  },

  build({ now, zoom, pitch, selectedId, hoveredId, fontsReady }) {
    // Tilted close in, the trains stand in 3D (map/vehicles3d.ts): their flat icons are left out.
    // Further out, each is its pin (layers/pins.ts) instead.
    const flat = zoom >= PIN_ZOOM && !vehiclesIn3d(zoom, pitch)
    // As buses are: not drawn with a whole country on screen, bar the one picked.
    const all = getEntities('trains') as Train[]
    const data = zoom < CITY_ZOOM ? all.filter((train) => train.id === selectedId) : all
    const { canvas, mapping } = getIconAtlas()
    const iconAtlas = canvas as unknown as string
    // As buses do: a small marker from afar, the train's own length on the map close in.
    const iconPx = vehicleIconPx(zoom, TRAIN_ICON, TRAIN_METRES, TRAIN_FILL)
    const scale = iconPx / TRAIN_ICON
    const highlight = `${selectedId}|${hoveredId}`
    const selected = data.filter((train) => train.id === selectedId)
    const colorOf = (train: Train): Color =>
      // In its own colour even when picked, as buses are: its ring and size say which one.
      train.props.gps ? ON_GPS : ESTIMATED
    const picked = (train: Train) => train.id === selectedId || train.id === hoveredId

    const icons = {
      data,
      iconAtlas,
      iconMapping: mapping,
      // Plain far out, its car joints shown only once it is large enough for them to read as joints.
      getIcon: () => (iconPx < DETAIL_PX ? ('train-halo' as const) : ('train' as const)),
      getPosition: (train: Train) => positionAt(train, now),
      getAngle: (train: Train) => -(train.trk ?? 0),
      sizeUnits: 'pixels' as const,
      sizeScale: scale,
      billboard: false,
      updateTriggers: { getPosition: now, getIcon: iconPx < DETAIL_PX },
    }

    return [
      // The selected train's route with its stations, under everything else of the layer.
      // Thin, like the railway it follows, so the map's own tracks and stations still show beside it.
      ...tripLayers(selected.length ? selectedId : null, ON_GPS, 2.5),
      // No trails: a train reports rarely and jumps when its GPS drops, so straight lines between
      // its fixes cut across the fields. The selected one's route, along the tracks, says more.
      // A plain silhouette, a thin dark edge wider each side at any size, showing through the windows and gaps.
      new IconLayer<Train>({
        ...icons,
        visible: flat,
        id: 'trains-halo',
        getIcon: () => 'train-halo' as const,
        getSize: (train) => (TRAIN_ICON + (2 * haloPx(iconPx)) / scale) * (picked(train) ? PICKED_SCALE : 1),
        getColor: HALO,
        updateTriggers: { ...icons.updateTriggers, getSize: `${Math.round(scale * 20)}|${highlight}` },
      }),
      new IconLayer<Train>({
        ...icons,
        visible: flat,
        id: 'trains',
        pickable: true,
        getSize: (train) => TRAIN_ICON * (picked(train) ? PICKED_SCALE : 1),
        getColor: colorOf,
        updateTriggers: { ...icons.updateTriggers, getColor: highlight, getSize: highlight },
      }),
      pinLayer('trains-pins', data, zoom, now, () => 'train', (train) => positionAt(train, now)),
      selectionRing('trains-selection', selected, now, 17, scale),
      new TextLayer<Train>({
        id: 'trains-labels',
        data,
        visible: fontsReady,
        getText: (train) => train.props.number,
        getPosition: (train) => positionAt(train, now),
        // Only the picked train's number: on every train they crowd the map.
        getSize: (train) => (picked(train) ? 10.5 : 0),
        getColor: (train) => {
          const [r, g, b] = colorOf(train)
          return [r, g, b, 235]
        },
        // Beside the icon, however long it is drawn.
        getPixelOffset: [Math.max(11, iconPx * 0.3 + 4), -9],
        getTextAnchor: 'start',
        getAlignmentBaseline: 'center',
        fontFamily: LABEL_FONT,
        fontWeight: 500,
        fontSettings: { sdf: true },
        outlineWidth: 2.5,
        outlineColor: OUTLINE,
        characterSet: 'auto',
        updateTriggers: { getPosition: now, getSize: highlight, getColor: highlight, getPixelOffset: Math.round(iconPx) },
      }),
    ]
  },
}
