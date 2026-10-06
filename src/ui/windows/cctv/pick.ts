import type { Cam, CamCountry } from '../../../../shared/feeds'
import { fold } from '../../../lib/search'

export interface CamFilter {
  /** The roadside and junction cameras instead of the hand-picked views. */
  roads: boolean
  country: CamCountry | 'all'
  query: string
}

/** The cameras a filter lets through, in the order the grid shows them. */
export function pickCams(cams: readonly Cam[], { roads, country, query }: CamFilter): Cam[] {
  const needle = fold(query.trim())
  return (
    cams
      .filter((cam) => Boolean(cam.road) === roads && (country === 'all' || cam.country === country))
      .filter((cam) => !needle || fold(`${cam.name} ${cam.place}`).includes(needle))
      // Pictures first: a wall of stills says more at a glance than a wall of play buttons.
      .sort((a, b) => Number(Boolean(b.kind === 'still' || b.poster)) - Number(Boolean(a.kind === 'still' || a.poster)))
  )
}
