import { useSyncExternalStore } from 'react'
import type { Aircraft } from '../../../../shared/entity'
import { insideLatvia } from '../../../runtime/border'
import { getEntities, subscribeEntities } from '../../../runtime/entityStore'
import type { WindowBadge } from '../registry'
import { isAirborneMilitary } from './order'

/**
 * The Military window's badge: how many military aircraft are in the air across the region,
 * amber when one is over Latvia. Read from what the aircraft layer or the Air tab last fetched;
 * the badge itself never polls. (Kept out of the window's own file, which may only export components.)
 */
export function useMilitaryBadge(): WindowBadge | null {
  // Boiled down to a string, so the dock is only redrawn when the answer changes.
  const summary = useSyncExternalStore(subscribeEntities, () => {
    const airborne = (getEntities('aircraft') as Aircraft[]).filter(isAirborneMilitary)
    return `${airborne.length} ${airborne.some((a) => insideLatvia(a.lon, a.lat)) ? 'warn' : 'info'}`
  })
  const [count, tone] = summary.split(' ')
  return count === '0' ? null : { text: count, tone: tone as 'warn' | 'info' }
}
