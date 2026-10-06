import type { WarningLevel, WeatherWarning } from '../feeds'
import { simplify } from '../geo/simplify'

/** The parts of MeteoAlarm's CAP-as-JSON feed that are read here. */
export interface CapFeed {
  warnings?: { uuid?: string; alert?: CapAlert }[]
}

interface CapAlert {
  identifier?: string
  sent?: string
  msgType?: string
  status?: string
  info?: CapInfo[]
}

interface CapInfo {
  language?: string
  event?: string
  severity?: string
  onset?: string
  effective?: string
  expires?: string
  description?: string
  parameter?: { valueName?: string; value?: string }[]
  area?: { areaDesc?: string; polygon?: string[] }[]
}

/** Warnings starting further ahead than this are left for later. */
const LOOK_AHEAD_MS = 24 * 60 * 60 * 1000
/** About 700 m: municipality outlines arrive far more detailed than a country-scale map can show. */
const TOLERANCE_DEG = 0.008
const MAX_DESCRIPTION = 600

const LEVEL_RANK: Record<WarningLevel, number> = { red: 0, orange: 1, yellow: 2 }
const SEVERITY_LEVEL: Record<string, WarningLevel> = { Moderate: 'yellow', Severe: 'orange', Extreme: 'red' }

const parameter = (info: CapInfo, name: string) => info.parameter?.find((p) => p.valueName === name)?.value

/** "2; yellow; Moderate" -> "yellow" */
function levelOf(info: CapInfo): WarningLevel | null {
  const colour = parameter(info, 'awareness_level')?.split(';')[1]?.trim().toLowerCase()
  if (colour === 'yellow' || colour === 'orange' || colour === 'red') return colour
  return SEVERITY_LEVEL[info.severity ?? ''] ?? null
}

/** "4; Fog" -> "Fog" */
function typeOf(info: CapInfo): string {
  const fromParameter = parameter(info, 'awareness_type')?.split(';')[1]?.trim()
  return fromParameter || info.event?.replace(/^(yellow|orange|red)\s+/i, '').replace(/\s+warning$/i, '') || 'Weather'
}

/** CAP polygons are "lat,lon lat,lon ..." strings; the map wants [lon, lat] pairs. */
function parsePolygon(text: string): [number, number][] {
  const ring: [number, number][] = []
  for (const pair of text.trim().split(/\s+/)) {
    const [lat, lon] = pair.split(',').map(Number)
    if (Number.isFinite(lat) && Number.isFinite(lon)) ring.push([lon, lat])
  }
  return ring
}

/**
 * Warnings that are in force now or start within a day, newest version of each, most
 * severe first. The feed also carries expired warnings and every superseded revision.
 */
export function normaliseWarnings(feed: CapFeed, now: number): WeatherWarning[] {
  const latest = new Map<string, WeatherWarning>()

  for (const item of feed.warnings ?? []) {
    const alert = item.alert
    if (!alert?.info?.length || alert.status !== 'Actual' || alert.msgType === 'Cancel') continue
    const info = alert.info.find((i) => i.language?.toLowerCase().startsWith('en')) ?? alert.info[0]

    const onset = Date.parse(info.onset ?? info.effective ?? '')
    const expires = Date.parse(info.expires ?? '')
    const level = levelOf(info)
    if (!level || !Number.isFinite(onset) || !Number.isFinite(expires)) continue
    if (expires <= now || onset > now + LOOK_AHEAD_MS) continue

    const areas: string[] = []
    const polygons: [number, number][][] = []
    for (const area of info.area ?? []) {
      if (area.areaDesc) areas.push(area.areaDesc)
      for (const text of area.polygon ?? []) {
        const ring = simplify(parsePolygon(text), TOLERANCE_DEG)
        if (ring.length >= 4) polygons.push(ring.map(([lon, lat]) => [round(lon), round(lat)]))
      }
    }

    const type = typeOf(info)
    const warning: WeatherWarning = {
      id: alert.identifier ?? item.uuid ?? `${type}-${onset}`,
      type,
      level,
      description: (info.description ?? '').trim().slice(0, MAX_DESCRIPTION),
      onset,
      expires,
      sent: Date.parse(alert.sent ?? '') || 0,
      areas,
      polygons,
    }

    // A revised warning repeats the same kind, level and places: keep only the newest.
    const key = `${type}|${level}|${[...areas].sort().join(';')}`
    const existing = latest.get(key)
    if (!existing || warning.sent >= existing.sent) latest.set(key, warning)
  }

  return [...latest.values()].sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level] || a.onset - b.onset)
}

const round = (value: number) => Math.round(value * 1e4) / 1e4
