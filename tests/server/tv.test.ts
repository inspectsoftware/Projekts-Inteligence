import { afterEach, describe, expect, it, vi } from 'vitest'
import { FeedCache, FeedUnavailable } from '../../server/core/cache'
import type { FetchLike } from '../../server/core/upstream'
import { tvFeed } from '../../server/feeds/tv'
import { airOf, broadcastOf, channelVideos, linkOf, playersOf, titleDate } from '../../shared/adapters/tv'
import { buildCsp } from '../../shared/csp'
import type { TvNow } from '../../shared/feeds'
import { TV_CHANNELS, type TvChannel } from '../../shared/media/tv'

const channel = (id: string) => TV_CHANNELS.find((candidate) => candidate.id === id)!
const scheduled = (id: string) => channel(id) as Extract<TvChannel, { kind: 'yt-feed' }>
/** Riga keeps UTC+3 in October. */
const riga = (time: string, day = '2026-10-06') => Date.parse(`${day}T${time}:00+03:00`)

/** A channel feed as YouTube sends it, cut down to what is read. Titles are as the channels wrote them on 2026-10-06. */
const feed = (...videos: [id: string, title: string][]) => `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom">
 <title>Channel</title>
${videos
  .map(
    ([id, title]) => ` <entry>
  <id>yt:video:${id}</id>
  <yt:videoId>${id}</yt:videoId>
  <title>${title}</title>
  <published>2026-10-06T08:15:04+00:00</published>
  <media:group>
   <media:title>${title}</media:title>
  </media:group>
 </entry>`,
  )
  .join('\n')}
</feed>`

const LTV = feed(
  ['kGqgT0M1lcA', 'Liepājnieki no nākamās valdības sagaida solījumu izpildi'],
  ['v7xLY7ms_EU', '6. oktobra &quot;Panorāma&quot; un &quot;Šodienas jautājums&quot;'],
  ['MV3JB55XnqY', '6. oktobra &quot;Dienas ziņas&quot;'],
  ['pYgVg22hiGM', '5. oktobra &quot;Panorāma&quot; un &quot;Šodienas jautājums&quot;'],
)
const SEIMAS = feed(
  ['2NdJDxeasWQ', '2026-10-22 Seimo narės spaudos konferencija'],
  ['DtX0dB0rurY', '2026-10-20 Seimo vakarinis posėdis Nr. 195'],
  ['3zJ9m5mL_OI', '2026-10-15 Seimo vakarinis posėdis Nr. 193'],
  ['ZkCAxPARKEU', '2026-10-06 Seimo vakarinis posėdis Nr. 187'],
  ['QBgv0_4eD-8', '2026-10-06 Seimo rytinis posėdis Nr. 186'],
  ['3UHZ6GPo-EU', '2026-10-06 Seniūnų sueigos posėdis'],
  ['IAtAwnpl82s', '2026-10-01 Seimo vakarinis posėdis Nr. 185'],
)
const SAEIMA = feed(
  ['IKiQ8amdOyo', 'Frakciju viedokļi'],
  ['ij05ZR4Q4mc', 'Saeimas sēde 2026. gada 1. oktobrī (ar darba kārtību)'],
  ['WhK_pGPWyjE', 'Saeimas sēde 2026. gada 24. septembrī'],
)
const CLIPS = feed(['SC8mOkmDXzU', 'Valsts sekretāru sanāksme 01.10.2026.'], ['vN-TDc0y6DQ', 'NVO un MK sadarbības memoranda īstenošanas padomes sēde 30.09.2026.'])

describe('channel feed', () => {
  it('reads ids and titles in the feed’s own order', () => {
    expect(channelVideos(LTV).slice(0, 2)).toEqual([
      { videoId: 'kGqgT0M1lcA', title: 'Liepājnieki no nākamās valdības sagaida solījumu izpildi' },
      { videoId: 'v7xLY7ms_EU', title: '6. oktobra "Panorāma" un "Šodienas jautājums"' },
    ])
    // An id becomes part of a player address: anything that is not one is left out.
    expect(channelVideos(feed(['../../x?y=1', 'Not a video']))).toEqual([])
    expect(channelVideos('<html>Before you continue</html>')).toEqual([])
  })

  it('reads the day out of a title, however the channel spells it', () => {
    const today = '2026-10-06'
    expect(titleDate('2026-10-06 Seimo vakarinis posėdis Nr. 187', today)).toBe('2026-10-06')
    expect(titleDate('Ministru kabineta sēde 6.10.2026.', today)).toBe('2026-10-06')
    expect(titleDate('06.10.2026. Valsts prezidenta E. Rinkēviča preses konference', today)).toBe('2026-10-06')
    expect(titleDate('6. oktobra "Dienas ziņas"', today)).toBe('2026-10-06')
    expect(titleDate('Saeimas sēde 2026. gada 1. oktobrī (ar darba kārtību)', today)).toBe('2026-10-01')
    expect(titleDate('Valitsuse pressikonverents, 24. september 2026', today)).toBe('2026-09-24')
    // No year in the title: the new year has not had a 31 December yet.
    expect(titleDate('31. decembra "Panorāma"', '2027-01-01')).toBe('2026-12-31')
    expect(titleDate('Frakciju viedokļi', today)).toBeNull()
    expect(titleDate('Valsts prezidenta paziņojums pēc tikšanās ar 15. Saeimā ievēlēto partiju pārstāvjiem', today)).toBeNull()
  })
})

describe('what a scheduled channel shows', () => {
  const ltv = scheduled('ltv-news')
  const at = (time: string, day?: string) => broadcastOf(ltv, channelVideos(LTV), riga(time, day))

  it('is the bulletin on air, with its slot', () => {
    const now = at('18:10')!
    expect(now).toEqual({ id: 'ltv-news', videoId: 'MV3JB55XnqY', title: '6. oktobra "Dienas ziņas"', today: true, from: riga('18:00'), to: riga('18:35') })
    expect(airOf(ltv, now, riga('18:10'))).toBe('live')
  })

  it('is the next bulletin of the day until it starts, whichever the feed lists first', () => {
    const afternoon = at('15:00')!
    expect(afternoon).toMatchObject({ videoId: 'MV3JB55XnqY', from: riga('18:00') })
    expect(airOf(ltv, afternoon, riga('15:00'))).toBe('next')
    // Polled every quarter of an hour, so the window turns it to "on air" by its own clock.
    expect(airOf(ltv, afternoon, riga('18:01'))).toBe('live')

    const evening = at('19:00')!
    expect(evening).toMatchObject({ videoId: 'v7xLY7ms_EU', from: riga('20:30'), to: riga('21:25') })
    expect(airOf(ltv, evening, riga('19:00'))).toBe('next')
  })

  it('is the last bulletin once the day is over, and no longer on air', () => {
    const late = at('22:00')!
    expect(late).toMatchObject({ videoId: 'v7xLY7ms_EU', today: true })
    expect(airOf(ltv, late, riga('22:00'))).toBe('off')
    // Next morning, before the day's broadcasts are listed: yesterday's, as a recording.
    const morning = at('09:00', '2026-10-07')!
    expect(morning).toEqual({ id: 'ltv-news', videoId: 'v7xLY7ms_EU', title: '6. oktobra "Panorāma" un "Šodienas jautājums"', today: false })
    expect(airOf(ltv, morning, riga('09:00', '2026-10-07'))).toBe('off')
  })

  it('keeps the slot of a bulletin the feed has stopped listing, and leaves the video to the channel’s own player', () => {
    // By the evening the day's clips have pushed the upcoming Panorāma out of the feed's fifteen entries.
    const videos = channelVideos(LTV).filter((video) => video.videoId !== 'v7xLY7ms_EU')
    const evening = broadcastOf(ltv, videos, riga('20:10'))!
    expect(evening).toEqual({ id: 'ltv-news', today: true, from: riga('20:30'), to: riga('21:25') })
    expect(airOf(ltv, evening, riga('20:10'))).toBe('next')
    expect(airOf(ltv, evening, riga('20:35'))).toBe('live')
    // Not the 18:00 recording, which would play without complaint all through the live bulletin.
    expect(playersOf(ltv, evening)).toMatchObject([{ src: expect.stringContaining('/live_stream?channel=UCOSAAyJoybqsY5sZ76BaqFA') }])
    expect(broadcastOf(ltv, videos, riga('20:44'))).toEqual(evening)
    // Its slot over as well: the last bulletin the feed does list, as a recording.
    const late = broadcastOf(ltv, videos, riga('22:00'))!
    expect(late).toMatchObject({ videoId: 'MV3JB55XnqY', to: riga('18:35') })
    expect(airOf(ltv, late, riga('22:00'))).toBe('off')

    // A first bulletin that is missing is not assumed: it may not be made that day.
    const withoutFirst = channelVideos(LTV).filter((video) => video.videoId !== 'MV3JB55XnqY')
    expect(broadcastOf(ltv, withoutFirst, riga('15:00'))).toMatchObject({ videoId: 'v7xLY7ms_EU', from: riga('20:30') })
  })

  it('keeps Riga time in winter too', () => {
    const videos = channelVideos(feed(['MV3JB55XnqY', '1. decembra &quot;Dienas ziņas&quot;']))
    expect(broadcastOf(ltv, videos, Date.parse('2026-12-01T12:00:00Z'))).toMatchObject({ from: Date.parse('2026-12-01T16:00:00Z') })
  })

  it('never picks a sitting that is only announced for a later day', () => {
    const seimas = scheduled('seimas')
    const videos = channelVideos(SEIMAS)
    // Two sittings today: the one the feed lists first is the one on air.
    const sitting = broadcastOf(seimas, videos, riga('16:00'))!
    expect(sitting).toEqual({ id: 'seimas', videoId: 'ZkCAxPARKEU', title: '2026-10-06 Seimo vakarinis posėdis Nr. 187', today: true })
    expect(airOf(seimas, sitting, riga('16:00'))).toBe('today')

    const quiet = broadcastOf(seimas, videos, riga('16:00', '2026-10-08'))!
    expect(quiet).toMatchObject({ videoId: 'ZkCAxPARKEU', today: false })
    expect(airOf(seimas, quiet, riga('16:00', '2026-10-08'))).toBe('off')

    expect(broadcastOf(seimas, videos, riga('09:00', '2026-10-15'))).toMatchObject({ videoId: '3zJ9m5mL_OI', today: true })
  })

  it('offers the latest sitting as a recording, and nothing where the feed holds no broadcast', () => {
    const saeima = scheduled('saeima')
    expect(broadcastOf(saeima, channelVideos(SAEIMA), riga('12:00'))).toEqual({
      id: 'saeima',
      videoId: 'ij05ZR4Q4mc',
      title: 'Saeimas sēde 2026. gada 1. oktobrī (ar darba kārtību)',
      today: false,
    })
    expect(broadcastOf(scheduled('lv-cabinet'), channelVideos(CLIPS), riga('12:00'))).toBeNull()
    // The sign-language upload of a press conference is a day late: never the live one.
    const tallinn = channelVideos(feed(['dmgS4JNinZw', 'Valitsuse pressikonverents (viipekeelse tõlkega), 1. oktoober 2026'], ['D5m8NUrW_fY', 'Valitsuse pressikonverents, 1. oktoober 2026']))
    expect(broadcastOf(scheduled('ee-government'), tallinn, riga('12:00', '2026-10-01'))).toMatchObject({ videoId: 'D5m8NUrW_fY', today: true })
  })
})

describe('players and the way out', () => {
  const video = (id: string) => ({ kind: 'youtube', src: `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&mute=1&playsinline=1`, poster: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` })
  const live = (id: string) => ({ kind: 'youtube', src: `https://www.youtube-nocookie.com/embed/live_stream?channel=${id}&autoplay=1&mute=1&playsinline=1` })

  it('tries the resolved video first, then the channel’s own player', () => {
    const ltv = channel('ltv-news')
    expect(playersOf(ltv, { id: 'ltv-news', videoId: 'MV3JB55XnqY' })).toEqual([video('MV3JB55XnqY'), live('UCOSAAyJoybqsY5sZ76BaqFA')])
    // Nothing listed, or nothing known: the channel's player may still find a single stream.
    expect(playersOf(ltv, { id: 'ltv-news' })).toEqual([live('UCOSAAyJoybqsY5sZ76BaqFA')])
    expect(playersOf(ltv, undefined)).toEqual([live('UCOSAAyJoybqsY5sZ76BaqFA')])
    expect(airOf(ltv, { id: 'ltv-news' }, riga('12:00'))).toBe('off')
    expect(airOf(ltv, undefined, riga('12:00'))).toBe('unknown')
  })

  it('plays a pinned stream unless it is known to be gone, and then only links out', () => {
    const sky = channel('sky')
    expect(playersOf(sky, { id: 'sky', videoId: 'xDWQ3LkccY8' })).toEqual([video('xDWQ3LkccY8')])
    expect(playersOf(sky, undefined)).toEqual([video('xDWQ3LkccY8')])
    expect(linkOf(sky, undefined)).toBe('https://www.youtube.com/watch?v=xDWQ3LkccY8')
    expect(airOf(sky, undefined, 0)).toBe('live')

    expect(playersOf(sky, { id: 'sky' })).toEqual([])
    expect(airOf(sky, { id: 'sky' }, 0)).toBe('link')
    // Its own page is gone with it: the channel's list of streams is where the new one is.
    expect(linkOf(sky, { id: 'sky' })).toBe('https://www.youtube.com/channel/UCoMdktPbSTixAyNGwb-UYkQ/streams')
  })

  it('has one player for a channel that needs no lookup, and none for a link', () => {
    expect(playersOf(channel('dw'), undefined)).toEqual([live('UCknLrEdhRCp1aegoMqRaCZg')])
    expect(playersOf(channel('lrt-tv'), undefined)).toEqual([{ kind: 'iframe', src: 'https://www.lrt.lt/mediateka/tiesiogiai/lrt-televizija?embed' }])
    expect(playersOf(channel('riigikogu'), undefined)).toMatchObject([{ kind: 'hls' }])
    // The chamber stream is always there; whether a sitting is on it is not known.
    expect(airOf(channel('riigikogu'), undefined, 0)).toBe('unknown')
    expect(playersOf(channel('ltv1'), undefined)).toEqual([])
    expect(airOf(channel('ltv1'), undefined, 0)).toBe('link')
  })
})

const text = (body: string) => () => new Response(body)
const status = (code: number) => () => new Response('', { status: code })

/** YouTube as a stand-in: the first key found in the address answers. Anything else is a 404. */
const ANSWERS: Record<string, () => Response> = {
  'channel_id=UCOSAAyJoybqsY5sZ76BaqFA': text(LTV),
  'channel_id=UCN6ZSYI-7pxml6bE_zrTgow': text(SEIMAS),
  'channel_id=UCdQ1YxaZG3i7ygGCdU8mPKQ': text(SAEIMA),
  // Nothing but clips: no broadcast to show.
  'channel_id=UCcG5Xi9yY89axvOTHszLCcA': text(CLIPS),
  'channel_id=UChG7C8090M0h6eCU8TM-vGQ': status(500),
  'channel_id=UCy2B86RwjKly8vab4GTg5Fw': text('<html>Before you continue to YouTube</html>'),
  'watch%3Fv%3DxDWQ3LkccY8': text(JSON.stringify({ title: 'Watch Sky News', author_name: 'Sky News', thumbnail_url: 'https://i.ytimg.com/vi/xDWQ3LkccY8/hqdefault.jpg' })),
  // Embedding switched off, gone, and YouTube having a bad moment.
  'watch%3Fv%3DpykpO5kQJ98': status(401),
  'watch%3Fv%3DO0zGN7A7dMw': status(404),
  'watch%3Fv%3DgP7872YRFDk': status(500),
}

const youtube = (answers = ANSWERS) => vi.fn<FetchLike>(async (url) => (Object.entries(answers).find(([part]) => url.includes(part))?.[1] ?? status(404))())

async function load(fetch: FetchLike, now = riga('18:10')): Promise<Map<string, TvNow>> {
  const { snapshot } = await new FeedCache({ fetch, now: () => now, log: () => {} }).get(tvFeed)
  if (snapshot.payload.shape !== 'tv') throw new Error('wrong shape')
  return new Map(snapshot.payload.channels.map((entry) => [entry.id, entry]))
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('tv feed', () => {
  /** YouTube on a good day: every channel has a feed and every pinned stream is there. */
  const WELL = { 'feeds/videos.xml': text(SAEIMA), 'oembed?': text(JSON.stringify({ title: 'Live' })) }

  it('asks YouTube once per channel that needs it, and nobody else', async () => {
    const fetch = youtube(WELL)
    await load(fetch)
    const asked = fetch.mock.calls.map(([url]) => url)
    expect(asked).toHaveLength(10)
    expect(asked.filter((url) => url.startsWith('https://www.youtube.com/feeds/videos.xml?channel_id=UC'))).toHaveLength(6)
    expect(asked.filter((url) => url.startsWith('https://www.youtube.com/oembed?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3D'))).toHaveLength(4)
  })

  it('asks once more where YouTube did not answer, and takes the second answer', async () => {
    let tries = 0
    const fetch = youtube({ 'channel_id=UCOSAAyJoybqsY5sZ76BaqFA': () => (tries++ === 0 ? status(502)() : text(LTV)()), ...WELL })
    const now = await load(fetch)
    // One hiccup at 17:55 must not leave the bulletin unknown until 18:10.
    expect(now.get('ltv-news')).toMatchObject({ videoId: 'MV3JB55XnqY', from: riga('18:00') })
    expect(fetch).toHaveBeenCalledTimes(11)
  })

  it('keeps a pinned stream that answers, and downgrades one that is gone or may not be embedded', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const now = await load(youtube())
    expect(now.get('sky')).toEqual({ id: 'sky', videoId: 'xDWQ3LkccY8', title: 'Watch Sky News' })
    for (const id of ['euronews', 'freedom']) {
      expect(now.get(id), id).toEqual({ id })
      expect(airOf(channel(id), now.get(id), riga('18:10')), id).toBe('link')
    }
    // No answer about the video is not an answer that it is gone.
    expect(now.has('dw-ru')).toBe(false)
    expect(playersOf(channel('dw-ru'), now.get('dw-ru'))).toHaveLength(1)

    // 403 is what YouTube says about a stream its publisher has retired by making it private.
    const retired = await load(youtube({ 'watch%3Fv%3DxDWQ3LkccY8': status(403), ...WELL }))
    expect(retired.get('sky')).toEqual({ id: 'sky' })
    expect(linkOf(channel('sky'), retired.get('sky'))).toBe('https://www.youtube.com/channel/UCoMdktPbSTixAyNGwb-UYkQ/streams')
  })

  it('lets a failed lookup cost only its own channel', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const now = await load(youtube())
    expect(now.get('ltv-news')).toMatchObject({ videoId: 'MV3JB55XnqY', from: riga('18:00') })
    expect(now.get('seimas')).toMatchObject({ videoId: 'ZkCAxPARKEU', today: true })
    expect(now.get('saeima')).toMatchObject({ videoId: 'ij05ZR4Q4mc', today: false })
    // The feed answered and lists no sitting: an honest "not on air".
    expect(now.get('lv-cabinet')).toEqual({ id: 'lv-cabinet' })
    expect(airOf(channel('lv-cabinet'), now.get('lv-cabinet'), riga('18:10'))).toBe('off')
    // An error, and a page that is not a feed: nothing is claimed about either channel.
    for (const id of ['lv-president', 'ee-government']) {
      expect(now.has(id), id).toBe(false)
      expect(airOf(channel(id), now.get(id), riga('18:10')), id).toBe('unknown')
    }
    expect(warn.mock.calls.map(([line]) => String(line).split(' ')[1])).toEqual(['lv-president', 'ee-government', 'dw-ru'])
  })

  it('fails as a whole only when YouTube answers nothing at all', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(load(youtube({ 'youtube.com': status(503) }))).rejects.toBeInstanceOf(FeedUnavailable)
  })
})

describe('channel list', () => {
  it('lists Latvia first, each channel once, each with a way to its broadcaster', () => {
    expect(new Set(TV_CHANNELS.map((entry) => entry.id)).size).toBe(TV_CHANNELS.length)
    const order = ['LV', 'LT', 'EE', 'INT']
    const countries = TV_CHANNELS.map((entry) => order.indexOf(entry.country))
    expect(countries).toEqual(countries.toSorted((a, b) => a - b))
    for (const entry of TV_CHANNELS) {
      expect(entry.link, entry.id).toMatch(/^https:\/\//)
      expect(entry.credit.length, entry.id).toBeGreaterThan(1)
    }
  })

  it('embeds nothing that needs a permission nobody has asked for', () => {
    for (const id of ['ltv1', 'ltv7', 'lr1', 'retv', 'etv', 'etv-plus', 'vikerraadio']) expect(channel(id).kind, id).toBe('link')
  })
})

describe('content security policy', () => {
  const policy = new Map(
    buildCsp()
      .split('; ')
      .map((directive) => directive.split(' '))
      .map(([name, ...sources]) => [name, sources]),
  )

  /** Whether the directive lets this address through: a listed origin, or a listed "*." family of hosts. */
  function allows(directive: string, address: string): boolean {
    const { origin, protocol, hostname, port } = new URL(address)
    return policy
      .get(directive)!
      .some((source) => source === origin || (source.startsWith('https://*.') && protocol === 'https:' && port === '' && hostname.endsWith(source.slice('https://*'.length))))
  }

  const NEEDS = { youtube: ['frame-src'], iframe: ['frame-src'], hls: ['connect-src', 'media-src'] }

  it('lets the browser load every player and poster a channel can ask for', () => {
    const players = TV_CHANNELS.flatMap((entry) => playersOf(entry, entry.kind === 'yt-feed' ? { id: entry.id, videoId: 'MV3JB55XnqY' } : undefined))
    expect(players.length).toBeGreaterThan(25)
    for (const player of players) {
      for (const directive of NEEDS[player.kind]) expect(allows(directive, player.src), `${directive} ${player.src}`).toBe(true)
      if (player.poster) expect(allows('img-src', player.poster), `img-src ${player.poster}`).toBe(true)
    }
    // The chamber stream's address redirects to a numbered node, and the policy applies to that hop too.
    expect(allows('connect-src', 'https://le302.euddn.net/token/smil:rk_live_1.smil/playlist.m3u8')).toBe(true)
  })

  it('lets nothing of a link-only channel into the page', () => {
    const links = TV_CHANNELS.filter((entry) => entry.kind === 'link')
    expect(links.length).toBeGreaterThan(6)
    for (const entry of links) {
      for (const directive of ['frame-src', 'media-src', 'connect-src', 'img-src']) expect(allows(directive, entry.link), `${directive} ${entry.link}`).toBe(false)
    }
  })
})
