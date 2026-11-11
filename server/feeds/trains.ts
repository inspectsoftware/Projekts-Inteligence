import { type RawTrain, type TrainFixes, normaliseElronTrains, normaliseTrains } from '../../shared/adapters/trains'
import { LazyStream } from '../core/stream'
import { UpstreamError } from '../core/upstream'
import { snapToRoute } from '../transit/match'
import { tripService } from '../transit/service'
import { aggregatedText } from './transit'
import type { FeedDef } from './types'
import { ParkedVehicles } from '../transit/parked'

const parkedTrains = new ParkedVehicles()

// The data behind Vivi's own public live map: one frame a second with every running train.
// Undocumented and without published terms, so it is used gently (one shared connection,
// closed when nobody is watching) and may change without notice.
const STREAM_URL = 'wss://trainmap.pv.lv/ws'

/** Frames are about 100 kB each; one in three is plenty for a map that polls every few seconds. */
const MIN_PARSE_INTERVAL_MS = 2500

let latest: { trains: RawTrain[]; receivedAt: number } | null = null
const fixes: TrainFixes = new Map()
const elronFixes: TrainFixes = new Map()

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
  origins: ['wss://trainmap.pv.lv', 'https://rt.pieturas.lv'],
  ttlMs: 4000,
  staleMs: 60_000,
  waitMs: 1000,
  timeoutMs: 8000,
  attribution: [
    { label: 'Vivi live train map', href: 'https://trainmap.vivi.lv' },
    // Elron's own live map, relayed by pieturas.lv: free to use with a reference to it.
    { label: 'Elron via pieturas.lv (gsvalbe.id.lv)', href: 'https://gsvalbe.id.lv/pieturas/avoti.html' },
  ],
  async load({ http }) {
    // Estonia's from the list the buses come in, Latvia's from Vivi's stream: either alone is still trains.
    const elron = aggregatedText(http)
      .then(({ text, at }) => (text ? normaliseElronTrains(text, at, elronFixes) : []))
      .catch(() => [])
    await stream.ready(6000).catch(() => undefined)
    const estonian = await elron
    if (!latest && !estonian.length) throw new UpstreamError('bad-body', 'The train feed sent no train list')
    const trains = [...(latest ? normaliseTrains(latest.trains, latest.receivedAt, fixes) : []), ...estonian]
    // Seen only once, or standing since it was first seen, a train has no heading of its own: drawn
    // pointing north, it stood across its track. It takes the way its line runs where it is instead.
    const timetables = { vivi: tripService.loadedFor('trains'), elron: tripService.loadedFor('elron') }
    for (const train of trains) {
      if (train.trk !== undefined) continue
      const elronTrain = train.props.operator === 'elron'
      const timetable = elronTrain ? timetables.elron : timetables.vivi
      if (!timetable) continue
      const fix = { lon: train.lon, lat: train.lat, route: elronTrain ? train.props.number : null, mode: 'rail', trip: train.props.trip ?? train.props.number }
      const snapped = snapToRoute(timetable, fix, Date.now())
      if (snapped) train.trk = snapped.trk
    }
    // A train standing over five minutes (a terminus, a siding, overnight) is off the map until it leaves.
    return { shape: 'entities', entities: parkedTrains.shown(trains, Date.now()) }
  },
}
