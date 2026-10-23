import type { Color } from '@deck.gl/core'
import { PolygonLayer } from '@deck.gl/layers'
import type { FeedPayload, GpsCell } from '../../shared/feeds'
import { type Interference, gradeCell } from '../../shared/gps'
import { t } from '../i18n'
import { getPayload } from '../runtime/entityStore'
import { useFeeds } from '../state/feeds'
import type { LayerDef } from './types'

export { type Interference, gradeCell }

const FILL: Record<Interference, Color> = {
  heavy: [255, 77, 94, 105],
  some: [255, 176, 32, 85],
  none: [61, 220, 151, 26],
  unknown: [120, 140, 155, 14],
}

const LINE: Record<Interference, Color> = {
  heavy: [255, 77, 94, 210],
  some: [255, 176, 32, 170],
  none: [61, 220, 151, 60],
  unknown: [120, 140, 155, 40],
}

let reportedFor: FeedPayload | null = null

export const gpsHexLayer: LayerDef = {
  id: 'gps-hex',
  group: 'signals',
  label: t('GPS interference'),
  hint: t('Where aircraft reported degraded or lost GPS in the last 90 minutes. Red: more than 10 % of traffic affected, amber: more than 2 %, green: clean'),
  defaultOn: true,
  swatch: '#ff4d5e',
  feeds: ['gps-hex'],

  update() {
    const payload = getPayload('gps-hex', 'cells')
    if (!payload || payload === reportedFor) return
    reportedFor = payload
    const grades = payload.cells.map(gradeCell)
    const heavy = grades.filter((grade) => grade === 'heavy').length
    const some = grades.filter((grade) => grade === 'some').length
    useFeeds.getState().report('gps-hex', {
      count: heavy + some,
      stats: [
        { label: t('heavy'), value: heavy, tone: 'danger' },
        { label: t('moderate'), value: some, tone: 'warn' },
      ],
    })
  },

  dispose() {
    reportedFor = null
  },

  build() {
    const cells = getPayload('gps-hex', 'cells')?.cells
    if (!cells) return []
    return [
      new PolygonLayer<GpsCell>({
        id: 'gps-hex',
        data: cells,
        getPolygon: (cell) => cell.boundary,
        getFillColor: (cell) => FILL[gradeCell(cell)],
        getLineColor: (cell) => LINE[gradeCell(cell)],
        getLineWidth: 1,
        lineWidthUnits: 'pixels',
        stroked: true,
        filled: true,
      }),
    ]
  },
}
