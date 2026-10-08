import { type ReadsbResponse, normaliseAircraft } from '../../shared/adapters/aircraft'
import type { Aircraft } from '../../shared/entity'
import { type FetchLike, UpstreamError, createUpstream } from '../core/upstream'
import { ADSB_FI, ADSB_LOL } from '../feeds/aircraft'

/** The grid the world is asked about in: a 250 nm circle round a cell's centre covers all of it, to about 70° of latitude. */
const CELL_DEG = 4
const RADIUS_NM = 250
const FRESH_MS = 10_000
const MAX_CELLS = 40
/** Across every visitor and every cell. The regional picture shares these services and comes first. */
const SPACING_MS = 1500
const MAX_WAITING = 4
const REST_MS = 5 * 60_000

export class ViewBusy extends Error {}

export interface AircraftView {
  cell: string
  updatedAt: number
  entities: Aircraft[]
}

/** The cell a point falls in, named by its centre. */
export function cellOf(lat: number, lon: number): { lat: number; lon: number; key: string } {
  const centre = (value: number) => Math.floor(value / CELL_DEG) * CELL_DEG + CELL_DEG / 2
  const cell = { lat: centre(Math.min(89.9, Math.max(-89.9, lat))), lon: centre(((((lon + 180) % 360) + 360) % 360) - 180) }
  return { ...cell, key: `${cell.lat},${cell.lon}` }
}

/**
 * Aircraft around wherever a visitor is looking, outside the region the aircraft feed covers.
 *
 * Unlike every feed, this one's load on its sources grows with the number of different places being
 * looked at. It is therefore bounded three ways: answers are shared per cell for ten seconds, only
 * so many cells are held, and the sources are asked at most once every second and a half however
 * many visitors there are. Past a short queue a request is refused, and a source that asks for
 * fewer requests is left alone for five minutes.
 */
export function createViewAircraft(fetchImpl?: FetchLike, now: () => number = Date.now): { around(lat: number, lon: number): Promise<AircraftView> } {
  const cells = new Map<string, { at: number; view: Promise<AircraftView> }>()
  let queue: Promise<unknown> = Promise.resolve()
  let waiting = 0
  let lolRestsUntil = 0

  async function read(cell: ReturnType<typeof cellOf>): Promise<AircraftView> {
    const http = createUpstream([ADSB_LOL, ADSB_FI], AbortSignal.timeout(12_000), fetchImpl)
    let raw: ReadsbResponse | undefined
    // adsb.lol turns callers away now and then without saying for how long. It is then left to
    // the regional picture for a few minutes, and adsb.fi answers here.
    if (now() >= lolRestsUntil) {
      try {
        raw = await http.json<ReadsbResponse>(`${ADSB_LOL}/v2/point/${cell.lat}/${cell.lon}/${RADIUS_NM}`, { timeoutMs: 5000 })
      } catch (err) {
        if (err instanceof UpstreamError && (err.status === 429 || err.status === 420)) lolRestsUntil = now() + (err.retryAfterMs ?? REST_MS)
      }
    }
    raw ??= await http.json<ReadsbResponse>(`${ADSB_FI}/api/v3/lat/${cell.lat}/lon/${cell.lon}/dist/${RADIUS_NM}`, { timeoutMs: 5000 })
    return { cell: cell.key, updatedAt: now(), entities: normaliseAircraft(raw, now()) }
  }

  return {
    around(lat, lon) {
      const cell = cellOf(lat, lon)
      const held = cells.get(cell.key)
      if (held && now() - held.at < FRESH_MS) return held.view
      if (waiting >= MAX_WAITING) return Promise.reject(new ViewBusy('Too many aircraft lookups are waiting'))

      waiting += 1
      const view = queue.then(() => read(cell)).finally(() => {
        waiting -= 1
      })
      queue = view.catch(() => undefined).then(() => new Promise((resolve) => setTimeout(resolve, SPACING_MS)))
      // The oldest cell makes room: nobody has asked about it for the longest.
      if (cells.size >= MAX_CELLS && !held) cells.delete(cells.keys().next().value!)
      cells.delete(cell.key)
      cells.set(cell.key, { at: now(), view })
      view.catch(() => cells.delete(cell.key))
      return view
    },
  }
}
