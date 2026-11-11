import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { TripAnswer } from '../../shared/adapters/transit'
import { CACHE_DIR } from '../core/disk'
import { type FetchLike, createUpstream } from '../core/upstream'
import { type GtfsIndex, indexGtfs, unzip } from './gtfs'
import { type VehicleFix, answerFor } from './match'
import { SCHEDULED_NETWORKS } from './scheduled'
import { putOnStreets } from './streets'

/**
 * The timetable (GTFS) of each network the map shows live vehicles for, by the network id the
 * transit feed gives its vehicles, and "trains" for Latvian trains. Checked on 2026-11-09.
 * Not here yet: the regional buses round Druskininkai (the town's own timetable does not hold them),
 * Latvia's regional buses (ATD's file is 29 MB zipped, too much to hold for 17 vehicles).
 */
export const TIMETABLES: Readonly<Record<string, string>> = {
  vilnius: 'https://www.stops.lt/vilnius/vilnius/gtfs.zip',
  kaunas: 'https://www.stops.lt/kaunas/kaunas/gtfs.zip',
  klaipeda: 'https://www.stops.lt/klaipeda/klaipeda/gtfs.zip',
  panevezys: 'https://www.stops.lt/panevezys/panevezys/gtfs.zip',
  alytus: 'https://www.stops.lt/alytus/alytus/gtfs.zip',
  druskininkai: 'https://www.stops.lt/druskininkai/druskininkai/gtfs.zip',
  taurage: 'https://www.stops.lt/taurage/taurage/gtfs.zip',
  liepaja: 'https://marsruti.lv/liepaja/liepaja/gtfs.zip',
  rezekne: 'https://marsruti.lv/rezekne/rezekne/gtfs.zip',
  trains: 'https://vivi.lv/uploads/GTFS.zip',
  // Estonia's trains, by Elron (Mobility Database).
  elron: 'https://eu-gtfs.remix.com/elron.zip',
  // Found through the Mobility Database (mobilitydatabase.org), which lists Estonia's feeds where peatus.ee no longer does.
  tallinn: 'https://eu-gtfs.remix.com/tallinn.zip',
  // A data.gov.lv dataset rather than a file: Rīgas satiksme adds a new zip to it every month.
  riga: 'https://data.gov.lv/dati/api/3/action/package_show?id=marsrutu-saraksti-rigas-satiksme-sabiedriskajam-transportam',
  // Towns whose live vehicles come through pieturas.lv (feeds/transit.ts), for their cards and lines.
  tartu: 'https://eu-gtfs.remix.com/tartu.zip',
  harjumaa: 'https://eu-gtfs.remix.com/harjumaa.zip',
  siauliai: 'https://www.stops.lt/siauliai/siauliai/gtfs.zip',
  jurmala: 'https://gsvalbe.id.lv/pieturas/dati/gtfs/jurmala.zip',
  marijampole: 'https://visimarsrutai.lt/gtfs/Marijampoles.zip',
  kedainiai: 'https://visimarsrutai.lt/gtfs/KedainiuR.zip',
  jonava: 'https://visimarsrutai.lt/gtfs/JonavosR.zip',
  plunge: 'https://visimarsrutai.lt/gtfs/PlungesR.zip',
  telsiai: 'https://visimarsrutai.lt/gtfs/TelsiuR.zip',
  // The towns shown by their timetable alone (scheduled.ts).
  ...Object.fromEntries(SCHEDULED_NETWORKS.map((network) => [network.id, network.url])),
}

/** The newest zip a data.gov.lv (CKAN) dataset lists. */
async function newestZip(http: ReturnType<typeof createUpstream>, dataset: string): Promise<string> {
  const { result } = await http.json<{ result: { resources: { url: string; created: string }[] } }>(dataset, { timeoutMs: 30_000 })
  const newest = result.resources.filter((resource) => /\.zip$/i.test(resource.url)).sort((a, b) => a.created.localeCompare(b.created)).at(-1)
  if (!newest) throw new Error('the dataset lists no zip file')
  return newest.url
}

export const TIMETABLE_ORIGINS = [...new Set(Object.values(TIMETABLES).map((url) => new URL(url).origin))]

/**
 * Runs reading timetables one at a time, letting everything waiting go first before each: each takes
 * the whole process for up to a few seconds, and a couple of dozen read back to back at start-up
 * left the live feeds' own requests to time out meanwhile.
 */
let turn: Promise<unknown> = Promise.resolve()
function inTurn<T>(work: () => T): Promise<T> {
  const next = turn.then(() => new Promise<void>((resolve) => setImmediate(resolve))).then(work)
  turn = next.catch(() => undefined)
  return next
}

/** Operators publish a new timetable every few weeks; a day old is fresh enough. */
const FRESH_MS = 24 * 3600_000
const MAX_BYTES = 12 * 1024 * 1024

/**
 * Loads each timetable the first time a vehicle of its network is asked about, keeps it in memory
 * and on disk, and fetches it again once a day. Two networks may share one file, which is then
 * read once.
 */
export function createTripService(fetchImpl?: FetchLike, now: () => number = Date.now, dir = join(CACHE_DIR, 'gtfs'), options: { streets?: boolean } = {}) {
  const loaded = new Map<string, { at: number; index: Promise<GtfsIndex> }>()
  /** The last timetable read for each file, kept while the next day's is loading. */
  const ready = new Map<string, GtfsIndex>()

  async function download(url: string, file: string): Promise<Buffer> {
    const fresh = await stat(file).then((s) => now() - s.mtimeMs < FRESH_MS).catch(() => false)
    if (fresh) return readFile(file)
    try {
      const http = createUpstream(TIMETABLE_ORIGINS, AbortSignal.timeout(90_000), fetchImpl)
      const zipUrl = url.includes('/api/3/action/package_show') ? await newestZip(http, url) : url
      const zip = Buffer.from(await http.bytes(zipUrl, { timeoutMs: 60_000, maxBytes: MAX_BYTES }))
      await mkdir(dir, { recursive: true })
      await writeFile(file, zip).catch(() => undefined)
      return zip
    } catch (err) {
      // An old copy beats none while the operator's site is down.
      const old = await readFile(file).catch(() => null)
      if (old) return old
      throw err
    }
  }

  function timetable(url: string, network: string): Promise<GtfsIndex> {
    const held = loaded.get(url)
    if (held && now() - held.at < FRESH_MS) return held.index
    const file = join(dir, `${new URL(url).host}${new URL(url).pathname}${new URL(url).search}`.replace(/[^\w.-]+/g, '_'))
    const index = download(url, file).then((zip) => inTurn(() => indexGtfs(unzip(zip))))
    // A failed load is forgotten, so the next question tries again.
    index
      .then((read) => {
        ready.set(url, read)
        // Then its lines go onto the real streets, in the background (streets.ts).
        // streets.ts keeps its own turns: one Overpass request and one town's matching at a time.
        if (options.streets) {
          putOnStreets(network, read, join(dir, '..', 'streets')).catch((err) =>
            console.warn(`[pwh] streets: ${network} left on the operator's lines:`, err instanceof Error ? err.message : err),
          )
        }
      })
      .catch(() => loaded.delete(url))
    loaded.set(url, { at: now(), index })
    return index
  }

  return {
    /**
     * This network's timetable if it is already in memory, else null, having started loading it:
     * for work that cannot wait for a download, such as each refresh of the live feed.
     */
    loadedFor(network: string): GtfsIndex | null {
      const url = TIMETABLES[network]
      if (!url) return null
      void timetable(url, network).catch(() => undefined)
      return ready.get(url) ?? null
    },
    /** The trip a vehicle of this network is on, or null when its timetable has no trip that fits. */
    async answer(network: string, fix: VehicleFix): Promise<TripAnswer | null> {
      const url = TIMETABLES[network]
      if (!url) return null
      return answerFor(await timetable(url, network), fix, now())
    },
  }
}

/** The one the app uses, shared by the live feed (to put vehicles on their routes) and /api/trip. */
export const tripService = createTripService(undefined, Date.now, join(CACHE_DIR, 'gtfs'), { streets: true })
