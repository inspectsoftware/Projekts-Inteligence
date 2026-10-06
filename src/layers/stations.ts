import type { Color } from '@deck.gl/core'
import { ScatterplotLayer, TextLayer } from '@deck.gl/layers'
import type { Station } from '../../shared/adapters/stations'
import type { Entity } from '../../shared/entity'
import { formatAge, formatBearing, formatInt } from '../lib/format'
import { getEntities } from '../runtime/entityStore'
import { LABEL_FONT, OUTLINE, SELECTED, iconScale, selectionRing } from './common'
import type { InspectorModel, LayerDef } from './types'

/** Cold to hot, at the temperatures Latvia actually sees. */
const SCALE: [number, Color][] = [
  [-25, [120, 140, 255]],
  [-5, [110, 205, 255]],
  [8, [150, 235, 200]],
  [18, [255, 220, 110]],
  [30, [255, 95, 80]],
]

function temperatureColor(tempC: number | null): Color {
  if (tempC === null) return [140, 155, 168]
  if (tempC <= SCALE[0][0]) return SCALE[0][1]
  for (let i = 1; i < SCALE.length; i++) {
    const [t1, c1] = SCALE[i]
    if (tempC > t1) continue
    const [t0, c0] = SCALE[i - 1]
    const k = (tempC - t0) / (t1 - t0)
    return [0, 1, 2].map((j) => Math.round(c0[j] + (c1[j] - c0[j]) * k)) as [number, number, number]
  }
  return SCALE[SCALE.length - 1][1]
}

const value = (v: number | null, unit: string, digits = 0) => (v === null ? '–' : `${v.toFixed(digits)} ${unit}`)

function describe(entity: Entity, now: number): InspectorModel {
  const station = entity as Station
  const { props } = station
  const badges: InspectorModel['badges'] = []
  if ((props.lightning ?? 0) > 0) badges.push({ text: `${props.lightning} lightning strokes`, tone: 'warn' })
  if ((props.gustMs ?? 0) >= 20) badges.push({ text: 'Strong gusts', tone: 'warn' })

  const rows: InspectorModel['rows'] = [
    { label: 'Temperature', value: value(props.tempC, '°C', 1) },
    { label: 'Feels like', value: value(props.feelsC, '°C', 1) },
    {
      label: 'Wind',
      value:
        props.windMs === null
          ? '–'
          : `${props.windMs.toFixed(1)} m/s${props.windDir === null ? '' : ` from ${formatBearing(props.windDir)}`}`,
    },
    { label: 'Gusts', value: value(props.gustMs, 'm/s', 1) },
    { label: 'Humidity', value: value(props.humidity, '%') },
    { label: 'Pressure', value: value(props.pressureHpa, 'hPa', 1) },
    { label: 'Rain, last hour', value: value(props.precipMm, 'mm', 1) },
    {
      label: 'Visibility',
      value: props.visibilityM === null ? '–' : `${formatInt(props.visibilityM / 1000)} km`,
    },
    { label: 'Observed', value: formatAge(now - station.ts) },
  ]
  if (props.elevationM !== null) rows.push({ label: 'Station height', value: `${formatInt(props.elevationM)} m` })

  return {
    kicker: 'Weather station',
    title: props.name,
    subtitle: props.code,
    badges,
    rows,
    links: [{ label: 'LVĢMC observations', href: 'https://videscentrs.lvgmc.lv/' }],
  }
}

export const stationsLayer: LayerDef = {
  id: 'stations',
  group: 'environment',
  label: 'Weather stations',
  hint: 'Hourly observations from the national weather stations (LVĢMC)',
  defaultOn: false,
  swatch: '#96ebc8',
  feeds: ['stations'],
  describes: ['station'],
  describe,

  stats(entities) {
    const lightning = (entities as Station[]).filter((station) => (station.props.lightning ?? 0) > 0).length
    return [{ label: 'with lightning', value: lightning, tone: 'warn' }]
  },

  build({ now, zoom, selectedId, hoveredId, fontsReady }) {
    const data = getEntities('stations') as Station[]
    const highlight = `${selectedId}|${hoveredId}`
    const colorOf = (station: Station): Color =>
      station.id === selectedId || station.id === hoveredId ? SELECTED : temperatureColor(station.props.tempC)

    return [
      new ScatterplotLayer<Station>({
        id: 'stations',
        data,
        pickable: true,
        getPosition: (station) => [station.lon, station.lat],
        getRadius: 4,
        radiusUnits: 'pixels',
        getFillColor: colorOf,
        getLineColor: OUTLINE,
        getLineWidth: 1.5,
        lineWidthUnits: 'pixels',
        stroked: true,
        updateTriggers: { getFillColor: highlight },
      }),
      selectionRing(
        'stations-selection',
        data.filter((station) => station.id === selectedId),
        now,
        12,
        iconScale(zoom),
      ),
      new TextLayer<Station>({
        id: 'stations-labels',
        data,
        visible: fontsReady,
        getText: (station) => station.label ?? '',
        getPosition: (station) => [station.lon, station.lat],
        getSize: 11,
        getColor: (station) => [...(colorOf(station) as [number, number, number]), 240],
        getPixelOffset: [8, 0],
        getTextAnchor: 'start',
        getAlignmentBaseline: 'center',
        fontFamily: LABEL_FONT,
        fontWeight: 600,
        fontSettings: { sdf: true },
        outlineWidth: 2.5,
        outlineColor: OUTLINE,
        characterSet: 'auto',
        updateTriggers: { getColor: highlight },
      }),
    ]
  },
}
