import { type EismoFeature, eismoCams, eismoFeatures, ipcamStream, tallinnCams, youtubeEmbed, youtubeIds } from '../../shared/adapters/cams'
import type { Cam } from '../../shared/feeds'
import { type FetchLike, type Upstream, UpstreamError, createUpstream } from '../core/upstream'
import { FIXED_CAMS, IPCAMLIVE_CAMS, JELGAVA_CAMS, JELGAVA_PAGE, KELTAS_CAMERAS } from './camList'
import type { FeedDef } from './types'

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

const IPCAMLIVE = 'https://g2.ipcamlive.com'
const YOUTUBE = 'https://www.youtube.com'
const EISMO = 'https://eismoinfo.lt/eismoinfo-backend-v2'
const TALLINN = 'https://ristmikud.tallinn.ee'
const KELTAS = 'https://keltas.eu'

/** No bulk source may grow the feed without limit, whatever its publisher starts to list. */
const MAX_BULK = 500

/** How long a failure answers for its source: a publisher in trouble is not asked again by every visitor. */
const FAILED_FOR = 15_000

/**
 * Keeps what `load` gave for `ttlMs`, shared by everyone who asks meanwhile: the feed is rebuilt
 * every minute, and a list that changes once a day must not be fetched that often. A failure is
 * kept too, but only for a quarter of a minute. In memory only, so a restarted process simply asks again.
 * ponytail: a source that keeps failing is retried on every rebuild, once a minute while somebody
 * watches; give it a back-off of its own if a publisher ever minds.
 */
function memo<T>(ttlMs: number): (now: number, load: () => Promise<T>) => Promise<T> {
  let held: { until: number; value: Promise<T> } | null = null
  return (now, load) => {
    if (held && now < held.until) return held.value
    const mine = { until: now + ttlMs, value: load() }
    held = mine
    mine.value.catch(() => {
      mine.until = Math.min(mine.until, now + FAILED_FOR)
    })
    return mine.value
  }
}

const nothing = (what: string) => new UpstreamError('bad-body', `${what} listed no cameras`)

/** Cēsis and Saulkrasti: one question per camera, and a camera that is offline costs only itself. */
async function ipcamCams(http: Upstream): Promise<Cam[]> {
  const found = await Promise.all(
    IPCAMLIVE_CAMS.map(async ({ alias, ...cam }): Promise<Cam[]> => {
      const stream = await http
        .json(`${IPCAMLIVE}/player/getcamerastreamstate.php?alias=${alias}`, { timeoutMs: 8000, maxBytes: 64 * 1024 })
        .then(ipcamStream, () => null)
      // The snapshots are large (up to 0.8 MB), so a tile fetches a new one every other minute only.
      return stream ? [{ ...cam, kind: 'hls', src: stream.hls, poster: stream.still, refreshS: 120 }] : []
    }),
  )
  return found.flat()
}

const jelgava = memo<Cam[]>(HOUR)

async function jelgavaCams(http: Upstream): Promise<Cam[]> {
  const ids = youtubeIds(await http.text(JELGAVA_PAGE, { timeoutMs: 10_000, maxBytes: 2 * 1024 * 1024 }))
  // YouTube's own answer about each video: its title, or an error if it is gone or may not be embedded.
  const videos = await Promise.all(
    ids.slice(0, 6).map(async (id) => {
      const watch = encodeURIComponent(`${YOUTUBE}/watch?v=${id}`)
      const title = await http
        .json<{ title?: unknown }>(`${YOUTUBE}/oembed?url=${watch}&format=json`, { timeoutMs: 8000, maxBytes: 64 * 1024 })
        .then(
          (answer) => String(answer?.title ?? ''),
          (err: unknown) => {
            // Any other failure is YouTube not answering: the lookup fails and is made again soon,
            // rather than half a list being remembered for an hour.
            if (err instanceof UpstreamError && [401, 403, 404].includes(err.status ?? 0)) return ''
            throw err
          },
        )
      return { id, title }
    }),
  )
  const cams = JELGAVA_CAMS.flatMap(({ title, ...cam }): Cam[] => {
    const video = videos.find((candidate) => title.test(candidate.title))
    if (!video) return []
    // YouTube renews this thumbnail by itself while the stream is live.
    return [{ ...cam, kind: 'youtube', src: youtubeEmbed(video.id), poster: `https://i.ytimg.com/vi/${video.id}/hqdefault_live.jpg`, refreshS: 300 }]
  })
  if (cams.length === 0) throw nothing('jelgava.lv')
  return cams
}

const eismoList = memo<EismoFeature[]>(DAY)
const eismoPhotos = memo<Cam[]>(5 * MINUTE)

/** The list of cameras hardly ever changes; the photo behind each one is replaced every five minutes. */
async function eismo(http: Upstream, now: number): Promise<Cam[]> {
  const features = await eismoList(now, async () => {
    const listed = eismoFeatures(await http.json(`${EISMO}/layer-static-features/VKR`, { timeoutMs: 10_000 })).slice(0, MAX_BULK)
    if (listed.length === 0) throw nothing('eismoinfo.lt')
    return listed
  })
  // One request answers for every camera at once.
  const ids = features.map((feature) => feature.id).join(',')
  return eismoCams(features, await http.json(`${EISMO}/feature-info/list/VKR/${ids}`, { timeoutMs: 10_000 }), now)
}

const tallinn = memo<Cam[]>(DAY)

async function tallinnList(http: Upstream): Promise<Cam[]> {
  const cams = tallinnCams(await http.text(`${TALLINN}/index.php/cams`, { timeoutMs: 10_000, maxBytes: 2 * 1024 * 1024 })).slice(0, MAX_BULK)
  if (cams.length === 0) throw nothing('ristmikud.tallinn.ee')
  return cams
}

/**
 * Every live view the browser can show right now: the hand-picked list, plus whatever has to be
 * looked up first because it changes (stream ids, video ids, the big road-camera lists). A lookup
 * that fails leaves out its own cameras and nothing else, so this feed itself never fails.
 */
export const camsFeed: FeedDef = {
  id: 'cams',
  title: 'Live cameras',
  origins: [IPCAMLIVE, 'https://www.jelgava.lv', YOUTUBE, 'https://eismoinfo.lt', TALLINN],
  // ipcamlive stream ids are the fastest thing to change; everything slower is remembered above.
  ttlMs: MINUTE,
  staleMs: 30 * MINUTE,
  timeoutMs: 25_000,
  // Lithuania's terms ask for the source to be named wherever its data appears. Every view carries its own credit.
  attribution: [{ label: 'Via Lietuva / eismoinfo.lt', href: 'https://eismoinfo.lt/' }],
  async load({ http, now }) {
    const sources: Record<string, Promise<Cam[]>> = {
      ipcamlive: ipcamCams(http),
      jelgava: jelgava(now, () => jelgavaCams(http)),
      eismoinfo: eismoPhotos(now, () => eismo(http, now)),
      tallinn: tallinn(now, () => tallinnList(http)),
    }
    const found = await Promise.all(
      Object.entries(sources).map(([name, cams]) =>
        cams.catch((err: unknown) => {
          // Only our own messages are logged: anything else could carry an address.
          console.warn(`[feed:cams] ${name} left out: ${err instanceof UpstreamError ? err.message : 'could not be read'}`)
          return [] as Cam[]
        }),
      ),
    )
    return { shape: 'cams', cams: [...FIXED_CAMS, ...found.flat()] }
  },
}

/** Larger than any still the ferry cameras have sent (0.2 MB as base64). */
const MAX_STILL_BYTES = 1024 * 1024

const stills = new Map<string, ReturnType<typeof memo<Uint8Array>>>()

/**
 * The latest still of a camera whose publisher will not let another site's page load it: fetched
 * here, at most every 30 seconds per camera, or every 15 while it fails. Only cameras on our own
 * list, looked up by our own id, so no address ever comes from the request. Null for an id that
 * is not on the list.
 */
export async function camStill(id: string, fetchImpl?: FetchLike, now = Date.now()): Promise<Uint8Array | null> {
  const camera = KELTAS_CAMERAS.get(id)
  if (camera === undefined) return null
  if (!stills.has(id)) stills.set(id, memo<Uint8Array>(30_000))
  return stills.get(id)!(now, async () => {
    const http = createUpstream([KELTAS], AbortSignal.timeout(12_000), fetchImpl)
    const answer = await http.json<{ data?: { image?: unknown } }>(`${KELTAS}/wp-json/api/cameras/${camera}`, { maxBytes: MAX_STILL_BYTES })
    // The picture arrives as a data: address inside JSON. Only what really is a JPEG is passed on.
    const [, base64] = /^data:image\/jpe?g;base64,(.+)$/.exec(String(answer?.data?.image)) ?? []
    const jpeg = Buffer.from(base64 ?? '', 'base64')
    if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8 || jpeg[2] !== 0xff) throw new UpstreamError('bad-body', 'keltas.eu did not send a picture')
    return jpeg
  })
}
