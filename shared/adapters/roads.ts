import type { Entity } from '../entity'

/** One feature out of a road-data vector tile: its attributes and where it is. */
export interface RoadRow {
  /** Tile layer it came from, which tells planned events from unplanned ones. */
  layer: string
  properties: Record<string, unknown>
  lon: number
  lat: number
}

export interface CameraProps {
  /** Road and kilometre post as the road authority writes it: "A2 (29.2km)". */
  road: string
  /** Path of the latest frame on this server. */
  image: string
}
export type Camera = Entity<CameraProps>

export type RoadEventCategory = 'accident' | 'hazard' | 'closure' | 'roadworks'

export interface RoadEventProps {
  category: RoadEventCategory
  /** The authority's own event type: "constructionWork", "animalsOnTheRoad"... */
  type: string
  road: string
  place: string | null
  notes: string | null
  detour: string | null
  contractor: string | null
  /** km/h. */
  speedLimit: number | null
  /** Epoch ms. */
  from: number | null
  until: number | null
  /** What is blocked: "lanesBlocked", "roadPartiallyObstructed"... */
  restrictions: string[]
}
export type RoadEvent = Entity<RoadEventProps>

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null)

/** "2026-10-06 06:05:55.742+00" as epoch ms. */
function timeOf(value: unknown): number | null {
  const ms = typeof value === 'string' ? Date.parse(value.replace(' ', 'T').replace(/([+-]\d\d)$/, '$1:00')) : NaN
  return Number.isFinite(ms) ? ms : null
}

/** "lanesBlocked" -> "lanes blocked" */
export const plainWords = (camelCase: string) => camelCase.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()

function categoryOf(type: string): RoadEventCategory | null {
  // "UVIS" entries are the maintainers' own job list; weight and size limits are a matter for hauliers.
  if (type === 'UVIS' || /restriction/i.test(type) || type === 'trucksForbidden') return null
  if (/accident/i.test(type)) return 'accident'
  if (type === 'roadClosed' || type === 'vehiclesForbidden') return 'closure'
  if (/works?$/i.test(type)) return 'roadworks'
  return 'hazard'
}

export function normaliseCameras(rows: readonly RoadRow[], receivedAt: number): Camera[] {
  const cameras = new Map<string, Camera>()
  for (const { properties: p, lon, lat } of rows) {
    const road = text(p.linear_reference)
    if (p.status !== 'active' || p.id === undefined || !road) continue
    // Neighbouring tiles overlap at their edges, so a camera can turn up twice.
    cameras.set(`camera:${p.id}`, {
      id: `camera:${p.id}`,
      kind: 'camera',
      lon,
      lat,
      label: road,
      ts: receivedAt,
      flags: 0,
      props: { road, image: `/api/camera/${p.id}` },
    })
  }
  return [...cameras.values()]
}

/** Roadworks, closures, accidents and hazards in force right now. */
export function normaliseRoadEvents(rows: readonly RoadRow[], now: number): RoadEvent[] {
  const events = new Map<string, RoadEvent>()
  for (const { layer, properties: p, lon, lat } of rows) {
    const type = text(p.event_enum)
    const category = type && categoryOf(type)
    const until = timeOf(p.date_to)
    if (!type || !category || p.status !== 'ACTIVE' || (until !== null && until < now)) continue

    // Planned and unplanned events are numbered separately. One event is also drawn several times
    // (as a line and as its end points): the first one seen stands for it.
    const id = `road-event:${layer.includes('notplanned') ? 'u' : 'p'}${p.id}`
    if (events.has(id)) continue
    const road = text(p.linear_reference) ?? 'Road'
    events.set(id, {
      id,
      kind: 'road-event',
      lon,
      lat,
      label: road,
      ts: timeOf(p.updated) ?? now,
      flags: 0,
      props: {
        category,
        type,
        road,
        place: text(p.geographic_name),
        notes: text(p.notes),
        detour: text(p.detour),
        contractor: text(p.contractor),
        speedLimit: typeof p.speed_limit === 'number' ? p.speed_limit : null,
        from: timeOf(p.date_from),
        until,
        // Arrives as the text of a Python list: "['lanesBlocked']", "[None]".
        restrictions: [...String(p.restrictions ?? '').matchAll(/'(\w+)'/g)].map((match) => match[1]).filter((r) => r !== 'NONE'),
      },
    })
  }
  return [...events.values()]
}
