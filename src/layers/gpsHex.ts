import type { Color } from '@deck.gl/core'
import { PolygonLayer } from '@deck.gl/layers'
import type { FeedPayload, GpsCell } from '../../shared/feeds'
import { getPayload } from '../runtime/entityStore'
import { useFeeds } from '../state/feeds'
import type { LayerDef } from './types'

export type Interference = 'none' | 'some' | 'heavy' | 'unknown'

/**
 * How badly a cell is affected, the way gpsjam.org grades it: one aircraft with GPS
 * trouble is discounted (it could be that aircraft's own fault), then more than 10 %
 * affected is heavy and more than 2 % is some. A single passing aircraft says nothing.
 */
export function gradeCell(cell: Pick<GpsCell, 'good' | 'bad'>): Interference {
  const total = cell.good + cell.bad
  if (total < 2) return 'unknown'
  const share = Math.max(0, cell.bad - 1) / total
  if (share > 0.1) return 'heavy'
  if (share > 0.02) return 'some'
  return 'none'
}

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
  label: 'GPS interference',
  hint: 'Where aircraft reported degraded or lost GPS in the last 90 minutes. Red: more than 10 % of traffic affected, amber: more than 2 %, green: clean',
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
        { label: 'heavy', value: heavy, tone: 'danger' },
        { label: 'moderate', value: some, tone: 'warn' },
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
