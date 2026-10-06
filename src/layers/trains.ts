import type { Color } from '@deck.gl/core'
import { IconLayer, PathLayer, TextLayer } from '@deck.gl/layers'
import type { Train } from '../../shared/adapters/trains'
import type { Entity } from '../../shared/entity'
import { formatLat, formatLon } from '../lib/coords'
import { formatAge, formatBearing, formatInt } from '../lib/format'
import { getIconAtlas } from '../map/icons'
import { positionAt } from '../map/motion'
import { getEntities } from '../runtime/entityStore'
import { getTrail } from '../runtime/trails'
import { HALO, LABEL_FONT, OUTLINE, SELECTED, iconScale, selectionRing } from './common'
import type { InspectorModel, LayerDef } from './types'

const ON_GPS: Color = [124, 255, 178]
/** Position worked out from the timetable, not measured. */
const ESTIMATED: Color = [96, 170, 132]

function describe(entity: Entity, now: number): InspectorModel {
  const train = entity as Train
  const { props } = train
  const badges: InspectorModel['badges'] = []
  if (props.stopped) badges.push({ text: 'At a stop', tone: 'info' })
  if (!props.gps) badges.push({ text: 'Position estimated', tone: 'warn' })

  const rows: InspectorModel['rows'] = []
  if (props.nextStop) {
    rows.push({ label: 'Next stop', value: props.nextStopTime ? `${props.nextStop} · ${props.nextStopTime}` : props.nextStop })
  }
  if (props.departure && props.arrival) rows.push({ label: 'Timetable', value: `${props.departure} → ${props.arrival}` })
  if (train.spd !== undefined) rows.push({ label: 'Speed', value: `${formatInt(train.spd * 3.6)} km/h (estimated)` })
  if (train.trk !== undefined && (train.spd ?? 0) > 1) rows.push({ label: 'Heading', value: formatBearing(train.trk) })
  rows.push({
    label: 'Position from',
    value: props.gps ? 'On-board GPS' : 'Timetable (no GPS signal)',
  })
  if (props.traction) rows.push({ label: 'Traction', value: props.traction === 'diesel' ? 'Diesel' : 'Electric' })
  rows.push({ label: 'Position', value: `${formatLat(train.lat)}  ${formatLon(train.lon)}` })
  rows.push({ label: 'Last update', value: formatAge(now - train.ts) })

  return {
    kicker: 'Passenger train',
    title: `Train ${props.number}`,
    subtitle: props.route ?? undefined,
    badges,
    rows,
    links: [{ label: 'Vivi live map', href: 'https://trainmap.vivi.lv' }],
  }
}

export const trainsLayer: LayerDef = {
  id: 'trains',
  group: 'land',
  label: 'Trains',
  hint: 'Passenger trains in service, from the operator’s own live map',
  defaultOn: true,
  swatch: '#7cffb2',
  feeds: ['trains'],
  describes: ['train'],
  describe,

  stats(entities) {
    const estimated = (entities as Train[]).filter((train) => !train.props.gps).length
    return [{ label: 'estimated', value: estimated, tone: 'warn' }]
  },

  build({ now, zoom, selectedId, hoveredId, fontsReady }) {
    const data = getEntities('trains') as Train[]
    const { canvas, mapping } = getIconAtlas()
    const iconAtlas = canvas as unknown as string
    const scale = iconScale(zoom)
    const highlight = `${selectedId}|${hoveredId}`
    const selected = data.filter((train) => train.id === selectedId)
    const colorOf = (train: Train): Color =>
      train.id === selectedId || train.id === hoveredId ? SELECTED : train.props.gps ? ON_GPS : ESTIMATED

    const icons = {
      data,
      iconAtlas,
      iconMapping: mapping,
      getIcon: () => 'train' as const,
      getPosition: (train: Train) => positionAt(train, now),
      getAngle: (train: Train) => -(train.trk ?? 0),
      sizeUnits: 'pixels' as const,
      sizeScale: scale,
      billboard: false,
      updateTriggers: { getPosition: now },
    }

    return [
      new PathLayer<Train>({
        id: 'trains-trails',
        data,
        getPath: (train) => [...(getTrail(train.id)?.path ?? []), positionAt(train, now)],
        getColor: (train) => {
          const [r, g, b] = colorOf(train)
          return [r, g, b, train.id === selectedId ? 220 : 80]
        },
        getWidth: (train) => (train.id === selectedId ? 2 : 1.2),
        widthUnits: 'pixels',
        jointRounded: true,
        capRounded: true,
        updateTriggers: { getPath: now, getColor: highlight, getWidth: selectedId },
      }),
      new IconLayer<Train>({ ...icons, id: 'trains-halo', getSize: 24, getColor: HALO }),
      new IconLayer<Train>({
        ...icons,
        id: 'trains',
        pickable: true,
        getSize: 18,
        getColor: colorOf,
        updateTriggers: { ...icons.updateTriggers, getColor: highlight },
      }),
      selectionRing('trains-selection', selected, now, 17, scale),
      new TextLayer<Train>({
        id: 'trains-labels',
        data,
        visible: fontsReady,
        getText: (train) => train.props.number,
        getPosition: (train) => positionAt(train, now),
        // Train numbers only earn their space once the map is close enough to tell the lines apart.
        getSize: (train) => (zoom >= 7.2 || train.id === selectedId || train.id === hoveredId ? 10.5 : 0),
        getColor: (train) => {
          const [r, g, b] = colorOf(train)
          return [r, g, b, 235]
        },
        getPixelOffset: [11, -9],
        getTextAnchor: 'start',
        getAlignmentBaseline: 'center',
        fontFamily: LABEL_FONT,
        fontWeight: 500,
        fontSettings: { sdf: true },
        outlineWidth: 2.5,
        outlineColor: OUTLINE,
        characterSet: 'auto',
        updateTriggers: { getPosition: now, getSize: `${zoom >= 7.2}|${highlight}`, getColor: highlight },
      }),
    ]
  },
}
