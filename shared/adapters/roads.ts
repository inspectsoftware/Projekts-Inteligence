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
  /** Whose report it is; Latvia's where not said. */
  source?: RoadSource
  /** The report's own page, where it has one (Tallinn's street permits). */
  url?: string
}
export type RoadSource = 'lv' | 'lt' | 'ee' | 'tallinn'
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

// ---- Lithuania: Via Lietuva's restrictions list (restrictions.eismoinfo.lt) ----------------------

export interface LtRestriction {
  _id: string
  type?: string
  subtype?: string | null
  description?: string | null
  shortDescription?: string | null
  startTime?: string | null
  endTime?: string | null
  updateTime?: string | null
  location?: { polyline?: string | null; street?: string | null } | null
  restrictions?: { restrictionType?: string; value?: number | null }[] | null
}

/** Bridges too weak or damaged for heavy vehicles: a matter for hauliers, as Latvia's weight limits are. */
const LT_LEFT_OUT = new Set(['weakBridge', 'damagedBridge'])

/** Roadworks, closures and road damage in force in Lithuania, each at the middle of its stretch. */
export function normaliseLtRestrictions(list: readonly LtRestriction[], now: number): RoadEvent[] {
  const out: RoadEvent[] = []
  for (const item of list) {
    if (item.subtype && LT_LEFT_OUT.has(item.subtype)) continue
    const until = timeOf(item.endTime)
    if (until !== null && until < now) continue
    const from = timeOf(item.startTime)
    if (from !== null && from > now) continue
    // "lat lon lat lon…", WGS84.
    const numbers = String(item.location?.polyline ?? '').trim().split(/\s+/).map(Number)
    if (numbers.length < 2 || numbers.some((n) => !Number.isFinite(n))) continue
    const middle = Math.floor(numbers.length / 4) * 2
    const [lat, lon] = [numbers[middle], numbers[middle + 1]]
    const kinds = (item.restrictions ?? []).map((r) => r.restrictionType ?? '')
    const category: RoadEventCategory = kinds.includes('roadClosed') ? 'closure' : item.type === 'CONSTRUCTION' ? 'roadworks' : 'hazard'
    const notes = text(item.description) ?? text(item.shortDescription)
    const road = text(item.location?.street) ?? 'Road'
    const speed = item.restrictions?.find((r) => r.restrictionType === 'speedLimit')?.value
    out.push({
      id: `road-event:lt${item._id}`,
      kind: 'road-event',
      lon,
      lat,
      label: road,
      ts: timeOf(item.updateTime) ?? now,
      flags: 0,
      props: {
        category,
        type: item.subtype && item.subtype !== 'obstructionType' ? item.subtype : item.type === 'CONSTRUCTION' ? 'constructionWork' : 'obstruction',
        road,
        place: null,
        notes,
        detour: null,
        // Only ever inside the text: "Darbų vykdytojas: UAB …".
        // The name, without the phone number written after it: "UAB „Kelda“ tel. nr.: +370 …".
        contractor: notes?.match(/Darbų vykdytojas:\s*(.+?)(?:[,\s]+tel\b|\s*\+\d|[;\n]|\.\s|$)/)?.[1]?.replace(/[\s.,]+$/, '') || null,
        speedLimit: typeof speed === 'number' ? speed : null,
        from,
        until,
        // Their own codes (SVKD, LD…) are left out: only the named kinds read as words.
        restrictions: kinds.filter((kind) => /^[a-z]+[A-Z]\w*$/.test(kind) && kind !== 'speedLimit'),
        source: 'lt',
      },
    })
  }
  return out
}

// ---- Estonia: Transpordiamet's restrictions map (tarktee.ee), and Tallinn's street works --------

interface GeoPoint<P> {
  geometry?: { type?: string; coordinates?: number[] } | null
  properties?: P | null
}

export interface EeRestriction {
  objectid?: number
  road_nr?: number | null
  road_name?: string | null
  cause?: string | null
  effect?: string | null
  extra_info?: string | null
  detour_comment?: string | null
  contractor_organization?: string | null
  km_from?: number | null
  km_to?: number | null
  date_from?: number | null
  date_to?: number | null
}

const EE_CAUSE: Record<string, string> = {
  CONSTRUCTION: 'constructionWork',
  UTILITY_COMS_CONSTRUCTION: 'utilityWorks',
  STORAGE_OF_MATERIALS: 'storageOfMaterials',
  GEOLOGICAL_STUDIES: 'geologicalSurvey',
  SIDEWALK_CONSTRUCTION: 'pavementWorks',
  CULVERT_REPAIRS: 'culvertRepairs',
  GRAVEL_ROAD_REPAIRS: 'gravelRoadRepairs',
}
const EE_EFFECT: Record<string, string> = { COMPLETE_CLOSURE: 'roadClosed', ONE_WAY_CLOSED: 'oneDirectionClosed', LANE_CLOSED: 'lanesBlocked', SPEED_LIMITED: 'speedLimited' }

const km = (n: number) => `${Math.round(n * 10) / 10}`

/** Works and closures on Estonia's state roads (layer 0: one point each), already in WGS84 (outSR=4326). */
export function normaliseEeRestrictions(features: readonly GeoPoint<EeRestriction>[], now: number): RoadEvent[] {
  const out: RoadEvent[] = []
  for (const { geometry, properties: p } of features) {
    const [lon, lat] = geometry?.coordinates ?? []
    if (!p || !Number.isFinite(lon) || !Number.isFinite(lat) || p.objectid === undefined) continue
    if (p.date_to != null && p.date_to < now) continue
    const effect = p.effect ?? ''
    // Surveys and materials stacked by the road that change nothing for traffic.
    if (effect === 'OTHER' && (p.cause === 'GEOLOGICAL_STUDIES' || p.cause === 'STORAGE_OF_MATERIALS')) continue
    const road = [p.road_nr, text(p.road_name)].filter(Boolean).join(' ') || 'Road'
    const notes = text(p.extra_info)
    // No number of its own: "Kiirus piiratud 50 km/h" in the text.
    const speed = Number(notes?.match(/kiirus\s+piiratud\s+(\d+)\s*km/i)?.[1])
    out.push({
      id: `road-event:ee${p.objectid}`,
      kind: 'road-event',
      lon,
      lat,
      label: road,
      ts: now,
      flags: 0,
      props: {
        category: effect === 'COMPLETE_CLOSURE' ? 'closure' : 'roadworks',
        type: EE_CAUSE[p.cause ?? ''] ?? 'roadworks',
        road,
        place: p.km_from != null ? `km ${km(p.km_from)}${p.km_to != null && p.km_to !== p.km_from ? `–${km(p.km_to)}` : ''}` : null,
        notes,
        detour: text(p.detour_comment),
        contractor: text(p.contractor_organization),
        speedLimit: Number.isFinite(speed) && speed > 0 ? speed : null,
        from: p.date_from ?? null,
        until: p.date_to ?? null,
        restrictions: EE_EFFECT[effect] ? [EE_EFFECT[effect]] : [],
        source: 'ee',
      },
    })
  }
  return out
}

export interface TallinnWork {
  id?: number
  name?: string | null
  reason?: string | null
  work_type?: string | null
  description?: string | null
  proceeding_url?: string | null
  start_time?: number | null
  end_time?: number | null
}

/**
 * Tallinn's own street works: digs, and "Tänava ajutine sulgemine", a permit to close part of a
 * street, which is as often a lane or a pavement as the whole street. Both are drawn as roadworks.
 */
export function normaliseTallinnWorks(features: readonly GeoPoint<TallinnWork>[], now: number): RoadEvent[] {
  const out: RoadEvent[] = []
  for (const { geometry, properties: p } of features) {
    const [lon, lat] = geometry?.coordinates ?? []
    if (!p || !Number.isFinite(lon) || !Number.isFinite(lat) || p.id === undefined) continue
    if (p.end_time != null && p.end_time < now) continue
    const kind = text(p.work_type) ?? ''
    // "Kaevetöö - F. R. Kreutzwaldi tn 14/1": the address after the kind.
    const road = text(p.name)?.replace(/^[^-]*-\s*/, '') || 'Tallinn'
    const notes = [text(p.reason), text(p.description)].filter(Boolean).join('. ')
    const url = text(p.proceeding_url)
    out.push({
      id: `road-event:tln${p.id}`,
      kind: 'road-event',
      lon,
      lat,
      label: road,
      ts: now,
      flags: 0,
      props: {
        category: 'roadworks',
        type: /sulgemine/i.test(kind) ? 'streetClosed' : /avarii/i.test(kind) ? 'emergencyDigging' : 'digging',
        road,
        place: 'Tallinn',
        notes: notes ? notes.slice(0, 600) : null,
        detour: null,
        contractor: null,
        speedLimit: null,
        from: p.start_time ?? null,
        until: p.end_time ?? null,
        restrictions: [],
        source: 'tallinn',
        ...(url?.startsWith('https://') && { url }),
      },
    })
  }
  return out
}
