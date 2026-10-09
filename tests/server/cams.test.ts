import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '../../server/app'
import { FeedCache } from '../../server/core/cache'
import type { FetchLike } from '../../server/core/upstream'
import { FIXED_CAMS, IPCAMLIVE_CAMS, JELGAVA_CAMS, KELTAS_CAMERAS } from '../../server/feeds/camList'
import { camStill, camsFeed } from '../../server/feeds/cams'
import {
  camEntities,
  eismoCams,
  eismoFeatures,
  ipcamStream,
  lvRoadCams,
  pictureOf,
  tallinnCams,
  youtubeIds,
} from '../../shared/adapters/cams'
import { normaliseCameras } from '../../shared/adapters/roads'
import { buildCsp } from '../../shared/csp'
import type { Cam } from '../../shared/feeds'

const T0 = Date.parse('2026-10-06T15:50:00Z')
const HOUR = 3600 * 1000
const DAY = 24 * HOUR

// Everything below is shaped as the publishers answered on 2026-10-06, cut down to what is read.
const JELGAVA_HTML = `
  <iframe src="https://www.youtube.com/embed/U9ayLU1DdsI?rel=0"></iframe>
  <iframe src="https://www.youtube-nocookie.com/embed/MrF0QhBluks"></iframe>
  <iframe src="https://www.youtube.com/embed/U9ayLU1DdsI"></iframe>
  <iframe src="https://www.youtube.com/embed/live_stream?channel=UCNZIjERh0ML_slke8mXYatw"></iframe>
  <iframe src="https://www.youtube.com/embed/videoseries?list=PL123"></iframe>`

const ipcam = (streamid: string | null, address = 'http://s75.ipcamlive.com/') => ({
  details: { alias: '1cesis', streamavailable: streamid ? '1' : '0', streamid, address, domainlockenabled: '0' },
})

const point = (lat: number, lon: number) => [{ min: 0, max: 99, point: [lat, lon] }]
const EISMO_LIST = [
  {
    layer: 'VKR',
    name: 'Vaizdo kameros',
    features: [
      { id: '5', name: 'Pabradė 102 41,46', details: true, icon: '15', points: point(54.956796286753764, 25.68200092454393) },
      { id: '6', name: 'Aukštadvaris A16 62,05', points: point(54.57614595373568, 24.43742200603573) },
      { id: '8', name: 'Didžiulio ež. A1 19,42', points: point(54.68456, 25.05498) },
      { id: '9', name: 'Kryžkalnis A1 204,47', points: point(55.46725, 22.67765) },
      { id: '../admin', name: 'Not a camera number', points: point(55, 24) },
    ],
  },
]
const photo = (id: number | string) => `https://eismoinfo.lt/eismoinfo-backend-v2/image-provider/camera/old?id=${id}`
/** The wall clock in Vilnius some minutes before `now`, as eismoinfo.lt writes it: "2026-10-06 18:40". Every test here runs in summer time. */
const vilnius = (now: number, minutesAgo: number) => new Date(now + 3 * HOUR - minutesAgo * 60_000).toISOString().slice(0, 16).replace('T', ' ')
const eismoDetails = (now: number) => [
  { name: 'Pabradė 102 41,46', info: [{ dateFrom: vilnius(now, 10), roadId: 1623, photos: [photo(85832403)] }] },
  // Stopped the day before.
  { name: 'Aukštadvaris A16 62,05', info: [{ dateFrom: vilnius(now, 30 * 60), photos: [photo(85000001)] }] },
  { name: 'Didžiulio ež. A1 19,42', info: [{ dateFrom: vilnius(now, 5), photos: [photo(85832620)] }] },
  { name: 'Kryžkalnis A1 204,47', info: [{ keyValue: [] }] },
]

const TALLINN_HTML = `var CamArray = [
        { 'cam':'cam103', 'name': 'Viru väljak (suund Mere pst ja Narva mnt)', 'is_on': 0 },
        { 'cam':'cam001', 'name': 'Estonia pst - Teatri väljak (suund Tammsaare park)*', 'is_on': 0 },
        { 'cam':'cam103', 'name': 'Viru väljak (suund Mere pst ja Narva mnt)', 'is_on': 0 },
        { 'cam':'cam101', 'name': 'Kalev P&R (sissepääs), Pärnu mnt 150', 'is_on': 0 },
];`

const json = (body: unknown) => () => new Response(JSON.stringify(body))
const text = (body: string) => () => new Response(body)
const status = (code: number) => () => new Response('', { status: code })

/** Each publisher as a stand-in: the first key found in the address answers. Anything else is a 404. */
const answers = (now: number): Record<string, () => Response> => ({
  'alias=1cesis': json(ipcam('4bbulpptwjgcvj6e8')),
  // Offline: no stream id.
  'alias=2cesis': json(ipcam(null)),
  'jelgava.lv': text(JELGAVA_HTML),
  'watch%3Fv%3DU9ayLU1DdsI': json({ title: 'Jelgava- Mītavas gājēju tilts', author_name: 'JelgavaLV' }),
  // Embedding switched off.
  'watch%3Fv%3DMrF0QhBluks': status(401),
  'layer-static-features/VKR': json(EISMO_LIST),
  'feature-info/list/VKR/5,6,8,9': json(eismoDetails(now)),
  'ristmikud.tallinn.ee/index.php/cams': text(TALLINN_HTML),
})

function publishers(now: number, overrides: Record<string, () => Response> = {}): FetchLike {
  const all = { ...overrides, ...answers(now), ...overrides }
  return async (url) => (Object.entries(all).find(([part]) => url.includes(part))?.[1] ?? status(404))()
}

/** One refresh of the feed at the given moment. What the feed remembers runs out between tests a day or more apart. */
async function load(now: number, fetch: FetchLike = publishers(now)): Promise<Cam[]> {
  const { snapshot } = await new FeedCache({ fetch, now: () => now, log: () => {} }).get(camsFeed)
  if (snapshot.payload.shape !== 'cams') throw new Error('wrong shape')
  return snapshot.payload.cams
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('camera lookups', () => {
  it('reads video ids off a page, once each, and nothing that only looks like one', () => {
    expect(youtubeIds(JELGAVA_HTML)).toEqual(['U9ayLU1DdsI', 'MrF0QhBluks'])
  })

  it('builds ipcamlive addresses only from an answer that is what it should be', () => {
    expect(ipcamStream(ipcam('4bbulpptwjgcvj6e8'))).toEqual({
      hls: 'https://s75.ipcamlive.com/streams/4bbulpptwjgcvj6e8/stream.m3u8',
      still: 'https://s75.ipcamlive.com/streams/4bbulpptwjgcvj6e8/snapshot.jpg',
    })
    expect(ipcamStream(ipcam(null))).toBeNull()
    expect(ipcamStream(ipcam('abc', 'http://evil.example/'))).toBeNull()
    expect(ipcamStream(ipcam('../../x'))).toBeNull()
    expect(ipcamStream('<html>')).toBeNull()
  })

  it("joins Lithuania's cameras to their photos by position in the list", () => {
    const features = eismoFeatures(EISMO_LIST)
    expect(features.map((feature) => feature.id)).toEqual(['5', '6', '8', '9'])
    expect(features[0]).toEqual({ id: '5', name: 'Pabradė 102 41,46', lon: 25.682, lat: 54.9568 })

    const cams = eismoCams(features, eismoDetails(T0), T0)
    // 6 stopped a day ago and 9 has no photo.
    expect(cams.map((cam) => cam.id)).toEqual(['lt-5', 'lt-8'])
    expect(cams[0]).toMatchObject({ country: 'LT', kind: 'still', src: photo(85832403), road: true, lon: 25.682, lat: 54.9568 })
  })

  it('drops every Lithuanian camera once the whole answer is old', () => {
    // All of them stopped together: the newest photo is no proof that anything is live.
    expect(eismoCams(eismoFeatures(EISMO_LIST), eismoDetails(T0), T0 + 3 * HOUR)).toEqual([])
  })

  it('drops a Lithuanian camera whose row is not its own, or whose photo is somewhere else', () => {
    const features = eismoFeatures(EISMO_LIST)
    const details = eismoDetails(T0)
    const shifted = [details[2], details[0], details[2], details[3]]
    expect(eismoCams(features, shifted, T0).map((cam) => cam.id)).toEqual(['lt-8'])
    const elsewhere = [{ name: 'Pabradė 102 41,46', info: [{ dateFrom: vilnius(T0, 10), photos: ['https://example.org/x.jpg'] }] }]
    expect(eismoCams(features, elsewhere, T0)).toEqual([])
    expect(eismoCams(features, { error: 'Invalid CORS request' }, T0)).toEqual([])
  })

  it("lists Tallinn's cameras once each, without positions", () => {
    const cams = tallinnCams(TALLINN_HTML)
    expect(cams.map((cam) => [cam.id, cam.name])).toEqual([
      ['tln-cam103', 'Viru väljak (suund Mere pst ja Narva mnt)'],
      ['tln-cam001', 'Estonia pst - Teatri väljak (suund Tammsaare park)'],
      ['tln-cam101', 'Kalev P&R (sissepääs), Pärnu mnt 150'],
    ])
    expect(cams[0]).toMatchObject({ src: 'https://ristmikud.tallinn.ee/last/cam103.jpg', country: 'EE', road: true })
    expect(cams[0].lon).toBeUndefined()
  })

  it("turns Latvia's road cameras into tiles and keeps their ids", () => {
    const [camera] = normaliseCameras([{ layer: 'x', properties: { id: 6, status: 'active', linear_reference: 'A5 (40km)' }, lon: 24, lat: 57 }], T0)
    expect(lvRoadCams([camera])).toMatchObject([{ id: 'camera:6', name: 'A5 (40km)', kind: 'still', src: '/api/camera/6', road: true, lon: 24, lat: 57 }])
  })
})

describe('camera pictures and dots', () => {
  const still = FIXED_CAMS.find((cam) => cam.id === 'madona-square')!
  const stream = FIXED_CAMS.find((cam) => cam.id === 'riga-port-1')!

  it('gives a still a new address once per refresh period', () => {
    const first = pictureOf(still, T0)
    expect(first).toMatch(/^https:\/\/www\.madona\.lv\/lat\/webcam\/gj\.php\?id=1&t=\d+$/)
    expect(pictureOf(still, T0 + 9_000)).toBe(first)
    expect(pictureOf(still, T0 + 30_000)).not.toBe(first)
    expect(pictureOf(FIXED_CAMS[0], T0)).toMatch(/skaties\.jpg\?t=\d+$/)
    expect(pictureOf(stream, T0)).toBeNull()
  })

  it('puts only cameras with a position on the map', () => {
    const entities = camEntities([still, ...tallinnCams(TALLINN_HTML)], T0)
    expect(entities).toMatchObject([{ id: 'webcam:madona-square', kind: 'webcam', lon: 26.2204, lat: 56.8542, label: 'Saieta laukums (town square)' }])
  })
})

describe('cams feed', () => {
  it('lists the fixed views and whatever could be looked up', async () => {
    const cams = await load(T0)
    const byId = new Map(cams.map((cam) => [cam.id, cam]))
    expect(byId.size).toBe(cams.length)
    for (const cam of FIXED_CAMS) expect(byId.get(cam.id), cam.id).toEqual(cam)

    expect(byId.get('cesis-rozu-laukums')).toMatchObject({
      kind: 'hls',
      src: 'https://s75.ipcamlive.com/streams/4bbulpptwjgcvj6e8/stream.m3u8',
      poster: 'https://s75.ipcamlive.com/streams/4bbulpptwjgcvj6e8/snapshot.jpg',
      place: 'Cēsis',
    })
    expect(byId.get('jelgava-bridge')).toMatchObject({
      kind: 'youtube',
      src: 'https://www.youtube-nocookie.com/embed/U9ayLU1DdsI?autoplay=1&mute=1',
      poster: 'https://i.ytimg.com/vi/U9ayLU1DdsI/hqdefault_live.jpg',
    })
    // Offline, unanswered, or not allowed to be embedded: each costs only itself.
    for (const gone of ['cesis-maija-parks', 'cesis-vienibas-laukums', 'saulkrasti-beach', 'jelgava-pasta-sala']) expect(byId.has(gone), gone).toBe(false)
    expect(cams.filter((cam) => cam.road).map((cam) => cam.id)).toEqual(['lt-5', 'lt-8', 'tln-cam103', 'tln-cam001', 'tln-cam101'])
  })

  it('leaves out only the cameras of a source that fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const cams = await load(T0 + 2 * DAY, publishers(T0 + 2 * DAY, { 'layer-static-features/VKR': status(500), 'jelgava.lv': text('<p>Back soon</p>') }))
    const ids = cams.map((cam) => cam.id)
    expect(ids.filter((id) => id.startsWith('lt-') || id.startsWith('jelgava-'))).toEqual([])
    expect(ids).toEqual(expect.arrayContaining(['riga-ratslaukums', 'cesis-rozu-laukums', 'tln-cam103']))
    expect(warn.mock.calls.map(([message]) => message).sort()).toEqual([
      '[feed:cams] eismoinfo left out: eismoinfo.lt answered HTTP 500',
      '[feed:cams] jelgava left out: jelgava.lv listed no cameras',
    ])
  })

  it('asks for the slow lists once and for the stream ids every time', async () => {
    const asked: string[] = []
    const fetch: FetchLike = (url, init) => {
      asked.push(new URL(url).host)
      return publishers(T0 + 4 * DAY)(url, init)
    }
    await load(T0 + 4 * DAY, fetch)
    await load(T0 + 4 * DAY + 61_000, fetch)
    const times = (host: string) => asked.filter((other) => other === host).length
    expect(times('ristmikud.tallinn.ee')).toBe(1)
    expect(times('www.jelgava.lv')).toBe(1)
    // The list once, the photos once: they are five minutes apart.
    expect(times('eismoinfo.lt')).toBe(2)
    expect(times('g2.ipcamlive.com')).toBe(2 * IPCAMLIVE_CAMS.length)
  })

  it('does not remember half of Jelgava for an hour when YouTube fails to answer', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const at = T0 + 5 * DAY
    const before = await load(at, publishers(at, { 'watch%3Fv%3DMrF0QhBluks': status(500) }))
    expect(before.filter((cam) => cam.id.startsWith('jelgava-'))).toEqual([])
    expect(warn).toHaveBeenCalledWith('[feed:cams] jelgava left out: www.youtube.com answered HTTP 500')
    // Asked again at the next refresh, a minute on, and both views are there.
    const after = await load(at + 61_000, publishers(at, { 'watch%3Fv%3DMrF0QhBluks': json({ title: 'Jelgava- skats no Pasta salas' }) }))
    expect(after.filter((cam) => cam.id.startsWith('jelgava-')).map((cam) => cam.id)).toEqual(['jelgava-bridge', 'jelgava-pasta-sala'])
  })

  it('names every view once, with a credit that links to its publisher', () => {
    const listed = [...FIXED_CAMS, ...IPCAMLIVE_CAMS, ...JELGAVA_CAMS]
    expect(new Set(listed.map((cam) => cam.id)).size).toBe(listed.length)
    for (const cam of listed) {
      expect(cam.page, cam.id).toMatch(/^https:\/\//)
      expect(cam.credit.length, cam.id).toBeGreaterThan(3)
    }
    // A still that goes through this server has a camera behind it.
    const proxied = FIXED_CAMS.filter((cam) => cam.src.startsWith('/')).map((cam) => cam.src)
    expect(proxied).toEqual([...KELTAS_CAMERAS.keys()].map((id) => `/api/cam/${id}`))
  })
})

describe('content security policy', () => {
  const policy = new Map(
    buildCsp()
      .split('; ')
      .map((directive) => directive.split(' '))
      .map(([name, ...sources]) => [name, sources]),
  )

  /** Whether the directive lets this address through: our own paths, a listed origin, or a listed "*." family of hosts. */
  function allows(directive: string, address: string): boolean {
    const sources = policy.get(directive)!
    if (address.startsWith('/')) return sources.includes("'self'")
    const { origin, protocol, hostname, port } = new URL(address)
    return sources.some(
      (source) => source === origin || (source.startsWith('https://*.') && protocol === 'https:' && port === '' && hostname.endsWith(source.slice('https://*'.length))),
    )
  }

  const NEEDS: Record<Cam['kind'], string[]> = {
    still: ['img-src'],
    // An HLS player fetches the playlist itself before the video element plays it.
    hls: ['connect-src', 'media-src'],
    video: ['media-src'],
    youtube: ['frame-src'],
    iframe: ['frame-src'],
  }

  it('lets the browser load every camera the feed can list', async () => {
    const [camera] = normaliseCameras([{ layer: 'x', properties: { id: 6, status: 'active', linear_reference: 'A5 (40km)' }, lon: 24, lat: 57 }], T0)
    const cams = [...(await load(T0 + 6 * DAY)), ...lvRoadCams([camera])]
    expect(cams.length).toBeGreaterThan(FIXED_CAMS.length + 5)
    for (const cam of cams) {
      for (const directive of NEEDS[cam.kind]) expect(allows(directive, cam.src), `${directive} ${cam.src}`).toBe(true)
      if (cam.poster) expect(allows('img-src', cam.poster), `img-src ${cam.poster}`).toBe(true)
    }
  })

  it('would notice a camera on a host that is not listed', () => {
    expect(allows('img-src', 'https://example.org/cam.jpg')).toBe(false)
    expect(allows('connect-src', 'https://ipcamlive.com.example.org/stream.m3u8')).toBe(false)
    expect(allows('connect-src', 'https://vstreams.ventspils.lv/x.m3u8')).toBe(false)
  })
})

describe('proxied stills', () => {
  const picture = (bytes: number[]) => `data:image/jpg;base64,${Buffer.from(bytes).toString('base64')}`
  const answering = (image: unknown) => vi.fn<FetchLike>(async () => new Response(JSON.stringify({ success: true, data: { image } })))

  it('serves a listed camera, and asks its publisher at most every half minute', async () => {
    const fetch = answering(picture([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]))
    const still = await camStill('klaipeda-new-ferry', fetch, T0)
    expect([...still!]).toEqual([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])
    await camStill('klaipeda-new-ferry', fetch, T0 + 29_000)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0][0]).toBe('https://keltas.eu/wp-json/api/cameras/26')
    await camStill('klaipeda-new-ferry', fetch, T0 + 31_000)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('never asks anyone about a camera that is not on the list', async () => {
    const fetch = answering(picture([0xff, 0xd8, 0xff]))
    for (const id of ['27', 'constructor', '../26', 'https://example.org/x.jpg']) expect(await camStill(id, fetch, T0)).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
    expect((await createApp({ clientDir: null }).request('/api/cam/tallinn-tv-tower')).status).toBe(404)
  })

  it('refuses what is not a picture, or is too large to be one', async () => {
    // Half a minute apart: a refusal answers for its camera for a quarter of one.
    await expect(camStill('klaipeda-old-ferry', answering(picture([0x3c, 0x68, 0x74, 0x6d, 0x6c])), T0)).rejects.toThrow('did not send a picture')
    await expect(camStill('klaipeda-old-ferry', answering({ nope: true }), T0 + 30_000)).rejects.toThrow('did not send a picture')
    await expect(camStill('klaipeda-old-ferry', answering(`data:image/jpg;base64,${'A'.repeat(1_100_000)}`), T0 + 60_000)).rejects.toThrow('more than this feed accepts')
  })

  it('asks a publisher in trouble again only after a quarter of a minute', async () => {
    const fetch = vi.fn<FetchLike>(async () => new Response('', { status: 500 }))
    for (const later of [0, 5_000, 14_000]) await expect(camStill('smiltyne-old-ferry', fetch, T0 + later)).rejects.toThrow('HTTP 500')
    expect(fetch).toHaveBeenCalledTimes(1)
    await expect(camStill('smiltyne-old-ferry', fetch, T0 + 16_000)).rejects.toThrow('HTTP 500')
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('stops reading a body that never ends once it is past the limit', async () => {
    let sent = 0
    let cancelled = false
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent += 1
        controller.enqueue(new Uint8Array(256 * 1024))
      },
      cancel() {
        cancelled = true
      },
    })
    await expect(camStill('smiltyne-old-ferry', async () => new Response(endless), T0 + 60_000)).rejects.toThrow('more than this feed accepts')
    expect(cancelled).toBe(true)
    // The limit is 1 MB: four chunks fit, the fifth is one too many.
    expect(sent).toBeLessThan(10)
  })
})
