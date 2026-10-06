import type { Zone } from '../feeds'
import { msg } from '../i18n'
import { type Ring, centreOf, clip, isCurrent, plainText, sortZones, tidyRing } from './zones'

export const NAVTEX_PAGE = 'https://navvarn.sjofartsverket.se/en/Navigationsvarningar/Navtex'
export const ESTONIAN_PAGE = 'https://gis.transpordiamet.ee/navhoiatused/en.html'

const DAY_MS = 24 * 60 * 60 * 1000

// ---- What a notice is about ---------------------------------------------------------------

/** First match wins. The flag says whether it counts as military or security activity. */
const KINDS: readonly [RegExp, string, boolean][] = [
  [/GNSS|GPS|JAMMING|INTERFERENCE/, msg('GNSS interference'), true],
  [/FIRING|GUNNERY|MISSILE|ROCKET/, msg('Firing practice'), true],
  [/(NAVAL|SHIPS?) EXERCIS/, msg('Naval exercise'), true],
  [/EXERCIS/, msg('Military exercise'), true],
  [/\bMINES?\b|MINE-LIKE|MINEFIELD/, msg('Mine danger'), true],
  // How a closed firing or exercise area is announced when no reason is given.
  [/DANGEROUS (TO|FOR) (SHIPPING|NAVIGATION)/, msg('Danger area'), true],
  [/UNMANNED|DRONE/, msg('Unmanned systems trials'), false],
  [/CABLE|PIPELINE/, msg('Cable works'), false],
  [/DREDG/, msg('Dredging'), false],
  [/LIGHT|BUOY|RACON|BEACON|ATON/, msg('Navigation aid'), false],
]

function classify(text: string): Pick<Zone, 'type' | 'military'> {
  // "NAVAL EXERCISES (WITHOUT FIRINGS)" is not firing practice, and "EXERCISE CAUTION" is no exercise.
  const wording = text.toUpperCase().replace(/WITHOUT FIRINGS?|EXERCISE (\w+ )?CAUTION/g, '')
  const [, type, military] = KINDS.find(([pattern]) => pattern.test(wording)) ?? [null, msg('Navigational warning'), false]
  return { type, military }
}

// ---- Validity periods ----------------------------------------------------------------------

const MONTHS: Record<string, number> = {
  JAN: 0,
  FEB: 1,
  MAR: 2,
  APR: 3,
  MAY: 4,
  MAI: 4,
  JUN: 5,
  JUL: 6,
  AUG: 7,
  SEP: 8,
  OCT: 9,
  OKT: 9,
  NOV: 10,
  DEC: 11,
  DEZ: 11,
}
const MON = `(${Object.keys(MONTHS).join('|')})`
const DAY = String.raw`(0[1-9]|[12]\d|3[01])`
const TIME = String.raw`((?:[01]\d|2[0-3])[0-5]\d)`
const UNTIL = String.raw`\s+(?:THRU|TO|UNTIL|TILL)\s+`

/** One end of a period as written: a day of the month, a clock time, and the month if it is named. */
interface Moment {
  day: string
  hhmm: string
  month?: number
}

/** A period as written. `daily` when it holds only between those hours on each of its days. */
interface Written {
  start: Moment
  end: Moment & { month: number }
  daily?: boolean
}

/** The ways a period is written on the page, each read into its two ends. */
const PERIODS: readonly [RegExp, (m: string[]) => Written][] = [
  // "302100 UTC SEP THRU 312100 UTC OCT", "070700 THRU 081400 UTC OCT", "022100 TO 102100 OCT UTC"
  [
    new RegExp(String.raw`\b${DAY}${TIME}(?:\s+UTC)?(?:\s+${MON})?(?:\s+UTC)?${UNTIL}${DAY}${TIME}(?:\s+UTC)?\s+${MON}\b`, 'g'),
    (m) => ({
      start: { day: m[1], hhmm: m[2], month: m[3] ? MONTHS[m[3]] : undefined },
      end: { day: m[4], hhmm: m[5], month: MONTHS[m[6]] },
    }),
  ],
  // "FROM 27 SEP 2201 UTC TO 07 OCT 2159 UTC"
  [
    new RegExp(String.raw`\b(\d{1,2})\s+${MON}\s+${TIME}\s+UTC${UNTIL}(\d{1,2})\s+${MON}\s+${TIME}\b`, 'g'),
    (m) => ({
      start: { day: m[1], hhmm: m[3], month: MONTHS[m[2]] },
      end: { day: m[4], hhmm: m[6], month: MONTHS[m[5]] },
    }),
  ],
  // "05-09 OKT 04:00 -21:59 UTC", "12-14 OCT 0600-1500 UTC": those hours on each of those days. "8 OCT 0700-1500 UTC": on that one.
  [
    new RegExp(String.raw`\b(\d{1,2})(?:\s*-\s*(\d{1,2}))?\s+${MON}\s+(\d{2}):?(\d{2})\s*-\s*(\d{2}):?(\d{2})\s*UTC\b`, 'g'),
    (m) => {
      const [start, end] = [m[4] + m[5], m[6] + m[7]]
      // Hours that run past midnight end on the morning after the last day named.
      const last = Number(m[2] ?? m[1]) + Number(end < start)
      return {
        start: { day: m[1], hhmm: start, month: MONTHS[m[3]] },
        end: { day: String(last), hhmm: end, month: MONTHS[m[3]] },
        daily: m[2] !== undefined,
      }
    },
  ],
]

/** "071000 UTC OCT UFN": from then until further notice. */
const OPEN_ENDED = new RegExp(String.raw`\b${DAY}${TIME}\s+UTC\s+${MON}\s+(?:UFN|UNTIL\s+FURTHER\s+NOTICE)\b`)
const CANCEL_AT = new RegExp(String.raw`CANCEL(?:\s+THIS)?(?:\s+(?:MESSAGE|MSG))?\s+${DAY}${TIME}\s+UTC\s+${MON}\b`)
const ISSUED = new RegExp(String.raw`${DAY}${TIME}\s*UTC\s*${MON}`)
/** The date-time group some messages open with. It says when the message was sent, not when anything happens. */
const OWN_HEADER = /^\d{6}\s+UTC\s+[A-Z]{3}(?:\s+\d{2})?\n/
/** A day beside a month: the warning names a time, whether or not it was understood. "MAY BE" is not the month. */
const DATED = new RegExp(String.raw`\d\s*(?:UTC\s+)?(?!MAY\s+(?:BE|NOT)\b)${MON}\b|\b${MON}\s+\d`)

const utc = (year: number, month: number, { day, hhmm }: Moment) =>
  Date.UTC(year, month, Number(day), Number(hhmm.slice(0, 2)), Number(hhmm.slice(2)))

/** Notices name no year: this is the first time the date comes round on or after `floor`. */
function dateFrom(floor: number, moment: Moment, month: number): number {
  const year = new Date(floor).getUTCFullYear()
  const date = utc(year, month, moment)
  return date >= floor ? date : utc(year + 1, month, moment)
}

type Validity = { from: number } & Pick<Zone, 'to' | 'schedule' | 'unsure'>

/** A period as written, placed in time. */
function spanOf({ start, end, daily }: Written, floor: number): Validity & { to: number } {
  if (start.month !== undefined) {
    const from = dateFrom(floor, start, start.month)
    return { from, to: dateFrom(from, end, end.month), ...(daily && { schedule: `DAILY ${start.hhmm}-${end.hhmm}` }) }
  }
  // One month named for both ends: a start later in the month than the end began the month before.
  const to = dateFrom(floor, end, end.month)
  const year = new Date(to).getUTCFullYear()
  const from = utc(year, end.month, start)
  return { from: from <= to ? from : utc(year, end.month - 1, start), to }
}

/**
 * When a warning applies, read from its free text. With no period at all, it is in force from
 * the moment it was issued until the time it says it cancels itself, or until it is taken off
 * the page. With a date in a form not known here it is `unsure`: a firing area announced a week
 * ahead must not be shown as in force from the day of the announcement.
 */
export function parseValidity(text: string, issued: number): Validity {
  const wording = text.toUpperCase()
  // A warning is sometimes re-issued while it already runs, never months after it began.
  const floor = issued - 60 * DAY_MS

  const periods = PERIODS.flatMap(([pattern, read]) => [...wording.matchAll(pattern)].map((match) => spanOf(read(match), floor)))
  if (periods.length === 1) return periods[0]
  // Several periods in one warning: from the first start to the last end, with no claim about the time between.
  if (periods.length > 1) {
    return { from: Math.min(...periods.map((period) => period.from)), to: Math.max(...periods.map((period) => period.to)), unsure: true }
  }

  const cancel = CANCEL_AT.exec(wording)
  const to = cancel ? dateFrom(issued, { day: cancel[1], hhmm: cancel[2] }, MONTHS[cancel[3]]) : null
  const open = OPEN_ENDED.exec(wording)
  if (open) return { from: dateFrom(floor, { day: open[1], hhmm: open[2] }, MONTHS[open[3]]), to }
  const rest = wording.replace(OWN_HEADER, '').replace(/\bCANCEL.*$/gm, '')
  return { from: issued, to, ...(DATED.test(rest) && { unsure: true }) }
}

// ---- Positions -----------------------------------------------------------------------------

/** "55-09.5N 019-45.3E", and looser spellings of the same: "54-29,7N 012-22,3E", "59-35N 024-19E", "55-3,19N 17-18,05E" */
const POSITION = /(\d{1,2})-(\d{1,2}(?:[.,]\d+)?)\s*([NS])[\s,]+(\d{1,3})-(\d{1,2}(?:[.,]\d+)?)\s*([EW])\b/g
/** Anything that looks like a latitude, to check that every position in the text was understood. */
const LATITUDE = /\d-\d{1,2}(?:[.,]\d+)?\s*[NS]\b/g

/**
 * Every position in the text as [lon, lat], or nothing at all if any of them could not be read:
 * half an outline would be drawn as a different, wrong area.
 */
export function parsePositions(text: string): Ring {
  const wording = text.toUpperCase()
  const positions: Ring = []
  for (const [, latDeg, latMin, ns, lonDeg, lonMin, ew] of wording.matchAll(POSITION)) {
    const minutes = [latMin, lonMin].map((value) => Number(value.replace(',', '.')))
    const lat = Number(latDeg) + minutes[0] / 60
    const lon = Number(lonDeg) + minutes[1] / 60
    if (minutes[0] >= 60 || minutes[1] >= 60 || lat > 90 || lon > 180) return []
    positions.push([ew === 'W' ? -lon : lon, ns === 'S' ? -lat : lat])
  }
  return positions.length === (wording.match(LATITUDE)?.length ?? 0) ? positions : []
}

/** "A. 55-00.0N ...": the letter that opens each area of a warning that lists several. */
const LETTERED = /\b[A-Z][.)]\s*(?=\d)/

/**
 * The outlines a warning's positions draw, if they are corners at all. The words before them
 * decide: an area "bounded by" them is one, while three buoys, or the line a cable is laid
 * along, are not. Nothing is drawn where that is in doubt; the warning keeps its point.
 */
function outlinesOf(text: string, positions: Ring): Ring[] {
  const wording = text.toUpperCase()
  const lead = wording.slice(0, Math.max(0, wording.search(LATITUDE)))
  if (!/BOUNDED/.test(lead) && (!/\b(AREAS?|ZONES?)\b/.test(lead) || /LINE|TRACK|ROUTE|BUOY|\bLIGHT/.test(lead))) return []

  // Several areas in one warning are told apart by their letters. Joined into one outline they would cover the sea between them.
  const several = /\bAREAS\b/.test(lead)
  const groups = several ? wording.split(LETTERED).slice(1).map(parsePositions) : [positions]
  if (several && groups.length < 2) return []
  const rings = groups.flatMap((group) => {
    const ring = tidyRing(group)
    return ring ? [ring] : []
  })
  return rings.length === groups.length ? rings : []
}

// ---- The BALTICO page ----------------------------------------------------------------------

const SEA_AREA = /<h5>([^<]+)<\/h5>([\s\S]*?)(?=<h5>|$)/g
const WARNING = /<p>\s*([^<]+?)\s*<br\s*\/?>\s*<b>\s*([\s\S]*?)\s*<\/b>\s*<span[^>]*>([\s\S]*?)<\/span>/g
const HEADER = /^(.+?)\s+NAV\s+WARN\s+(\d+)\/(\d{2})$/
/** One warning withdrawing another of the same series: "CANCEL NAVIGATIONAL WARNING NO. 549" */
const CANCELS = /CANCEL\s+(?:NAVIGATIONAL\s+WARNING|NAV\s+WARN)\s+(?:NO\.?\s*)?(\d+)/g
/** A named exercise or firing area: "AREA BR-161", "ZONE S-6", "DANGEROUS TO SHIPPING KR-114" */
const NAMED_AREA = /\b(?:AREA|ZONE|SHIPPING)\s+((?:[A-Z]{1,3}-)?\d{1,3}[A-Z]?)\b(?![-.,\d])/

const titleCase = (text: string) => text.toLowerCase().replace(/\b[a-z]/g, (letter) => letter.toUpperCase())

/**
 * Navigational warnings in force for the Baltic, from the page of the Swedish Maritime
 * Administration, which coordinates them for every coastal state (BALTICO). The same warning
 * is listed under each sea area it touches, so it is kept once, under its series and number.
 */
export function parseNavtex(html: string, now: number): Zone[] {
  const zones = new Map<string, Zone>()
  const listedUnder = new Map<string, string[]>()
  const cancelled: string[] = []

  for (const [, heading, block] of html.matchAll(SEA_AREA)) {
    for (const [, dtg, head, body] of block.matchAll(WARNING)) {
      const header = HEADER.exec(plainText(head).replace(/\s+/g, ' '))
      if (!header) continue
      const [, origin, number, yy] = header
      const series = `sea:${origin.toLowerCase().replace(/\W+/g, '-')}`
      const id = `${series}-${Number(number)}-${yy}`
      const area = plainText(heading)
      if (zones.has(id)) {
        listedUnder.get(id)!.push(area)
        continue
      }

      const text = plainText(body)
      for (const [, other] of text.toUpperCase().matchAll(CANCELS)) cancelled.push(`${series}-${Number(other)}-${yy}`)

      const stamp = ISSUED.exec(dtg.toUpperCase())
      const issued = stamp ? utc(2000 + Number(yy), MONTHS[stamp[3]], { day: stamp[1], hhmm: stamp[2] }) : now
      const positions = parsePositions(text)
      const rings = outlinesOf(text, positions)

      listedUnder.set(id, [area])
      zones.set(id, {
        id,
        kind: 'sea',
        ...classify(text),
        title: area,
        text: clip(text),
        ...parseValidity(text, issued),
        rings,
        // Between several areas there is only sea: the first of them stands for the warning.
        point: centreOf(rings.length > 1 ? rings[0] : positions),
        issuer: `${titleCase(origin)} NAV WARN ${number}/${yy}, via BALTICO`,
        href: NAVTEX_PAGE,
      })
    }
  }

  for (const id of cancelled) zones.delete(id)
  for (const [id, zone] of zones) {
    const areas = listedUnder.get(id)!
    // Listed under most of the sea: say so, rather than name whichever area came first.
    const where = areas.length > 2 ? 'Baltic Sea' : areas.join(' / ')
    const named = NAMED_AREA.exec(zone.text.toUpperCase())?.[1]
    zone.title = named ? `${where} · area ${named}` : where
  }
  return sortZones([...zones.values()].filter((zone) => isCurrent(zone, now)))
}

// ---- Estonia's own warnings ----------------------------------------------------------------

/** The parts of the Estonian Transport Administration's map layers that are read here. */
export interface EstonianWarnings {
  features?: {
    geometry?: { type?: string; coordinates?: unknown } | null
    properties?: {
      warning_number?: number | null
      date_from?: number | null
      date_to?: number | null
      ntfct_title_eng?: string | null
      ntfct_text_eng?: string | null
      /** "soo" Gulf of Finland, "lii" Gulf of Riga, "sis" inland waters. */
      area_eng?: string | null
    }
  }[]
}

const MONTH = '(JANUARY|FEBRUARY|MARCH|APRIL|MAY|JUNE|JULY|AUGUST|SEPTEMBER|OCTOBER|NOVEMBER|DECEMBER)'
/** "from 6 October at 10:00", "From 2 October": how Estonia's wording says when something starts. */
const STARTS = new RegExp(String.raw`\bFROM\s+(\d{1,2})\s+${MONTH}(?:\s+AT\s+(\d{1,2})[:.](\d{2}))?`)
const NAMES_A_DAY = new RegExp(String.raw`\b\d{1,2}\s+${MONTH}\b`)
const ESTONIAN_TIME = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Tallinn', timeZoneName: 'shortOffset' })

/**
 * When what an Estonian warning announces begins. Its `date_from` is the time it was published,
 * days ahead of a firing, so the start is read from the wording, which gives it in local time.
 */
function estonianStart(text: string, published: number | null, now: number): Pick<Zone, 'from' | 'unsure'> {
  const wording = text.toUpperCase()
  const start = STARTS.exec(wording)
  if (!start) return { from: published, ...(NAMES_A_DAY.test(wording) && { unsure: true }) }
  const moment = { day: start[1], hhmm: (start[3] ?? '00').padStart(2, '0') + (start[4] ?? '00') }
  const asUtc = dateFrom((published ?? now) - 60 * DAY_MS, moment, MONTHS[start[2].slice(0, 3)])
  const ahead = Number(/GMT([+-]\d+)/.exec(ESTONIAN_TIME.format(asUtc))?.[1] ?? 0)
  return { from: asUtc - ahead * 60 * 60 * 1000 }
}

/**
 * Estonia's coastal warnings, which carry what the BALTICO page lacks: drawn outlines, and
 * local notices that are never broadcast. One warning can be several features (a row of buoys,
 * a point and its area), so they are gathered by warning number.
 */
export function normaliseEstonianWarnings(layers: readonly EstonianWarnings[], now: number): Zone[] {
  const zones = new Map<number, Zone>()
  const positions = new Map<number, Ring>()

  for (const { geometry, properties } of layers.flatMap((layer) => layer.features ?? [])) {
    const number = properties?.warning_number
    // Lakes and rivers are outside what this map watches.
    if (typeof number !== 'number' || !properties || properties.area_eng === 'sis') continue

    let zone = zones.get(number)
    if (!zone) {
      const title = plainText(properties.ntfct_title_eng ?? '')
      const text = plainText(properties.ntfct_text_eng ?? '')
      const published = properties.date_from ?? null
      zone = {
        // The same shape of id as the BALTICO page gives its Estonian warnings, so the two can be matched.
        id: `sea:estonian-${number}-${String(new Date(published ?? now).getUTCFullYear()).slice(2)}`,
        kind: 'sea',
        ...classify(`${title} ${text}`),
        title: title || 'Estonian waters',
        text: clip(text),
        ...estonianStart(text, published, now),
        to: properties.date_to ?? null,
        rings: [],
        point: null,
        issuer: `Estonian Transport Administration, warning ${number}`,
        href: ESTONIAN_PAGE,
      }
      zones.set(number, zone)
      positions.set(number, [])
    }

    if (geometry?.type === 'Point') positions.get(number)!.push(geometry.coordinates as [number, number])
    const polygons =
      geometry?.type === 'Polygon' ? [geometry.coordinates as Ring[]] : geometry?.type === 'MultiPolygon' ? (geometry.coordinates as Ring[][]) : []
    for (const [outer] of polygons) {
      const ring = tidyRing(outer)
      if (ring) zone.rings.push(ring)
    }
  }

  for (const [number, zone] of zones) zone.point = centreOf(zone.rings[0] ?? positions.get(number)!)
  return sortZones([...zones.values()].filter((zone) => isCurrent(zone, now)))
}

/**
 * Both sources as one list. Where both carry a warning, the broadcast copy is kept, as it
 * states its period in UTC, and Estonia's copy lends it the outline.
 */
export function mergeSeaWarnings(navtex: Zone[], estonian: Zone[]): Zone[] {
  const own = new Map(estonian.map((zone) => [zone.id, zone]))
  const broadcast = navtex.map((zone) => {
    const drawn = own.get(zone.id)
    own.delete(zone.id)
    return drawn?.rings.length ? { ...zone, rings: drawn.rings, point: drawn.point } : zone
  })
  return sortZones([...broadcast, ...own.values()])
}
