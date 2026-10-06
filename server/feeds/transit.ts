import { type TransitNetwork, type TransitVehicle, normaliseGpsTxt } from '../../shared/adapters/transit'
import { UpstreamError } from '../core/upstream'
import type { FeedDef } from './types'

// Live vehicle positions for the networks that publish them through marsruti.lv.
// Rīgas Satiksme's own position file (saraksti.rigassatiksme.lv/gps.txt) did not answer
// from Latvia on 2026-10-06, day or night, so Rīga is not here yet.
const NETWORKS: readonly (TransitNetwork & { url: string })[] = [
  { id: 'liepaja', name: 'Liepāja', url: 'https://marsruti.lv/liepaja/gps.txt' },
  { id: 'rezekne', name: 'Rēzekne', url: 'https://marsruti.lv/rezekne/gps.txt' },
  { id: 'regional', name: 'Regional buses', url: 'https://marsruti.lv/LSA/gps.txt' },
]

export const transitFeed: FeedDef = {
  id: 'transit',
  title: 'Public transport',
  origins: ['https://marsruti.lv'],
  ttlMs: 12_000,
  staleMs: 90_000,
  waitMs: 1500,
  timeoutMs: 9000,
  attribution: [{ label: 'marsruti.lv', href: 'https://marsruti.lv' }],
  async load({ http }) {
    const results = await Promise.allSettled(
      NETWORKS.map(async (network) => normaliseGpsTxt(await http.text(network.url, { timeoutMs: 6000 }), network, Date.now())),
    )
    const entities: TransitVehicle[] = []
    let failures = 0
    for (const result of results) {
      if (result.status === 'fulfilled') entities.push(...result.value)
      else failures += 1
    }
    // One network being down should not blank the others; all of them down is a failed refresh.
    if (failures === NETWORKS.length) throw new UpstreamError('network', 'marsruti.lv could not be reached')
    return { shape: 'entities', entities }
  },
}
