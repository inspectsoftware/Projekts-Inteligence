import { type ReadsbResponse, mergeByHex, mergeMilitaryLists, normaliseAircraft } from '../../shared/adapters/aircraft'
import type { Aircraft } from '../../shared/entity'
import { AOI_BBOX, LATVIA_CENTER, inBBox } from '../../shared/region'
import { type Upstream, UpstreamError } from '../core/upstream'
import { observeAircraft } from './gpsHex'
import type { FeedDef } from './types'

// 250 nm is the largest radius adsb.fi serves, and it covers all of Latvia from the
// centre with about 100 nm to spare, so approaching traffic is visible too.
const RADIUS_NM = 250
const { lat, lon } = LATVIA_CENTER

export const ADSB_LOL = 'https://api.adsb.lol'
export const ADSB_FI = 'https://opendata.adsb.fi'

// Both run readsb and answer with the same schema. adsb.lol is ODbL-licensed and comes
// first; adsb.fi (non-commercial use, credit required) covers for it when it is down.
const PRIMARY = `${ADSB_LOL}/v2/point/${lat}/${lon}/${RADIUS_NM}`
const FALLBACK = `${ADSB_FI}/api/v3/lat/${lat}/lon/${lon}/dist/${RADIUS_NM}`

const ORIGINS = [ADSB_LOL, ADSB_FI]
const CREDITS = [
  { label: 'adsb.lol (ODbL)', href: 'https://www.adsb.lol' },
  { label: 'adsb.fi', href: 'https://adsb.fi' },
]

const FI_GAP_MS = 1100
const fiAskedAt = { regional: 0, list: 0 }

/**
 * adsb.fi allows one request a second. Its regional answer and its military list are only wanted
 * that close together while adsb.lol is down, and then whichever comes second waits its turn.
 */
async function askFi(http: Upstream, what: 'regional' | 'list', url: string): Promise<ReadsbResponse> {
  const wait = fiAskedAt[what === 'list' ? 'regional' : 'list'] + FI_GAP_MS - Date.now()
  if (wait > 0) await new Promise((done) => setTimeout(done, wait))
  fiAskedAt[what] = Date.now()
  return http.json<ReadsbResponse>(url, { timeoutMs: 4000 })
}

const LOL_REST_MS = 5 * 60_000
let lolListRestsUntil = 0

/**
 * adsb.lol turns callers away now and then (HTTP 429, or 420) without saying for how long. Its
 * list is then left alone for a few minutes, so what it does allow goes to the regional picture.
 */
async function askLolList(http: Upstream, now: number): Promise<ReadsbResponse> {
  if (now < lolListRestsUntil) throw new UpstreamError('http', 'api.adsb.lol asked for fewer requests')
  try {
    return await http.json<ReadsbResponse>(`${ADSB_LOL}/v2/mil`, { timeoutMs: 4500 })
  } catch (err) {
    if (err instanceof UpstreamError && (err.status === 429 || err.status === 420)) {
      lolListRestsUntil = now + (err.retryAfterMs ?? LOL_REST_MS)
    }
    throw err
  }
}

/**
 * How long the regional picture waits for the military list. Longer than the list's own waitMs,
 * so a copy that is in the cache always makes it; only a list that has to be fetched first can miss.
 */
const LIST_WAIT_MS = 1000

/**
 * Military aircraft everywhere, from the worldwide lists both aggregators publish. One answer
 * serves every visitor wherever they are looking, so the whole world costs what the Baltic did. Read every 30 s, a third as often as the regional picture: seen from this far out,
 * a position half a minute old is still in the right place on the map.
 */
export const militaryAirFeed: FeedDef = {
  id: 'aircraft-mil',
  title: 'Military aircraft',
  origins: ORIGINS,
  ttlMs: 30_000,
  // Past this the far aircraft are dropped rather than left hanging where they were last seen.
  staleMs: 2 * 60_000,
  waitMs: 750,
  timeoutMs: 9000,
  attribution: CREDITS,
  async load({ http, now }) {
    const read = async (answer: Promise<ReadsbResponse>) => normaliseAircraft(await answer, Date.now())
    const [fi, lol] = await Promise.allSettled([
      read(askFi(http, 'list', `${ADSB_FI}/api/v2/mil`)),
      read(askLolList(http, now)),
    ])
    // Each hears aircraft the other misses, and either alone is still worth having.
    if (fi.status === 'rejected' && lol.status === 'rejected') throw fi.reason
    const entities = mergeMilitaryLists(fi.status === 'fulfilled' ? fi.value : [], lol.status === 'fulfilled' ? lol.value : [])
    return { shape: 'entities', entities }
  },
}

/**
 * Every aircraft within 250 nm of Latvia's centre, refreshed every 10 s, plus the military
 * aircraft of the wider region from the slower list above.
 */
export const aircraftFeed: FeedDef = {
  id: 'aircraft',
  title: 'Aircraft',
  origins: ORIGINS,
  ttlMs: 10_000,
  staleMs: 90_000,
  waitMs: 1500,
  timeoutMs: 9000,
  attribution: CREDITS,
  async load({ http, feed }) {
    // Asked for alongside the regional picture, which stands on its own when the list is
    // unavailable, and does not wait long for it either. After a quiet spell the list has to be
    // fetched first, which can take seconds: the next refresh, ten seconds on, finds it in the cache.
    const military = Promise.race([
      // Only the region's: the alerts, the counts and the Military window all read this feed as "here".
      feed('aircraft-mil').then(({ payload }) =>
        payload.shape === 'entities' ? (payload.entities as Aircraft[]).filter((aircraft) => inBBox(aircraft.lon, aircraft.lat, AOI_BBOX)) : [],
      ),
      new Promise<Aircraft[]>((done) => setTimeout(done, LIST_WAIT_MS, [])),
    ]).catch(() => [])

    let raw: ReadsbResponse
    try {
      raw = await http.json<ReadsbResponse>(PRIMARY, { timeoutMs: 4500 })
    } catch {
      raw = await askFi(http, 'regional', FALLBACK)
    }
    const receivedAt = Date.now()
    const regional = normaliseAircraft(raw, receivedAt)
    // Interference is worked out from the regional picture only, where there is enough traffic
    // for a cell to mean something. The far military aircraft would scatter cells holding a
    // single aircraft across half of Europe, each counted afresh from a position up to 30 s old.
    observeAircraft(regional, receivedAt)
    return { shape: 'entities', entities: mergeByHex(regional, await military) }
  },
}
