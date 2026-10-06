import type { Color } from '@deck.gl/core'
import { PolygonLayer } from '@deck.gl/layers'
import type { FeedPayload, WarningLevel, WeatherWarning } from '../../shared/feeds'
import { t } from '../i18n'
import { getPayload } from '../runtime/entityStore'
import { useFeeds } from '../state/feeds'
import type { LayerDef } from './types'

const FILL: Record<WarningLevel, Color> = {
  yellow: [255, 214, 92, 34],
  orange: [255, 138, 61, 54],
  red: [255, 77, 94, 70],
}

const LINE: Record<WarningLevel, Color> = {
  yellow: [255, 214, 92, 150],
  orange: [255, 138, 61, 190],
  red: [255, 77, 94, 220],
}

interface Area {
  ring: [number, number][]
  level: WarningLevel
}

let reportedFor: FeedPayload | null = null
let areasFor: WeatherWarning[] | null = null
let areas: Area[] = []

/** One drawable outline per affected area. Sea-area warnings carry no outlines and only appear as alerts. */
function areasOf(warnings: WeatherWarning[]): Area[] {
  if (warnings !== areasFor) {
    areasFor = warnings
    // Least severe first, so a red area is drawn on top of a yellow one covering the same ground.
    areas = [...warnings]
      .reverse()
      .flatMap((warning) => warning.polygons.map((ring) => ({ ring, level: warning.level })))
  }
  return areas
}

export const warningsLayer: LayerDef = {
  id: 'warnings',
  group: 'environment',
  label: t('Weather warnings'),
  hint: t('Official warnings in force or starting within a day (LVĢMC via MeteoAlarm). Warnings for sea areas are listed as alerts only'),
  defaultOn: true,
  swatch: '#ffd65c',
  feeds: ['warnings'],

  update() {
    const payload = getPayload('warnings', 'warnings')
    if (!payload || payload === reportedFor) return
    reportedFor = payload
    const count = (level: WarningLevel) => payload.warnings.filter((warning) => warning.level === level).length
    useFeeds.getState().report('warnings', {
      count: payload.warnings.length,
      stats: [
        { label: t('red'), value: count('red'), tone: 'danger' },
        { label: t('orange'), value: count('orange'), tone: 'mil' },
        { label: t('yellow'), value: count('yellow'), tone: 'warn' },
      ],
    })
  },

  dispose() {
    reportedFor = null
  },

  build() {
    const warnings = getPayload('warnings', 'warnings')?.warnings
    if (!warnings) return []
    return [
      new PolygonLayer<Area>({
        id: 'warnings',
        data: areasOf(warnings),
        getPolygon: (area) => area.ring,
        getFillColor: (area) => FILL[area.level],
        getLineColor: (area) => LINE[area.level],
        getLineWidth: 1,
        lineWidthUnits: 'pixels',
        stroked: true,
        filled: true,
      }),
    ]
  },
}
