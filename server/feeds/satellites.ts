import { mergeElements, normaliseElements } from '../../shared/adapters/satellites'
import { type OrbitalElement, SAT_GROUPS } from '../../shared/feeds'
import type { FeedDef } from './types'

const GP = 'https://celestrak.org/NORAD/elements/gp.php'

// JSON (OMM), not the classic two-line format: catalogue numbers passed 99999 in 2026
// and newer objects can no longer be written as TLEs at all.
const urlFor = (group: string) => `${GP}?GROUP=${group}&FORMAT=json`

/**
 * Orbital elements for the satellites worth watching over Latvia: stations, weather,
 * Earth observation, military and navigation, about 460 objects. The browser turns
 * them into positions itself, so this is only fetched again when CelesTrak has new data.
 */
export const satellitesFeed: FeedDef = {
  id: 'satellites',
  title: 'Satellites',
  origins: ['https://celestrak.org'],
  // CelesTrak updates every two hours and asks that each set be fetched no more often than that.
  ttlMs: 2 * 60 * 60 * 1000,
  // Elements a few days old still place a satellite within a few kilometres.
  staleMs: 3 * 24 * 60 * 60 * 1000,
  timeoutMs: 30_000,
  persist: true,
  attribution: [{ label: 'CelesTrak', href: 'https://celestrak.org' }],
  async load({ http }) {
    const groups: OrbitalElement[][] = []
    // One at a time: five small files, and no reason to hit a free service in parallel.
    for (const group of SAT_GROUPS) {
      groups.push(normaliseElements(await http.json(urlFor(group), { timeoutMs: 8000 }), group))
    }
    return { shape: 'elements', sats: mergeElements(groups) }
  },
}
