import type { Zone } from '../feeds'
import { simplify } from '../geo/simplify'

export type Ring = [number, number][]

/** Notices that start further ahead than this are left for later. */
export const ZONE_LOOK_AHEAD_MS = 48 * 60 * 60 * 1000
/** About 200 m: plenty at country scale, and it keeps an outline that follows a border small. */
const TOLERANCE_DEG = 0.002
const MAX_TEXT = 900

const round = (value: number) => Math.round(value * 1e4) / 1e4

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

/**
 * A source's markup as plain text, line by line. No markup survives, so nothing a publisher
 * wrote is ever rendered as HTML.
 */
export function plainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x?[0-9a-f]+|\w+);/gi, (whole, name: string) => {
      if (name[0] !== '#') return ENTITIES[name.toLowerCase()] ?? whole
      const code = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1))
      return code <= 0x10ffff ? String.fromCodePoint(code) : whole
    })
    .split(/\r?\n|\r/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
}

/** An outline as the map wants it: simplified and rounded. Null when too little is left to be an area. */
export function tidyRing(points: readonly [number, number][]): Ring | null {
  const ring = simplify(points, TOLERANCE_DEG).map(([lon, lat]): [number, number] => [round(lon), round(lat)])
  return ring.length >= 3 ? ring : null
}

/** The middle of some positions: good enough to fly to, not a true centroid. */
export function centreOf(points: readonly (readonly [number, number])[]): [number, number] | null {
  if (points.length === 0) return null
  // A closed ring names its first corner twice; counting it twice would pull the middle towards it.
  const [first, last] = [points[0], points[points.length - 1]]
  const open = points.length > 1 && first[0] === last[0] && first[1] === last[1] ? points.slice(0, -1) : points
  return [
    round(open.reduce((sum, point) => sum + point[0], 0) / open.length),
    round(open.reduce((sum, point) => sum + point[1], 0) / open.length),
  ]
}

/** Notices run to pages; the official page is one click away. */
export function clip(text: string): string {
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT).trimEnd()}…` : text
}

const SCHEDULE_GROUP = /^(DAILY|\d{2}(?:-\d{2})?(?: \d{2}(?:-\d{2})?)*) (\d{4}-\d{4}(?: \d{4}-\d{4})*)$/

/**
 * Whether a schedule covers this moment, for the two ways NOTAMs nearly always word one:
 * "DAILY 0500-1500", and days of the month with their hours, "02-24 0330-1630, 25-31 0430-1730".
 * All in UTC. Null for any other wording (weekdays, sunrise to sunset): better not to know than to guess.
 */
export function onSchedule(schedule: string, now: number): boolean | null {
  const date = new Date(now)
  const today = date.getUTCDate()
  const yesterday = new Date(now - 24 * 60 * 60 * 1000).getUTCDate()
  const time = date.getUTCHours() * 100 + date.getUTCMinutes()

  let on = false
  for (const group of schedule.trim().split(/\s*,\s*/)) {
    const match = SCHEDULE_GROUP.exec(group.replace(/\s+/g, ' '))
    if (!match) return null
    const days = match[1] === 'DAILY' ? null : match[1].split(' ').map((span) => span.split('-').map(Number))
    // "28-03" runs over the end of the month.
    const listed = (day: number) =>
      !days || days.some(([first, last = first]) => (first <= last ? day >= first && day <= last : day >= first || day <= last))
    for (const [start, end] of match[2].split(' ').map((span) => span.split('-').map(Number))) {
      const overnight = start > end
      if (listed(today) && time >= start && (overnight || time <= end)) on = true
      // "2200-0400" ends on the morning after the day it is listed under.
      if (overnight && listed(yesterday) && time <= end) on = true
    }
  }
  return on
}

/**
 * Where a zone stands at this moment: in force, still to come, inside its period but outside its
 * hours ('idle'), or inside its period with times that could not be read ('unsure').
 */
export type ZoneState = 'active' | 'pending' | 'idle' | 'unsure'

export function zoneState(zone: Pick<Zone, 'from' | 'to' | 'schedule' | 'unsure'>, now: number): ZoneState {
  if (zone.from !== null && zone.from > now) return 'pending'
  if (zone.to !== null && zone.to <= now) return 'idle'
  if (zone.unsure) return 'unsure'
  const on = zone.schedule ? onSchedule(zone.schedule, now) : true
  return on === null ? 'unsure' : on ? 'active' : 'idle'
}

/** In force, or about to be. */
export function isCurrent(zone: Pick<Zone, 'from' | 'to'>, now: number): boolean {
  return (zone.to === null || zone.to > now) && (zone.from === null || zone.from <= now + ZONE_LOOK_AHEAD_MS)
}

/** What matters first: military before routine, then in the order they take effect. */
export function sortZones(zones: Zone[]): Zone[] {
  return zones.sort((a, b) => Number(b.military) - Number(a.military) || (a.from ?? 0) - (b.from ?? 0))
}
