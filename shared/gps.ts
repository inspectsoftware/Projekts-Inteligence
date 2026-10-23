import type { GpsCell } from './feeds'

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
