import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { FeedCache, FeedUnavailable } from '../../server/core/cache'
import type { FetchLike } from '../../server/core/upstream'
import { airspaceFeed, navwarnFeed } from '../../server/feeds/zones'
import { type AreaTable, type UasZones, normaliseEansZones, parseLgsNotams } from '../../shared/adapters/airspace'
import { parseAipAreas, parseLateralLimits } from '../../shared/adapters/eaip'
import {
  type EstonianWarnings,
  mergeSeaWarnings,
  normaliseEstonianWarnings,
  parseNavtex,
  parsePositions,
  parseValidity,
} from '../../shared/adapters/navwarn'
import { type Ring, onSchedule, plainText, tidyRing, zoneState } from '../../shared/adapters/zones'
import type { PayloadOf, Zone } from '../../shared/feeds'

const read = (name: string) => readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8')
const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString().slice(0, 16))
const at = (text: string) => Date.parse(`${text}:00Z`)
const byIssuer = (zones: Zone[], needle: string) => zones.find((zone) => zone.issuer.includes(needle))

/** The afternoon the fixtures were cut. */
const NOW = at('2026-10-06T16:00')

describe('plain text', () => {
  it('keeps the lines and drops the markup', () => {
    expect(plainText("  A&#xD;&#xA;B &#x27;C&#x27;<br/>D&nbsp;E <b>F</b> &lt;script&gt; ")).toBe("A\nB 'C'\nD E F <script>")
  })
})

describe('validity periods', () => {
  const period = (text: string, issued: string) => {
    const { from, to } = parseValidity(text, at(issued))
    return [iso(from), iso(to)]
  }

  it('reads the ways a period is written', () => {
    expect(period('AREA TEMPORARILY DANGEROUS TO SHIPPING 070700 THRU 081400 UTC OCT', '2026-10-06T10:50')).toEqual([
      '2026-10-07T07:00',
      '2026-10-08T14:00',
    ])
    expect(period('SHIPS EXERCISES 302100 UTC SEP THRU 312100 UTC OCT', '2026-09-23T14:02')).toEqual(['2026-09-30T21:00', '2026-10-31T21:00'])
    expect(period('NAVAL EXERCISES (WITHOUT FIRINGS) 022100 TO 102100 OCT UTC', '2026-09-28T05:48')).toEqual([
      '2026-10-02T21:00',
      '2026-10-10T21:00',
    ])
    expect(period('FROM 27 SEP 2201 UTC TO 07 OCT 2159 UTC', '2026-09-25T13:33')).toEqual(['2026-09-27T22:01', '2026-10-07T21:59'])
    expect(period('05-09  OKT 04:00 -21:59 UTC', '2026-10-01T10:14')).toEqual(['2026-10-05T04:00', '2026-10-09T21:59'])
  })

  it('steps back a month when one month is named and the period straddles its start', () => {
    expect(period('282100 THRU 021400 UTC MAR', '2027-02-27T09:00')).toEqual(['2027-02-28T21:00', '2027-03-02T14:00'])
    expect(period('310000 THRU 020000 UTC JAN', '2026-12-30T09:00')).toEqual(['2026-12-31T00:00', '2027-01-02T00:00'])
  })

  it('carries a period over the new year, whichever side of it the warning was issued on', () => {
    const text = 'SHIPS EXERCISES 302100 UTC DEC THRU 052100 UTC JAN'
    expect(period(text, '2026-12-20T08:00')).toEqual(['2026-12-30T21:00', '2027-01-05T21:00'])
    // Issued again in January while it runs.
    expect(period(text, '2027-01-02T08:00')).toEqual(['2026-12-30T21:00', '2027-01-05T21:00'])
    expect(period('150000 UTC JAN THRU 200000 UTC JAN', '2026-12-20T08:00')).toEqual(['2027-01-15T00:00', '2027-01-20T00:00'])
  })

  it('falls back to the time of issue, and to the time the warning cancels itself', () => {
    expect(period('LIGHT UNLIT', '2026-09-24T10:05')).toEqual(['2026-09-24T10:05', null])
    expect(period('BUOY MISSING. CANCEL THIS MESSAGE 020900 UTC JAN', '2026-12-28T10:00')).toEqual(['2026-12-28T10:00', '2027-01-02T09:00'])
    // A time that cannot be one is not read as one.
    expect(period('CHANNEL 126000 TO 126500 UTC OCT', '2026-10-06T10:00')).toEqual(['2026-10-06T10:00', null])
  })

  const issued = at('2026-10-05T10:00')

  it('reads hours on named days, and keeps them as a daily schedule when there are several days', () => {
    const firing = parseValidity('MILITARY EXERCISE WITH FIRING 12-14 OCT 0600-1500 UTC IN AREA BOUNDED BY', issued)
    expect(firing).toEqual({ from: at('2026-10-12T06:00'), to: at('2026-10-14T15:00'), schedule: 'DAILY 0600-1500' })
    expect(parseValidity('05-09  OKT 04:00 -21:59 UTC', issued).schedule).toBe('DAILY 0400-2159')
    expect(parseValidity('GUNNERY 8 OCT 0700-1500 UTC', issued)).toEqual({ from: at('2026-10-08T07:00'), to: at('2026-10-08T15:00') })
    // Night firing ends on the morning after the last day named, the last day of the month included.
    expect(parseValidity('30-31 OCT 2200-0400 UTC', issued)).toEqual({ from: at('2026-10-30T22:00'), to: at('2026-11-01T04:00'), schedule: 'DAILY 2200-0400' })
    expect(period('MINE CLEARANCE 071000 UTC OCT UFN', '2026-10-05T10:00')).toEqual(['2026-10-07T10:00', null])
  })

  it('spans several periods without claiming the time between them', () => {
    expect(parseValidity('ROCKET FIRINGS 070500 THRU 071500 UTC OCT AND 090500 THRU 091500 UTC OCT', issued)).toEqual({
      from: at('2026-10-07T05:00'),
      to: at('2026-10-09T15:00'),
      unsure: true,
    })
  })

  it('does not call a warning in force from its issue when it names a date that could not be read', () => {
    expect(parseValidity('FIRING EXERCISE FROM 12 TO 14 OCT 0600 TO 1500 LT', issued)).toEqual({ from: issued, to: null, unsure: true })
    expect(parseValidity('FIRING ON OCT 12. CANCEL THIS MSG 121500 UTC OCT', issued)).toEqual({ from: issued, to: at('2026-10-12T15:00'), unsure: true })
    // Not dates of anything: the message's own date-time group, the time it cancels itself, and a verb.
    for (const text of [
      '230906 UTC JUN\nPETERSBURG NAV WARN 121/26\nAREAS TEMPORARILY DANGEROUS FOR SHIPPING',
      "130830 UTC SEP 26\nGERMAN NAV WARN 516/26\n'SPERR-G. 1' LIGHTBUOY MISSING",
      'BUOY MISSING. CANCEL THIS MESSAGE 020900 UTC JAN',
      'BUOY 3 MAY BE OUT OF POSITION',
    ]) {
      expect(parseValidity(text, issued).unsure).toBeUndefined()
    }
  })
})

describe('schedules', () => {
  const on = (schedule: string, time: string) => onSchedule(schedule, at(time))

  it('applies daily hours, the last minute included', () => {
    expect(on('DAILY 0500-1500', '2026-10-06T04:59')).toBe(false)
    expect(on('DAILY 0500-1500', '2026-10-06T05:00')).toBe(true)
    expect(on('DAILY 0500-1500', '2026-10-06T15:00')).toBe(true)
    expect(on('DAILY 0500-1500', '2026-10-06T16:30')).toBe(false)
    expect(on('DAILY 2200-0400', '2026-10-06T23:00')).toBe(true)
    expect(on('DAILY 2200-0400', '2026-10-07T03:00')).toBe(true)
    expect(on('DAILY 2200-0400', '2026-10-07T12:00')).toBe(false)
  })

  it('applies hours listed by day of the month', () => {
    const kiltsi = '01-04 07-11 14-18 21-25 28-31 0700-1800'
    expect(on(kiltsi, '2026-10-06T12:00')).toBe(false)
    expect(on(kiltsi, '2026-10-07T12:00')).toBe(true)
    expect(on(kiltsi, '2026-10-07T18:30')).toBe(false)
    // Broken over two lines, as EANS sends a long one.
    const tapa = '01 0700-1159, 02 08 10-11 0500-1359, 04 0600-1359, 06 13-14\n0500-1659, 07 0600-1259'
    expect(on(tapa, '2026-10-06T16:00')).toBe(true)
    expect(on(tapa, '2026-10-07T16:00')).toBe(false)
    expect(on(tapa, '2026-10-10T05:30')).toBe(true)
    // One night written as two days.
    expect(on('24 1830-2359, 25 0000-0200', '2026-10-25T01:00')).toBe(true)
    expect(on('24 1830-2359, 25 0000-0200', '2026-10-25T18:45')).toBe(false)
    // Over the end of a month, and past midnight from a listed day.
    expect(on('30-02 0600-0900', '2026-11-01T07:00')).toBe(true)
    expect(on('30-02 0600-0900', '2026-11-03T07:00')).toBe(false)
    expect(on('06 2200-0400', '2026-10-07T03:00')).toBe(true)
    expect(on('06 2200-0400', '2026-10-06T03:00')).toBe(false)
  })

  it('does not guess at any other wording', () => {
    expect(on('MON-FRI 0700-1500', '2026-10-06T12:00')).toBeNull()
    expect(on('DAILY SR-SS', '2026-10-06T12:00')).toBeNull()
    expect(on('OCT 28-31 0500-1700, NOV 01-03 0500-1700', '2026-10-29T12:00')).toBeNull()
  })

  it('calls a zone in force only when it is known to apply at this moment', () => {
    const cekule = { from: at('2026-10-05T05:00'), to: at('2026-10-18T15:00'), schedule: 'DAILY 0500-1500' }
    expect(zoneState(cekule, at('2026-10-04T12:00'))).toBe('pending')
    expect(zoneState(cekule, at('2026-10-06T12:00'))).toBe('active')
    expect(zoneState(cekule, at('2026-10-06T23:30'))).toBe('idle')
    expect(zoneState(cekule, at('2026-10-19T12:00'))).toBe('idle')
    expect(zoneState({ ...cekule, schedule: 'MON-FRI 0500-1500' }, NOW)).toBe('unsure')
    expect(zoneState({ from: NOW - 1, to: null, unsure: true }, NOW)).toBe('unsure')
    expect(zoneState({ from: null, to: null }, NOW)).toBe('active')
  })
})

describe('positions in free text', () => {
  it('reads degrees and decimal minutes, however they are punctuated', () => {
    expect(parsePositions('55-09.5N 019-45.3E')).toEqual([[19.755, 55.15833333333333]])
    expect(parsePositions('54-29,7N 012-22,3E\n54-36,5N 012-43,8E.')).toHaveLength(2)
    expect(parsePositions('CENTRED 59-35N 024-19E')[0]).toEqual([24 + 19 / 60, 59 + 35 / 60])
    // Minutes without their leading zero, degrees without theirs: seen from Poland.
    const [[lon, lat]] = parsePositions('BUOY SM-12 REMOVED FROM POSITION 55-3,19N 17-18,05E.')
    expect(lon).toBeCloseTo(17.3008, 4)
    expect(lat).toBeCloseTo(55.0532, 4)
  })

  it('gives up on the whole text when one position cannot be read', () => {
    expect(parsePositions('55-33.2N 020-01.8E 55-32.0N 02O-09.6E 55-30.8N 020-09.6E')).toEqual([])
    expect(parsePositions('55-70.0N 020-01.8E')).toEqual([])
    expect(parsePositions('05-09 OKT, ZONE S-6, VHF CH 13 AND 61')).toEqual([])
  })
})

describe('BALTICO warnings', () => {
  const zones = parseNavtex(read('navwarn.baltico.html'), NOW)

  it('keeps each warning once, however many sea areas list it', () => {
    expect(zones).toHaveLength(10)
    const gnss = byIssuer(zones, 'Baltic Sea NAV WARN 026/25')!
    expect(gnss).toMatchObject({ id: 'sea:baltic-sea-26-25', title: 'Baltic Sea', type: 'GNSS interference', military: true, rings: [], point: null })
    expect([iso(gnss.from), gnss.to]).toEqual(['2025-07-02T11:00', null])
  })

  it('draws a Russian exercise area from its corners', () => {
    const exercise = byIssuer(zones, 'Kaliningrad NAV WARN 227/26')!
    expect(exercise).toMatchObject({
      kind: 'sea',
      type: 'Naval exercise',
      military: true,
      title: 'South-eastern Baltic · area BR-161',
      href: 'https://navvarn.sjofartsverket.se/en/Navigationsvarningar/Navtex',
    })
    expect(exercise.rings).toEqual([
      [
        [19.755, 55.1583],
        [20, 55.1583],
        [20, 55.0333],
        [19.66, 55.0333],
      ],
    ])
    expect(exercise.point).toEqual([19.8537, 55.0958])
    expect([iso(exercise.from), iso(exercise.to)]).toEqual(['2026-09-30T21:00', '2026-10-31T21:00'])
    expect(exercise.text).toContain('SHIPS EXERCISES IN AREA BR-161\n302100 UTC SEP THRU 312100 UTC OCT')
    expect(byIssuer(zones, 'Kaliningrad NAV WARN 226/26')!.rings[0]).toHaveLength(7)
  })

  it('says what each warning is about, in plain words', () => {
    const kinds = Object.fromEntries(zones.map((zone) => [zone.issuer.replace(/ NAV WARN|, via BALTICO/g, ''), [zone.type, zone.military]]))
    expect(kinds).toEqual({
      'Baltic Sea 026/25': ['GNSS interference', true],
      // "Without firings", and it says so.
      'Baltic Sea 029/26': ['Naval exercise', true],
      'Kaliningrad 227/26': ['Naval exercise', true],
      'Kaliningrad 226/26': ['Naval exercise', true],
      // Closed to shipping with no reason given.
      'Kaliningrad 249/26': ['Danger area', true],
      'Polish 245/26': ['Military exercise', true],
      'Estonian 170/26': ['Firing practice', true],
      'Petersburg 121/26': ['Mine danger', true],
      'German 566/26': ['Cable works', false],
      'Polish 222/26': ['Navigation aid', false],
    })
    // Military first.
    expect(zones.map((zone) => zone.military)).toEqual([true, true, true, true, true, true, true, true, false, false])
  })

  it('marks a position without pretending it is an area', () => {
    const zone = byIssuer(zones, 'Polish NAV WARN 245/26')!
    expect(zone).toMatchObject({ title: 'Southern Baltic · area S-6', rings: [], point: [16.6098, 54.6545], schedule: 'DAILY 0400-2159' })
    expect([iso(zone.from), iso(zone.to)]).toEqual(['2026-10-05T04:00', '2026-10-09T21:59'])
    // Two ends of a cable-laying line are not an outline either.
    expect(byIssuer(zones, 'German NAV WARN 566/26')).toMatchObject({ rings: [], point: [12.5508, 54.5517] })
    expect(byIssuer(zones, 'Polish NAV WARN 222/26')!.point).toEqual([17.3008, 55.0532])
  })

  it('lists what starts within two days and drops what has run out', () => {
    const tomorrow = 'Kaliningrad NAV WARN 249/26'
    expect(iso(byIssuer(zones, tomorrow)!.from)).toBe('2026-10-07T07:00')
    expect(byIssuer(parseNavtex(read('navwarn.baltico.html'), at('2026-10-04T00:00')), tomorrow)).toBeUndefined()
    expect(byIssuer(parseNavtex(read('navwarn.baltico.html'), at('2026-10-08T14:01')), tomorrow)).toBeUndefined()
  })

  const warning = (header: string, text: string) => `<p> 061002 UTC OCT <br /><b> ${header} </b><span style="white-space: pre-line"> ${text} </span></p>`

  it('drops a warning that a later one of the same series cancels', () => {
    const html = `<h5>Western Baltic</h5>
      ${warning('GERMAN NAV WARN 549/26', 'CABLELAYER OPERATIONS NORTH OF DARSS')}
      ${warning('DANISH NAV WARN 549/26', 'LIGHT UNLIT')}
      ${warning('GERMAN NAV WARN 566/26', 'CABLELAYER OPERATIONS.&#xD;&#xA;CANCEL NAVIGATIONAL WARNING NO. 549.')}`
    expect(parseNavtex(html, NOW).map((zone) => zone.id)).toEqual(['sea:danish-549-26', 'sea:german-566-26'])
  })

  it('keeps a warning as text when its positions cannot be read', () => {
    const html = `<h5>Central Baltic</h5>${warning('BALTIC SEA NAV WARN 030/26', 'FIRING EXERCISES IN AREA BOUNDED BY&#xD;&#xA;57-37.5N 020-05.6E 57-27.1N 020 35.5E&#xD;&#xA;56-54.0N 019-56.1E')}`
    expect(parseNavtex(html, NOW)).toMatchObject([{ type: 'Firing practice', title: 'Central Baltic', rings: [], point: null }])
    expect(parseNavtex('<main><h5>Bay of Bothnia</h5><p>No current warnings in the area</p></main>', NOW)).toEqual([])
  })

  const drawn = (text: string) => parseNavtex(`<h5>Southern Baltic</h5>${warning('BALTIC SEA NAV WARN 031/26', text)}`, NOW)[0]
  const A = '55-00.0N 019-00.0E 55-00.0N 019-10.0E 54-55.0N 019-10.0E 54-55.0N 019-00.0E'
  const B = '56-00.0N 018-00.0E 56-00.0N 018-10.0E 55-55.0N 018-10.0E 55-55.0N 018-00.0E'

  it('draws each area of a warning that lists several, and never the sea between them', () => {
    const firing = drawn(`ROCKET FIRINGS 060500 THRU 091600 UTC OCT NAVIGATION PROHIBITED IN AREAS: A. ${A} B. ${B}`)
    expect(firing.rings).toHaveLength(2)
    expect(firing.rings.map((ring) => ring.length)).toEqual([4, 4])
    expect(Math.max(...firing.rings[0].map((point) => point[1]))).toBe(55)
    expect(Math.min(...firing.rings[1].map((point) => point[1]))).toBeCloseTo(55.9167, 4)
    // The first area stands for the warning, not a spot between the two.
    expect(firing.point![0]).toBeCloseTo(19.083, 2)
    expect(firing.point![1]).toBeCloseTo(54.958, 2)
    // Several areas that cannot be told apart are not drawn at all.
    expect(drawn(`ROCKET FIRINGS NAVIGATION PROHIBITED IN AREAS ${A} ${B}`)).toMatchObject({ rings: [], military: true })
  })

  it('takes positions for corners only when the words before them say so', () => {
    const buoys = '54-31,5N 011-18,5E 54-32,5N 011-20,5E 54-33,5N 011-18,5E'
    expect(drawn(`FIRING EXERCISES IN AREA BOUNDED BY LINE JOINING ${A}`).rings).toHaveLength(1)
    expect(drawn(`WESTERN BALTIC.FEHMARN. PROHIBITED AREA. LIGHTBUOYS ${buoys} MISSING`)).toMatchObject({ rings: [], point: [11.3194, 54.5417] })
    expect(drawn(`CABLE LAYING IN THE AREA ALONG LINE JOINING ${A}`).rings).toEqual([])
    expect(drawn(`WRECKS IN ${buoys}. VESSELS IN THE AREA KEEP CLEAR`).rings).toEqual([])
  })
})

describe('Estonian warnings', () => {
  const { points, areas } = JSON.parse(read('navwarn.estonia.json')) as { points: EstonianWarnings; areas: EstonianWarnings }
  const zones = normaliseEstonianWarnings([points, areas], NOW)

  it('gathers a warning from its features and leaves inland waters out', () => {
    expect(zones.map((zone) => [zone.id, zone.type, zone.military])).toEqual([
      ['sea:estonian-170-26', 'Firing practice', true],
      ['sea:estonian-167-26', 'Dredging', false],
    ])
    const firing = zones[0]
    expect(firing).toMatchObject({ title: 'Firing in practice area 2A W from Naissaar', issuer: 'Estonian Transport Administration, warning 170' })
    // Five corners, closed.
    expect(firing.rings[0]).toHaveLength(6)
    expect(firing.rings[0][0]).toEqual([24.2, 59.6285])
    expect(firing.point![0]).toBeCloseTo(24.32, 1)
    expect(firing.text).not.toContain('<br>')
    expect(zones[1]).toMatchObject({ rings: [], to: null })
    expect(zones[1].point![1]).toBeCloseTo(58.2266, 3)
  })

  it('reads the start from the wording, as the date on the record is the day it was published', () => {
    // Published on the 3rd: "from 6 October at 10:00 to 8 October at 17:00 (local time)".
    expect([iso(zones[0].from), iso(zones[0].to)]).toEqual(['2026-10-06T07:00', '2026-10-08T14:00'])
    // "From 2 October", published on the 1st: midnight in Tallinn, which is three hours ahead in summer.
    expect(iso(zones[1].from)).toBe('2026-10-01T21:00')
    expect(zones.map((zone) => zone.unsure)).toEqual([undefined, undefined])

    const warning = (text: string, published: string): EstonianWarnings => ({
      features: [{ geometry: { type: 'Point', coordinates: [24, 59.5] }, properties: { warning_number: 9, date_from: at(published), ntfct_text_eng: text } }],
    })
    const [winter] = normaliseEstonianWarnings([warning('Firing from 3 January at 09:30 to 4 January.', '2026-12-29T08:00')], at('2027-01-02T00:00'))
    expect(iso(winter.from)).toBe('2027-01-03T07:30')
    // A date in other words is not guessed at, and a notice with no date runs from the day it was published.
    const [other] = normaliseEstonianWarnings([warning('Firing on 7 October between 10:00 and 17:00.', '2026-10-03T07:00')], NOW)
    expect(other).toMatchObject({ from: at('2026-10-03T07:00'), unsure: true })
    const [plain] = normaliseEstonianWarnings([warning('Buoy No. 8 is missing.', '2026-10-03T07:00')], NOW)
    expect(plain).toMatchObject({ from: at('2026-10-03T07:00') })
    expect(plain.unsure).toBeUndefined()
  })

  it('lends its outline to the broadcast copy of the same warning, which keeps its own times', () => {
    const merged = mergeSeaWarnings(parseNavtex(read('navwarn.baltico.html'), NOW), zones)
    expect(merged).toHaveLength(11)
    const [firing, ...twins] = merged.filter((zone) => zone.id === 'sea:estonian-170-26')
    expect(twins).toEqual([])
    expect(firing).toMatchObject({ issuer: 'Estonian NAV WARN 170/26, via BALTICO', title: 'Gulf of Finland · area 2A', rings: zones[0].rings, point: zones[0].point })
    expect([iso(firing.from), iso(firing.to)]).toEqual(['2026-10-06T07:00', '2026-10-08T14:00'])
    // On its own, as when the Swedish page is down, the Estonian copy still starts when the firing does.
    expect(mergeSeaWarnings([], zones)).toHaveLength(2)
  })
})

describe('Estonian NOTAM areas', () => {
  const zones = normaliseEansZones(JSON.parse(read('airspace.eans.json')) as UasZones, NOW)

  it('keeps what a NOTAM switched on, and only while it is on', () => {
    // The nature reserve is a standing drone zone, and EED2 (UNIKULA) ended at 15:59.
    expect(zones.map((zone) => [zone.id, zone.title, zone.type, zone.military])).toEqual([
      ['air:ee:A2858/26', 'EED5 (KILTSI)', 'Danger area', true],
      ['air:ee:A2780/26', 'EED25 (MURU)', 'Firing practice', true],
      ['air:ee:A2092/26', 'EED2519B', 'Danger area', false],
      ['air:ee:A2802/26', 'EED16 (KLOOGA 1)', 'Danger area', false],
    ])
    expect(zones[0]).toMatchObject({ kind: 'air', issuer: 'EANS NOTAM A2858/26', href: 'https://utm.eans.ee/avm/' })
    expect([iso(zones[0].from), iso(zones[0].to)]).toEqual(['2026-10-01T07:00', '2026-10-31T18:00'])
    expect(zones[0].rings).toHaveLength(1)
    expect(zones[0].rings[0]).toHaveLength(5)
    expect(zones[0].point![1]).toBeCloseTo(59.0, 0)
    expect(zones[0].text).toBe('DANGER AREA EED5 (KILTSI) ACTIVATED FOR MILITARY EXERCISE. [Schedule: 01-04 07-11 14-18 21-25 28-31 0700-1800]\nSFC to 2100 FT AGL')
  })

  it('carries the hours of a NOTAM that is not active throughout', () => {
    expect(zones[0].schedule).toBe('01-04 07-11 14-18 21-25 28-31 0700-1800')
    // The 6th is not one of its days, though its period runs all month.
    expect(zoneState(zones[0], NOW)).toBe('idle')
    expect(zoneState(zones[0], at('2026-10-07T12:00'))).toBe('active')
  })

  it('does not pass on the duty phone numbers', () => {
    const klooga = zones.find((zone) => zone.title.startsWith('EED16'))!
    expect(klooga.text).toMatch(/^DANGER AREA EED16 \(KLOOGA 1\) ACTIVATED\. \[Schedule: /)
    expect(zones.map((zone) => zone.text).join(' ')).not.toMatch(/\+372|\bTEL\b/)
  })
})

describe('Latvian AIP outlines', () => {
  const border = (JSON.parse(readFileSync(new URL('../../public/data/lv-border.json', import.meta.url), 'utf8')).features[0].geometry.coordinates as Ring[])[0]
  const areas = parseAipAreas(read('airspace.eaip.html'), border)
  const area = (id: string) => areas.find((one) => one.id === id)!

  it('reads the designator, the name and plain corners', () => {
    expect(areas.map((one) => `${one.id} ${one.name}`)).toEqual([
      'EVR1 JURMALA',
      'EVR51 LOBE1',
      'EVR62A RUSONS1',
      'EVR66A INDZERIS1',
      'EVR69A PLISUNS1',
      'EVD203G DRUTEK',
    ])
    const [first, second] = area('EVR62A').ring!
    expect(first[0]).toBeCloseTo(25 + 44 / 60 + 41 / 3600)
    expect(first[1]).toBeCloseTo(56 + 4 / 60 + 25 / 3600)
    expect(second[1]).toBeCloseTo(56 + 16 / 60 + 30 / 3600)
    expect(area('EVR62A').ring).toHaveLength(5)
    expect(area('EVR51').ring).toHaveLength(6)
  })

  it('draws a circle of the stated radius', () => {
    const ring = area('EVR1').ring!
    // Half a nautical mile is half a minute of latitude.
    const lats = ring.map((point) => point[1])
    expect(Math.max(...lats) - Math.min(...lats)).toBeCloseTo(1 / 60, 4)
    expect(ring[0]).toEqual(ring[ring.length - 1])
  })

  it('follows the state border where the limits say so', () => {
    const ring = area('EVR66A').ring!
    // Four corners in the text; the stretch along the Estonian border brings the rest.
    expect(ring.length).toBeGreaterThan(20)
    expect(ring[0]).toEqual(ring[ring.length - 1])
    for (const [lon, lat] of ring) {
      expect(lon).toBeGreaterThan(26.3)
      expect(lon).toBeLessThan(27.4)
      expect(lat).toBeGreaterThan(57.2)
      expect(lat).toBeLessThan(57.7)
    }
    expect(parseLateralLimits('573427N0262331E - along the Latvian/Estonian State boundary to - 560000N0240000E - 573427N0262331E', border)).toBeNull()
  })

  it('rounds an arc instead of cutting the corner', () => {
    const ring = area('EVR69A').ring!
    const centre = [27 + 41 / 60 + 39 / 3600, 56 + 31 / 60 + 16 / 3600]
    // Points 4 NM from the centre that the text itself does not list.
    const onArc = ring.filter(([lon, lat]) => Math.abs(Math.hypot((lon - centre[0]) * Math.cos((lat * Math.PI) / 180), lat - centre[1]) - 4 / 60) < 0.003)
    expect(onArc.length).toBeGreaterThan(4)
  })

  it('leaves out an outline it has no data for', () => {
    // "along the territorial waters of the Republic of Latvia"
    expect(area('EVD203G').ring).toBeNull()
  })

  describe('joined to the valid NOTAM list', () => {
    const table: AreaTable = Object.fromEntries(areas.flatMap((one) => (one.ring ? [[one.id, { name: one.name, ring: tidyRing(one.ring)! }]] : [])))
    const zones = parseLgsNotams(read('airspace.lgs.html'), table, NOW)
    const notam = (number: string) => zones.find((zone) => zone.id === `air:lv:${number}`)!

    it('keeps the NOTAMs that restrict airspace, now or within two days', () => {
      // Left out: a closed aircraft stand, the checklist, an AIP trigger, cranes, and an activation ten days off.
      expect(zones.map((zone) => zone.id.slice(7)).sort()).toEqual(['A3951/26', 'A5397/26', 'A5656/26', 'A5675/26', 'A5677/26', 'A5683/26'])
      expect(zones.map((zone) => zone.military)).toEqual([true, true, true, true, true, false])
    })

    it('takes the outline from the AIP and the times from the NOTAM', () => {
      const lobe = notam('A5683/26')
      expect(lobe).toMatchObject({ title: 'EVR51 LOBE1', type: 'Restricted area', military: true, issuer: 'LGS NOTAM A5683/26' })
      expect(lobe.rings).toEqual([table.EVR51.ring])
      expect([iso(lobe.from), iso(lobe.to)]).toEqual(['2026-10-07T13:00', '2026-10-07T20:30'])
      expect(lobe.text).toBe('RESTRICTED AREA EVR51 LOBE1 ACT FOR MIL OPS\nSFC TO 4000FT AMSL')
      expect(notam('A5656/26').rings[0].length).toBeGreaterThan(20)
    })

    it('takes a NOTAM that draws its own area at its word', () => {
      const cekule = notam('A5397/26')
      expect(cekule.title).toBe('EVR490')
      expect(cekule.rings[0]).toHaveLength(5)
      expect(cekule.rings[0][0]).toEqual([24.3542, 56.9531])
      expect(cekule.text).toContain('Hours: DAILY 0500-1500')
      // Valid to the 18th, but only between those hours: at 16:00 UTC it is not in force.
      expect(cekule.schedule).toBe('DAILY 0500-1500')
      expect(zoneState(cekule, NOW)).toBe('idle')
      expect(notam('A5683/26').schedule).toBeUndefined()
    })

    it('draws two areas in one NOTAM as two, and reads hours that run over several lines', () => {
      const html = `<h6>A9001/26</h6><div class="p1">EVRR (RIGA FIR) <br>B)2026/10/04 18:30 C)2026/10/21 01:00  <br>D)04 1830-2359, 05 0000-0100, 08 <br>1830-2359, 09 0000-0100 <br>E)TEMPORARY RESTRICTED AREA ESTABLISHED FOR MILITARY OPERATIONS.<br>AREA 1: 565711N 0242115E - 565750N 0242822E - 565445N 0242935E - 565711N 0242115E.<br>AREA 2: 575711N 0262115E - 575750N 0262822E - 575445N 0262935E - 575400N <br>0262225E - 575711N 0262115E.<br></div>`
      const [zone] = parseLgsNotams(html, {}, NOW)
      expect(zone.rings.map((ring) => ring.length)).toEqual([4, 5])
      expect(zone.rings[1][0]).toEqual([26.3542, 57.9531])
      expect(zone.schedule).toBe('04 1830-2359, 05 0000-0100, 08 1830-2359, 09 0000-0100')
    })

    it('keeps what has no outline as text', () => {
      expect(notam('A5677/26')).toMatchObject({ title: 'EVTRA2', type: 'Reserved airspace', military: false, rings: [], point: null })
      expect(notam('A3951/26')).toMatchObject({ title: 'RIGA FIR', type: 'GNSS interference', rings: [] })
      expect(notam('A3951/26').text.length).toBeLessThanOrEqual(901)
    })
  })
})

describe('zone feeds', () => {
  const answering =
    (pages: Record<string, string>): FetchLike =>
    async (url) => {
      const host = new URL(url).host
      return host in pages ? new Response(pages[host]) : new Response('down', { status: 503 })
    }
  const load = async (feed: typeof navwarnFeed, fetch: FetchLike) => {
    const { snapshot } = await new FeedCache({ fetch, now: () => NOW, log: () => {} }).get(feed)
    return (snapshot.payload as PayloadOf<'zones'>).zones
  }

  it('serve one source while the other is down', async () => {
    const sea = await load(navwarnFeed, answering({ 'navvarn.sjofartsverket.se': read('navwarn.baltico.html') }))
    expect(sea).toHaveLength(10)
    const air = await load(airspaceFeed, answering({ 'utm.eans.ee': read('airspace.eans.json') }))
    expect(air.map((zone) => zone.id.slice(0, 6))).toEqual(['air:ee', 'air:ee', 'air:ee', 'air:ee'])
  })

  it('fail when every source is down, or when a page no longer reads as it did', async () => {
    await expect(load(navwarnFeed, answering({}))).rejects.toBeInstanceOf(FeedUnavailable)
    await expect(load(airspaceFeed, answering({ 'ais.lgs.lv': '<html>Maintenance</html>' }))).rejects.toBeInstanceOf(FeedUnavailable)
  })
})
