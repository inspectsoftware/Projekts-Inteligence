import { readFileSync } from 'node:fs'
import { latLngToCell } from 'h3-js'
import { describe, expect, it, vi } from 'vitest'
import { FeedCache } from '../../server/core/cache'
import { aircraftFeed, militaryAirFeed } from '../../server/feeds/aircraft'
import { gpsHexFeed } from '../../server/feeds/gpsHex'
import type { FeedDef } from '../../server/feeds/types'
import { type ReadsbResponse, mergeByHex, mergeMilitaryLists, normaliseAircraft } from '../../shared/adapters/aircraft'
import { type AircraftRole, KEY_ROLES, ROLE_ORDER, ROLE_TYPES, roleOf } from '../../shared/data/aircraftRoles'
import { type Aircraft, Flag, KNOTS_TO_MS } from '../../shared/entity'
import type { FeedId } from '../../shared/feeds'

// Recorded from adsb.lol on 2026-10-06 and trimmed to one aircraft of each interesting kind.
const fixture = JSON.parse(
  readFileSync(new URL('../fixtures/aircraft.adsblol.json', import.meta.url), 'utf8'),
) as ReadsbResponse

const RECEIVED_AT = Date.parse('2026-10-06T08:24:40Z')
const aircraft = normaliseAircraft(fixture, RECEIVED_AT)
const byCallsign = (callsign: string): Aircraft => {
  const found = aircraft.find((a) => a.props.callsign === callsign)
  if (!found) throw new Error(`${callsign} is not in the fixture`)
  return found
}
const has = (a: Aircraft, flag: number) => (a.flags & flag) !== 0

describe('normaliseAircraft', () => {
  it('keeps every aircraft that has a position', () => {
    expect(aircraft).toHaveLength(fixture.ac!.length)
    expect(new Set(aircraft.map((a) => a.id)).size).toBe(aircraft.length)
  })

  it('converts aviation units to SI', () => {
    const sas = byCallsign('SAS1136')
    expect(sas.id).toBe('aircraft:4ab56e')
    expect(sas.alt).toBe(Math.round(15075 * 0.3048))
    expect(sas.spd).toBeCloseTo(285.8 * 0.514444, 3)
    expect(sas.trk).toBeCloseTo(21.99)
    expect(sas.props).toMatchObject({ registration: 'SE-MKN', type: 'AT76', source: 'adsb', squawk: '1000' })
  })

  it('dates each position back from our own clock by its reported age', () => {
    // seen_pos is 0.311 s in the fixture; the aggregator's own clock is deliberately ignored.
    expect(byCallsign('SAS1136').ts).toBe(RECEIVED_AT - 311)
  })

  it('flags military aircraft from the database bit', () => {
    expect(has(byCallsign('BRIO66'), Flag.MIL)).toBe(true)
    expect(has(byCallsign('SAS1136'), Flag.MIL)).toBe(false)
  })

  it('flags aircraft that lost GPS or report no position integrity', () => {
    // Had a good fix, then lost it (now positioned by multilateration).
    expect(has(byCallsign('SAS745'), Flag.GPS_DEGRADED)).toBe(true)
    expect(byCallsign('SAS745').props).toMatchObject({ gpsLost: true, source: 'mlat' })
    // Still on ADS-B, but reporting zero integrity and accuracy.
    expect(has(byCallsign('THA960'), Flag.GPS_DEGRADED)).toBe(true)
    // Healthy.
    expect(has(byCallsign('FIN1EG'), Flag.GPS_DEGRADED)).toBe(false)
  })

  it('does not accuse version 0 transponders, which never report integrity', () => {
    const nordwind = byCallsign('NWS855')
    expect(nordwind.props).toMatchObject({ nic: 0, nacP: 0, reportsIntegrity: false })
    expect(has(nordwind, Flag.GPS_DEGRADED)).toBe(false)
  })

  it('marks aircraft on the ground and keeps them out of the GPS test', () => {
    const taxiing = byCallsign('BTI35G')
    expect(has(taxiing, Flag.ON_GROUND)).toBe(true)
    expect(taxiing.alt).toBe(0)
    expect(has(taxiing, Flag.GPS_DEGRADED)).toBe(false)
  })

  it('labels by callsign, then registration, then hex', () => {
    expect(byCallsign('SAS1136').label).toBe('SAS1136')
    const anonymous = aircraft.find((a) => a.props.hex === '4ab422')!
    expect(anonymous.props.callsign).toBeNull()
    expect(anonymous.label).toBe(anonymous.props.registration ?? '4AB422')
  })

  it('skips targets without a position and flags emergency squawks', () => {
    const out = normaliseAircraft(
      { ac: [{ hex: 'aaaaaa' }, { hex: 'bbbbbb', lat: 57, lon: 24, squawk: '7700', seen_pos: 2 }] },
      1_000_000,
    )
    expect(out).toHaveLength(1)
    expect(has(out[0], Flag.EMERGENCY)).toBe(true)
    expect(out[0].ts).toBe(998_000)
    expect(out[0].label).toBe('BBBBBB')
  })
})

describe('aircraft feed', () => {
  const ok = () => new Response(JSON.stringify(fixture), { headers: { 'content-type': 'application/json' } })

  it('falls back to the second provider when the first one fails', async () => {
    const called: string[] = []
    const cache = new FeedCache({
      log: () => {},
      fetch: async (url) => {
        called.push(new URL(url).host)
        return called.length === 1 ? new Response('bad gateway', { status: 502 }) : ok()
      },
    })

    const { snapshot } = await cache.get(aircraftFeed)
    expect(called).toEqual(['api.adsb.lol', 'opendata.adsb.fi'])
    expect(snapshot.count).toBe(aircraft.length)
  })

  it('identifies itself to the upstream', async () => {
    let userAgent: string | null = null
    const cache = new FeedCache({
      log: () => {},
      fetch: async (_url, init) => {
        userAgent = new Headers(init.headers).get('user-agent')
        return ok()
      },
    })
    await cache.get(aircraftFeed)
    expect(userAgent).toMatch(/^ProjektsInteligence\//)
  })
})

describe('aircraft roles', () => {
  const role = (type: string | null, category: string | null = null, hex = '000000', description: string | null = null) =>
    roleOf({ hex, type, category, description })

  it('reads the role off well-known types', () => {
    const known: Record<AircraftRole, string[]> = {
      isr: ['R135', 'U2'],
      aew: ['E3TF', 'E737'],
      tanker: ['K35R', 'A332'],
      mpa: ['P8', 'P3'],
      uav: ['Q4', 'Q9'],
      bomber: ['B52', 'B1'],
      fighter: ['F16', 'F35', 'EUFI'],
      transport: ['C17', 'C130', 'C295'],
      helicopter: ['H60', 'NH90'],
      trainer: ['HAWK', 'PC21'],
      vip: ['GLF5', 'B752'],
    }
    for (const [expected, types] of Object.entries(known)) {
      for (const type of types) expect(role(type), type).toBe(expected)
    }
    // The ones worth noticing lead the order the lists are sorted by.
    expect(ROLE_ORDER.slice(0, KEY_ROLES.size).every((key) => KEY_ROLES.has(key))).toBe(true)
  })

  it('leaves a type it does not know, or cannot be sure of, without a role', () => {
    expect(role('PC12')).toBeNull()
    expect(role('W3')).toBeNull()
    expect(role('E6')).toBeNull()
    expect(role(null)).toBeNull()
  })

  it('calls a King Air, Challenger or Global ISR only when its description names such a variant', () => {
    const named = (type: string, description: string | null) => role(type, null, '000000', description)
    // Descriptions as adsb.fi sent them on 2026-10-06.
    expect(named('B350', 'Beech Shadow R1+')).toBe('isr')
    expect(named('GLEX', 'Bombardier ATHENA-R')).toBe('isr')
    expect(named('BE20', 'Beech C-12U Huron')).toBeNull()
    expect(named('BE20', 'BEECH 200 Super King Air')).toBeNull()
    expect(named('CL60', 'BOMBARDIER CL-600 Challenger')).toBeNull()
    expect(named('GLEX', null)).toBeNull()
    // The words only count for these types.
    expect(named('PC12', 'Shadow')).toBeNull()
  })

  it('falls back on what the transponder says the aircraft is', () => {
    expect(role('W3', 'A7')).toBe('helicopter')
    expect(role(null, 'B6')).toBe('uav')
    expect(role('PC12', 'A1')).toBeNull()
  })

  it('knows the three Swedish signals aircraft by airframe, not by type', () => {
    expect(role('GLF4', 'A3', '4a8199')).toBe('isr')
    expect(role('GLF4', 'A3', 'a12345')).toBeNull()
  })

  it('lists every designator under one role only', () => {
    const all = Object.values(ROLE_TYPES).flat()
    expect(new Set(all).size).toBe(all.length)
  })

  it('gives only military aircraft a role', () => {
    const at = { lat: 57, lon: 24 }
    const [airliner, tanker] = normaliseAircraft({ ac: [{ hex: 'aaaaaa', t: 'A332', ...at }, { hex: 'bbbbbb', t: 'A332', dbFlags: 1, ...at }] }, 0)
    expect(airliner.props.role).toBeNull()
    expect(tanker.props.role).toBe('tanker')
    // A military Challenger, and nothing to say which kind.
    expect(byCallsign('BRIO66').props.role).toBeNull()
  })
})

// Trimmed from the two worldwide military lists as they answered on 2026-10-06 15:50 UTC.
// BRIO66 and its description are added to them by hand: it is the one military aircraft in the regional fixture.
const MIL_FI: ReadsbResponse = {
  ac: [
    { hex: '33ffdc', type: 'mlat', flight: 'LYF278  ', r: '06 BLUE', t: 'C27J', dbFlags: 1, desc: 'ALENIA C-27J Spartan', alt_baro: 25000, gs: 324, lat: 53.909016, lon: 20.770164, seen_pos: 4.088 },
    { hex: '48d844', type: 'adsb_icao', flight: 'PLF034H ', r: '015', t: 'C295', dbFlags: 1, desc: 'CASA C-295 Persuader', alt_baro: 13300, gs: 243, lat: 52.995842, lon: 15.720655, seen_pos: 1.041 },
    { hex: 'a0ec98', type: 'adsb_icao', flight: 'BRIO66  ', r: 'N159L', t: 'CL60', dbFlags: 1, desc: 'BOMBARDIER Challenger 600', gs: 100, lat: 55.7, lon: 19.3, seen_pos: 20 },
    // Over the United States: on the list, but nowhere near the area of interest.
    { hex: 'ae0673', type: 'mlat', t: 'K35R', dbFlags: 1, alt_baro: 30000, gs: 417, lat: 38.9, lon: -77.0, seen_pos: 4.659 },
  ],
}
const MIL_LOL: ReadsbResponse = {
  ac: [
    // The same aircraft as above, with the halved ground speed adsb.lol gives some multilaterated targets.
    { hex: '33ffdc', type: 'mlat', flight: 'LYF278  ', r: '06 BLUE', t: 'C27J', dbFlags: 1, alt_baro: 25000, gs: 165, lat: 53.909082, lon: 20.774695, seen_pos: 0.84 },
    // Also on both lists. This position is made the older one by hand.
    { hex: '48d844', type: 'adsb_icao', flight: 'PLF034H ', r: '015', t: 'C295', dbFlags: 1, alt_baro: 13300, gs: 243, lat: 52.96, lon: 15.68, seen_pos: 14.2 },
    { hex: '467891', type: 'adsb_icao', flight: 'T22     ', r: 'PI-02', t: 'PC12', category: 'A1', dbFlags: 1, version: 2, nic: 8, nac_p: 10, alt_baro: 27000, gs: 240.1, lat: 62.880432, lon: 24.101257, seen_pos: 0.221 },
  ],
}

describe('merging aircraft lists', () => {
  const fi = normaliseAircraft(MIL_FI, RECEIVED_AT)
  const lol = normaliseAircraft(MIL_LOL, RECEIVED_AT)

  it('keeps one record per aircraft: the first list wins, the second fills in', () => {
    const merged = mergeByHex(fi, lol)
    expect(merged.map((a) => a.props.hex)).toEqual(['33ffdc', '48d844', 'a0ec98', 'ae0673', '467891'])
    expect(merged[0].spd).toBeCloseTo(324 * KNOTS_TO_MS, 3)
    expect(merged[0].props.description).toBe('ALENIA C-27J Spartan')
  })

  it('takes the airframe description from the second list when the first has none', () => {
    const [spartan] = mergeByHex(lol, fi)
    expect(spartan.spd).toBeCloseTo(165 * KNOTS_TO_MS, 3)
    expect(spartan.props.description).toBe('ALENIA C-27J Spartan')
  })

  it('keeps an aircraft military, with its role, when only the second list says it is', () => {
    const at = { lat: 57, lon: 24 }
    const [regional] = normaliseAircraft({ ac: [{ hex: '43c6f4', t: 'B350', ...at }] }, RECEIVED_AT)
    const [listed] = normaliseAircraft({ ac: [{ hex: '43c6f4', t: 'B350', dbFlags: 1, desc: 'Beech Shadow R1+', lat: 56, lon: 23 }] }, RECEIVED_AT)
    expect(has(regional, Flag.MIL)).toBe(false)

    const [merged] = mergeByHex([regional], [listed])
    expect(merged).toMatchObject(at)
    expect(has(merged, Flag.MIL)).toBe(true)
    expect(merged.props).toMatchObject({ role: 'isr', description: 'Beech Shadow R1+' })
  })

  it('keeps the newer position of the two military lists, and the details only adsb.fi has with it', () => {
    const merged = mergeMilitaryLists(fi, lol)
    expect(merged.map((a) => a.props.hex)).toEqual(['33ffdc', '48d844', 'a0ec98', 'ae0673', '467891'])

    // adsb.lol heard the Spartan last. Its multilaterated speed is not trusted, so that stays adsb.fi's.
    const [spartan, persuader] = merged
    expect(spartan).toMatchObject({ lon: 20.774695, ts: RECEIVED_AT - 840 })
    expect(spartan.spd).toBeCloseTo(324 * KNOTS_TO_MS, 3)
    expect(spartan.props.description).toBe('ALENIA C-27J Spartan')
    // adsb.fi heard this one last.
    expect(persuader).toMatchObject({ lon: 15.720655, ts: RECEIVED_AT - 1041 })
  })

  it('takes a speed that is not multilaterated from whichever list has the newer position', () => {
    const report = (gs: number, seen_pos: number): ReadsbResponse => ({
      ac: [{ hex: '48d844', type: 'adsb_icao', dbFlags: 1, gs, lat: 53, lon: 15.7, seen_pos }],
    })
    const [merged] = mergeMilitaryLists(normaliseAircraft(report(243, 9), RECEIVED_AT), normaliseAircraft(report(251, 1), RECEIVED_AT))
    expect(merged.spd).toBeCloseTo(251 * KNOTS_TO_MS, 3)
  })
})

describe('military aircraft feed', () => {
  const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })
  const FEEDS: Partial<Record<FeedId, FeedDef>> = { aircraft: aircraftFeed, 'aircraft-mil': militaryAirFeed, 'gps-hex': gpsHexFeed }

  /** A cache over fake upstreams, with a clock the test moves and a tally of what was asked for. */
  function harness(down: readonly string[] = []) {
    const calls = { regional: 0, military: 0 }
    let now = Date.parse('2026-10-06T15:50:00Z')
    const cache = new FeedCache({
      log: () => {},
      now: () => now,
      resolve: (id) => FEEDS[id],
      fetch: async (url) => {
        const military = url.endsWith('/v2/mil')
        calls[military ? 'military' : 'regional'] += 1
        if (down.some((host) => url.includes(host) && military)) return new Response('bad gateway', { status: 502 })
        return json(!military ? fixture : url.includes('adsb.fi') ? MIL_FI : MIL_LOL)
      },
    })
    return { cache, calls, advance: (ms: number) => (now += ms) }
  }
  const entitiesOf = async (cache: FeedCache, def: FeedDef) => {
    const { payload } = (await cache.get(def)).snapshot
    return payload.shape === 'entities' ? (payload.entities as Aircraft[]) : []
  }

  it('merges both lists and keeps what is inside the area of interest', async () => {
    const list = await entitiesOf(harness().cache, militaryAirFeed)
    expect(list.map((a) => a.label)).toEqual(['LYF278', 'PLF034H', 'BRIO66', 'T22'])
    expect(list.every((a) => (a.flags & Flag.MIL) !== 0)).toBe(true)
  })

  it('makes do with one list when the other is down, and fails only when both are', async () => {
    expect((await entitiesOf(harness(['adsb.lol']).cache, militaryAirFeed)).map((a) => a.label)).toEqual(['LYF278', 'PLF034H', 'BRIO66'])
    expect((await entitiesOf(harness(['adsb.fi']).cache, militaryAirFeed)).map((a) => a.label)).toEqual(['LYF278', 'PLF034H', 'T22'])
    await expect(harness(['adsb.lol', 'adsb.fi']).cache.get(militaryAirFeed)).rejects.toThrow(/HTTP 502/)
  })

  it('adds the far military aircraft to the regional picture, once each', async () => {
    const all = await entitiesOf(harness().cache, aircraftFeed)
    expect(all).toHaveLength(aircraft.length + 3)
    expect(new Set(all.map((a) => a.id)).size).toBe(all.length)

    // Known to both: the regional record is the fresh one, the list only adds the description.
    const brio = all.find((a) => a.props.callsign === 'BRIO66')!
    expect(brio).toMatchObject({ lon: 19.414215, lat: 55.804402 })
    expect(brio.props).toMatchObject({ role: null, description: 'BOMBARDIER Challenger 600' })
    expect(all.find((a) => a.props.callsign === 'PLF034H')!.props).toMatchObject({ role: 'transport', type: 'C295' })
  })

  it('serves the regional picture alone when both lists are down', async () => {
    const all = await entitiesOf(harness(['adsb.lol', 'adsb.fi']).cache, aircraftFeed)
    expect(all).toHaveLength(aircraft.length)
  })

  it('reads the lists a third as often as the regional picture', async () => {
    const { cache, calls, advance } = harness()
    // One minute of a visitor polling every ten seconds.
    for (let poll = 0; poll < 6; poll++) {
      await cache.get(aircraftFeed)
      advance(10_500)
    }
    expect(calls).toEqual({ regional: 6, military: 4 })
  })

  it('keeps the far military aircraft out of the GPS interference picture', async () => {
    const { cache } = harness()
    const { payload } = (await cache.get(gpsHexFeed)).snapshot
    const cells = payload.shape === 'cells' ? payload.cells.map((cell) => cell.id) : []
    // Both report healthy GPS: T22 from the military list over central Finland, FIN2NP from the regional fixture north of Rīga.
    expect(cells).not.toContain(latLngToCell(62.880432, 24.101257, 4))
    expect(cells).toContain(latLngToCell(57.388092, 24.114304, 4))
  })

  it('leaves adsb.fi a second between requests when it has to stand in for adsb.lol on both counts', async () => {
    const askedAt: number[] = []
    const cache = new FeedCache({
      log: () => {},
      resolve: (id) => FEEDS[id],
      fetch: async (url) => {
        if (url.includes('adsb.lol')) return new Response('bad gateway', { status: 502 })
        askedAt.push(Date.now())
        return json(url.endsWith('/v2/mil') ? MIL_FI : fixture)
      },
    })
    expect(await entitiesOf(cache, aircraftFeed)).toHaveLength(aircraft.length + 2)
    expect(askedAt).toHaveLength(2)
    expect(askedAt[1] - askedAt[0]).toBeGreaterThanOrEqual(1000)
  })

  it('does not hold the regional picture back for a list that is slow to arrive', async () => {
    vi.useFakeTimers()
    try {
      const cache = new FeedCache({
        log: () => {},
        resolve: (id) => FEEDS[id],
        // Neither list ever answers.
        fetch: (url) => (url.endsWith('/v2/mil') ? new Promise<Response>(() => {}) : Promise.resolve(json(fixture))),
      })
      const answer = entitiesOf(cache, aircraftFeed)
      await vi.advanceTimersByTimeAsync(1000)
      expect(await answer).toHaveLength(aircraft.length)
    } finally {
      vi.useRealTimers()
    }
  })

  it('leaves the adsb.lol list alone for a while after being turned away', async () => {
    const asked = { lol: 0, fi: 0 }
    // The module remembers the rest, so this clock runs a day behind the other tests': for them it is long over.
    let now = Date.parse('2026-10-05T15:50:00Z')
    const cache = new FeedCache({
      log: () => {},
      now: () => now,
      fetch: async (url) => {
        const lol = url.includes('adsb.lol')
        asked[lol ? 'lol' : 'fi'] += 1
        return lol && asked.lol === 1 ? new Response('too many requests', { status: 429 }) : json(lol ? MIL_LOL : MIL_FI)
      },
    })
    const labels = async () => (await entitiesOf(cache, militaryAirFeed)).map((a) => a.label)

    expect(await labels()).toEqual(['LYF278', 'PLF034H', 'BRIO66'])
    now += 31_000
    expect(await labels()).toEqual(['LYF278', 'PLF034H', 'BRIO66'])
    expect(asked).toEqual({ lol: 1, fi: 2 })

    now += 5 * 60_000
    expect(await labels()).toContain('T22')
    expect(asked.lol).toBe(2)
  })
})
