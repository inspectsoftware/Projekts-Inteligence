import { type RawTrain, type TrainFixes, normaliseTrains } from '../../shared/adapters/trains'
import { LazyStream } from '../core/stream'
import { UpstreamError } from '../core/upstream'
import type { FeedDef } from './types'

// The data behind Vivi's own public live map: one frame a second with every running train.
// Undocumented and without published terms, so it is used gently (one shared connection,
// closed when nobody is watching) and may change without notice.
const STREAM_URL = 'wss://trainmap.pv.lv/ws'

/** Frames are about 100 kB each; one in three is plenty for a map that polls every few seconds. */
const MIN_PARSE_INTERVAL_MS = 2500

let latest: { trains: RawTrain[]; receivedAt: number } | null = null
const fixes: TrainFixes = new Map()

const stream = new LazyStream({
  name: 'The train feed',
  url: STREAM_URL,
  idleCloseMs: 120_000,
  onMessage(raw, receivedAt) {
    if (latest && receivedAt - latest.receivedAt < MIN_PARSE_INTERVAL_MS) return true
    // The type is the first key of every frame; skip station lists and pings unparsed.
    if (!raw.slice(0, 40).includes('back-end')) return latest !== null
    try {
      const frame = JSON.parse(raw) as { data?: RawTrain[] }
      if (Array.isArray(frame.data)) latest = { trains: frame.data, receivedAt }
    } catch {
      // A malformed frame is skipped; the next one arrives within a second.
    }
    return latest !== null
  },
  onClose() {
    latest = null
  },
})

export const trainsFeed: FeedDef = {
  id: 'trains',
  title: 'Trains',
  origins: ['wss://trainmap.pv.lv'],
  ttlMs: 4000,
  staleMs: 60_000,
  waitMs: 1000,
  timeoutMs: 8000,
  attribution: [{ label: 'Vivi live train map', href: 'https://trainmap.vivi.lv' }],
  async load() {
    await stream.ready(6000)
    if (!latest) throw new UpstreamError('bad-body', 'The train feed sent no train list')
    return { shape: 'entities', entities: normaliseTrains(latest.trains, latest.receivedAt, fixes) }
  },
}
