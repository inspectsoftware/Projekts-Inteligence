import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { FeedCache } from '../../server/core/cache'
import { aircraftFeed } from '../../server/feeds/aircraft'
import { type ReadsbResponse, normaliseAircraft } from '../../shared/adapters/aircraft'
import { type Aircraft, Flag } from '../../shared/entity'

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
    expect(userAgent).toMatch(/^ProjectWhiteHornet\//)
  })
})
