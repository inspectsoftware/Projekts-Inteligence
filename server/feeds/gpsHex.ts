import { cellToBoundary, latLngToCell } from 'h3-js'
import { type Aircraft, Flag } from '../../shared/entity'
import type { GpsCell } from '../../shared/feeds'
import type { FeedDef } from './types'

/** H3 resolution 4: hexagons about 45 km across, the scale gpsjam.org uses. */
const RESOLUTION = 4
/** How far back the map looks. Long enough to gather traffic, short enough to show interference coming and going. */
const WINDOW_MS = 90 * 60 * 1000

interface Sighting {
  /** Sticky: an aircraft that lost GPS anywhere in this cell counts as affected there. */
  bad: boolean
  at: number
}

/**
 * Where aircraft have been reporting healthy or degraded GPS, cell by cell.
 *
 * Aircraft broadcast how much they trust their own position. Counting, per map cell,
 * how many passing aircraft reported trouble gives a picture of GPS interference
 * that needs no data beyond the ADS-B feed already being polled.
 */
export class GpsInterferenceMap {
  private readonly cells = new Map<string, Map<string, Sighting>>()
  private since = 0

  /** Folds one aircraft snapshot in. Aircraft that say nothing about integrity are ignored. */
  observe(aircraft: readonly Aircraft[], now: number): void {
    if (this.since === 0) this.since = now
    for (const a of aircraft) {
      if ((a.flags & Flag.ON_GROUND) !== 0) continue
      const bad = (a.flags & Flag.GPS_DEGRADED) !== 0
      const good = !bad && a.props.reportsIntegrity && a.props.source === 'adsb'
      if (!bad && !good) continue

      const cell = latLngToCell(a.lat, a.lon, RESOLUTION)
      let sightings = this.cells.get(cell)
      if (!sightings) {
        sightings = new Map()
        this.cells.set(cell, sightings)
      }
      const previous = sightings.get(a.props.hex)
      sightings.set(a.props.hex, { bad: bad || previous?.bad === true, at: now })
    }
    this.prune(now)
  }

  private prune(now: number): void {
    const cutoff = now - WINDOW_MS
    for (const [cell, sightings] of this.cells) {
      for (const [hex, sighting] of sightings) if (sighting.at < cutoff) sightings.delete(hex)
      if (sightings.size === 0) this.cells.delete(cell)
    }
    this.since = Math.max(this.since, cutoff)
  }

  /** When the current picture starts: the window's edge, or later if the process has not been up that long. */
  get windowStart(): number {
    return this.since
  }

  view(): GpsCell[] {
    const out: GpsCell[] = []
    for (const [id, sightings] of this.cells) {
      let bad = 0
      for (const sighting of sightings.values()) if (sighting.bad) bad += 1
      out.push({
        id,
        boundary: cellToBoundary(id, true).map(([lon, lat]) => [round(lon), round(lat)]),
        good: sightings.size - bad,
        bad,
      })
    }
    return out
  }
}

const round = (value: number) => Math.round(value * 1e4) / 1e4

const map = new GpsInterferenceMap()
let lastObserved = 0

/** Called with every fresh aircraft snapshot, whether or not anyone is looking at the hex layer. */
export function observeAircraft(aircraft: readonly Aircraft[], now: number): void {
  if (now === lastObserved) return
  lastObserved = now
  map.observe(aircraft, now)
}

export const gpsHexFeed: FeedDef = {
  id: 'gps-hex',
  title: 'GPS interference',
  origins: [],
  ttlMs: 30_000,
  staleMs: 10 * 60 * 1000,
  attribution: [{ label: 'Derived from ADS-B integrity reports (adsb.lol)', href: 'https://www.adsb.lol' }],
  async load({ feed }) {
    // Asking for the aircraft feed refreshes it when due, and each refresh is folded in above.
    // If it is unavailable the picture simply stops growing; what is already known still stands.
    await feed('aircraft').catch(() => undefined)
    return { shape: 'cells', windowStart: map.windowStart, cells: map.view() }
  },
}
