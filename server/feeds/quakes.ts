import type { Entity } from '../../shared/entity'
import type { QuakeProps } from '../../shared/feeds'
import type { FeedDef } from './types'

const MINUTE = 60 * 1000
const USGS = 'https://earthquake.usgs.gov'

interface Summary {
  features: {
    id: string
    geometry: { coordinates: [number, number, number] } | null
    properties: { mag: number | null; place: string | null; time: number; url: string; tsunami: number; type: string }
  }[]
}

/** The summary as entities. Blasts and other events the survey lists are left out: only earthquakes. */
export function normaliseQuakes(summary: Summary): Entity<QuakeProps>[] {
  return summary.features.flatMap(({ id, geometry, properties }) => {
    if (!geometry || properties.type !== 'earthquake' || properties.mag === null) return []
    const [lon, lat, depthKm] = geometry.coordinates
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return []
    return [
      {
        id: `quake:${id}`,
        kind: 'quake' as const,
        lon,
        lat,
        label: `M ${properties.mag.toFixed(1)}`,
        ts: properties.time,
        flags: 0,
        props: { magnitude: properties.mag, depthKm: Number.isFinite(depthKm) ? depthKm : null, place: properties.place ?? '', tsunami: properties.tsunami === 1, url: properties.url },
      },
    ]
  })
}

/** Earthquakes of magnitude 2.5 and up anywhere on Earth in the last day, from the US Geological Survey (public domain). */
export const quakesFeed: FeedDef = {
  id: 'quakes',
  title: 'Earthquakes',
  origins: [USGS],
  ttlMs: 5 * MINUTE,
  staleMs: 6 * 60 * MINUTE,
  timeoutMs: 15_000,
  persist: true,
  attribution: [{ label: 'USGS Earthquake Hazards Program', href: `${USGS}/earthquakes/map/` }],
  async load({ http }) {
    return { shape: 'entities', entities: normaliseQuakes(await http.json<Summary>(`${USGS}/earthquakes/feed/v1.0/summary/2.5_day.geojson`)) }
  },
}
