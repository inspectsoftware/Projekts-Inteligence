import { type ReadsbResponse, normaliseAircraft } from '../../shared/adapters/aircraft'
import { LATVIA_CENTER } from '../../shared/region'
import type { FeedDef } from './types'

// 250 nm is the largest radius adsb.fi serves, and it covers all of Latvia from the
// centre with about 100 nm to spare, so approaching traffic is visible too.
const RADIUS_NM = 250
const { lat, lon } = LATVIA_CENTER

// Both run readsb and answer with the same schema. adsb.lol is ODbL-licensed and comes
// first; adsb.fi (non-commercial use, credit required) covers for it when it is down.
const PRIMARY = `https://api.adsb.lol/v2/point/${lat}/${lon}/${RADIUS_NM}`
const FALLBACK = `https://opendata.adsb.fi/api/v3/lat/${lat}/lon/${lon}/dist/${RADIUS_NM}`

export const aircraftFeed: FeedDef = {
  id: 'aircraft',
  title: 'Aircraft',
  origins: ['https://api.adsb.lol', 'https://opendata.adsb.fi'],
  ttlMs: 10_000,
  staleMs: 90_000,
  waitMs: 1500,
  timeoutMs: 9000,
  attribution: [
    { label: 'adsb.lol (ODbL)', href: 'https://www.adsb.lol' },
    { label: 'adsb.fi', href: 'https://adsb.fi' },
  ],
  async load({ http }) {
    let raw: ReadsbResponse
    try {
      raw = await http.json<ReadsbResponse>(PRIMARY, { timeoutMs: 4500 })
    } catch {
      raw = await http.json<ReadsbResponse>(FALLBACK, { timeoutMs: 4000 })
    }
    return { shape: 'entities', entities: normaliseAircraft(raw, Date.now()) }
  },
}
