import type { Zone } from '../feeds'
import { msg } from '../i18n'
import { type Ring, centreOf, clip, isCurrent, plainText, sortZones, tidyRing } from './zones'

export const EANS_PAGE = 'https://utm.eans.ee/avm/'
export const LGS_PAGE = 'https://ais.lgs.lv/notam/displayfile/All%20valid'

/** Outlines of the areas published in an AIP, by designator ("EVR62A"). */
export type AreaTable = Readonly<Record<string, { name: string; ring: Ring }>>

/** First match wins. */
const KINDS: readonly [RegExp, string][] = [
  [/GNSS|GPS/, msg('GNSS interference')],
  [/FIRING|SHOOTING|GUNNERY/, msg('Firing practice')],
  [/DANGER AREA/, msg('Danger area')],
  [/PROHIBITED AREA/, msg('Prohibited area')],
  [/RESTRICTED AREA/, msg('Restricted area')],
  [/(SEGREGATED|RESERVED|OPERATING) AREA/, msg('Reserved airspace')],
]
/** What makes a NOTAM a matter of airspace rather than of runway lights and cranes. */
const RELEVANT = /\b(DANGER|RESTRICTED|PROHIBITED|RESERVED|SEGREGATED|OPERATING) AREA\b|GNSS|AIRSPACE|MILITARY|\bMIL OPS\b|FIRING/
/** Said of military or security activity. A danger area activated with no reason given is not assumed to be one. */
const MILITARY = /\bMIL(ITARY)?\b|FIRING|SHOOTING|EXERCISE|AIR FORCE|DEFENCE|GNSS|GPS/
const HOUSEKEEPING = /^(TRIGGER NOTAM|CHECKLIST)/
/** "EVR62A", "EED5", "EETSA21": the designator of a published area, in either country. */
const AREA = String.raw`\bE[EV](?:D|R|P|TSA|TRA)\s?\d+[A-Z0-9]*\b`
const DESIGNATOR = new RegExp(AREA, 'g')
/** With the name Estonia writes after it: "EED5 (KILTSI)" */
const NAMED_AREA = new RegExp(String.raw`${AREA}(?:\s*\([^)]*\))?`)
/** A sentence that gives a duty phone or a mailbox. Those are for pilots, and not ours to republish. */
const CONTACT = /\bTEL\b|\bPHONE\b|\+\d{3}|\(AT\)|@/
/** "[Schedule: 06 08-09 11 0600-1800]": the hours of a NOTAM that is not active throughout, as EANS appends them. */
const EANS_SCHEDULE = /\[Schedule:\s*([^\]]+)\]/
/** Item D of a Latvian NOTAM, which says the same and can run over several lines. */
const LGS_SCHEDULE = /\nD\)([\s\S]+)$/

const oneLine = (text: string | undefined) => text?.replace(/\s+/g, ' ').trim()

const scrub = (text: string) =>
  text
    .split(/(?<=\.)\s+/)
    .filter((sentence) => !CONTACT.test(sentence))
    .join(' ')

function classify(text: string): Pick<Zone, 'type' | 'military'> {
  // Pilots are often told to "exercise caution", which is no exercise.
  const wording = text.replace(/EXERCISE (\w+ )?CAUTION/g, '')
  return { type: KINDS.find(([pattern]) => pattern.test(wording))?.[1] ?? msg('Airspace notice'), military: MILITARY.test(wording) }
}

// ---- Estonia: the NOTAM areas on the air navigation service's drone map ---------------------

/** The parts of EANS's uas.geojson that are read here. */
export interface UasZones {
  features?: {
    geometry?: { type?: string; coordinates?: unknown } | null
    properties?: {
      /** The NOTAM number, for zones that come from one. */
      name?: string
      message?: string
      lower?: string
      upper?: string
      zoneAuthority?: { name?: string }[]
      applicability?: { startDateTime?: string; endDateTime?: string }[]
    }
  }[]
}

/**
 * Airspace that an Estonian NOTAM has closed, reserved or declared dangerous, in force or
 * about to be. The file also holds a couple of hundred standing drone zones (nature
 * reserves, prisons, airports): only what a NOTAM switched on is kept.
 */
export function normaliseEansZones(file: UasZones, now: number): Zone[] {
  const zones: Zone[] = []
  for (const { geometry, properties } of file.features ?? []) {
    const message = properties?.message ?? ''
    if (!properties?.name || !properties.zoneAuthority?.some((authority) => authority.name === 'EANS NOTAM PIB')) continue
    if (!RELEVANT.test(message)) continue

    const [span] = properties.applicability ?? []
    const from = Date.parse(span?.startDateTime ?? '')
    const to = Date.parse(span?.endDateTime ?? '')
    const polygons =
      geometry?.type === 'Polygon' ? [geometry.coordinates as Ring[]] : geometry?.type === 'MultiPolygon' ? (geometry.coordinates as Ring[][]) : []
    const rings = polygons.flatMap(([outer]) => {
      const ring = tidyRing(outer)
      return ring ? [ring] : []
    })
    const height = properties.lower && properties.upper ? `\n${properties.lower} to ${properties.upper}` : ''
    const schedule = oneLine(EANS_SCHEDULE.exec(message)?.[1])

    const zone: Zone = {
      id: `air:ee:${properties.name}`,
      kind: 'air',
      ...classify(message),
      title: NAMED_AREA.exec(message)?.[0] ?? properties.name,
      text: clip(scrub(message) + height),
      from: Number.isFinite(from) ? from : null,
      to: Number.isFinite(to) ? to : null,
      ...(schedule && { schedule }),
      rings,
      // An area a few dozen metres across is too small to draw as one, but it is still somewhere.
      point: centreOf(rings[0] ?? polygons[0]?.[0] ?? []),
      issuer: `EANS NOTAM ${properties.name}`,
      href: EANS_PAGE,
    }
    if (isCurrent(zone, now)) zones.push(zone)
  }
  return sortZones(zones)
}

// ---- Latvia: the valid NOTAM list, joined to outlines from the AIP --------------------------

const NOTAM = /<h6>([^<]+)<\/h6>\s*<div class="p1"[^>]*>([\s\S]*?)<\/div>/g
const TIME = String.raw`(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2})`
const SPAN = new RegExp(String.raw`B\)${TIME}\s+C\)(?:${TIME}|PERM)`)
const CORNER = /(\d{2})(\d{2})(\d{2})N\s?(\d{3})(\d{2})(\d{2})E/g

const utc = (parts: string[]) => Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]), Number(parts[3]), Number(parts[4]))

/**
 * NOTAMs for the Riga flight information region that restrict airspace, in force or about to
 * be. A NOTAM names an area and leaves its outline to the AIP, so the outline comes from
 * `areas`; one that draws its own area is taken at its word; the rest are kept as text.
 */
export function parseLgsNotams(html: string, areas: AreaTable, now: number): Zone[] {
  const zones: Zone[] = []
  for (const [, number, body] of html.matchAll(NOTAM)) {
    const text = plainText(body)
    // Item E is the notice itself; what comes before it is the place, the height band, the dates and the daily hours.
    const split = text.indexOf('\nE)')
    const span = SPAN.exec(text)
    if (split < 0 || !span) continue
    const notice = text.slice(split + 3)
    if (HOUSEKEEPING.test(notice) || !RELEVANT.test(notice)) continue

    const head = text.slice(0, split)
    const [place, ...terms] = head.split('\n')
    const ids = [...new Set((notice.match(DESIGNATOR) ?? []).map((id) => id.replace(/\s/g, '')))]
    const corners = [...notice.matchAll(CORNER)].map(
      ([, latD, latM, latS, lonD, lonM, lonS]): [number, number] => [
        Number(lonD) + Number(lonM) / 60 + Number(lonS) / 3600,
        Number(latD) + Number(latM) / 60 + Number(latS) / 3600,
      ],
    )
    // An area drawn in the notice ends by naming its first corner again: that is where the next one begins.
    const closed: Ring[] = []
    let open: Ring = []
    for (const corner of corners) {
      open.push(corner)
      if (open.length > 3 && corner[0] === open[0][0] && corner[1] === open[0][1]) {
        closed.push(open)
        open = []
      }
    }
    // A list that never comes back to its start is taken as one outline.
    const own = (closed.length > 0 ? closed : [corners]).flatMap((outline) => {
      const ring = tidyRing(outline)
      return ring ? [ring] : []
    })
    const rings = own.length > 0 ? own : ids.flatMap((id) => (areas[id] ? [areas[id].ring] : []))
    const schedule = oneLine(LGS_SCHEDULE.exec(head)?.[1])

    const zone: Zone = {
      id: `air:lv:${number.trim()}`,
      kind: 'air',
      ...classify(notice),
      title: ids.map((id) => (areas[id] ? `${id} ${areas[id].name}`.trim() : id)).join(', ') || (/\((.+)\)/.exec(place)?.[1] ?? place),
      text: clip(
        [scrub(notice), ...terms.filter((line) => !line.startsWith('B)')).map((line) => line.replace(/^D\)/, 'Hours: '))].join('\n'),
      ),
      from: utc(span.slice(1, 6)),
      to: span[6] ? utc(span.slice(6, 11)) : null,
      ...(schedule && { schedule }),
      rings,
      point: centreOf(rings[0] ?? []),
      issuer: `LGS NOTAM ${number.trim()}`,
      href: LGS_PAGE,
    }
    if (isCurrent(zone, now)) zones.push(zone)
  }
  return sortZones(zones)
}
