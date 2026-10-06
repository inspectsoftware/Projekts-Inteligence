import { broadcastOf, channelVideos } from '../../shared/adapters/tv'
import type { TvNow } from '../../shared/feeds'
import { TV_CHANNELS, type TvChannel } from '../../shared/media/tv'
import { type Upstream, UpstreamError } from '../core/upstream'
import type { FeedDef } from './types'

const MINUTE = 60 * 1000
const YOUTUBE = 'https://www.youtube.com'

/** A channel feed is some 20 kB, an answer about one video under 2 kB. Two tries of six seconds fit in one refresh. */
const SMALL = { timeoutMs: 6000, maxBytes: 256 * 1024 }

/** The channels YouTube has to be asked about. The rest play from an address that never changes. */
const ASKED = TV_CHANNELS.filter((channel) => channel.kind === 'yt-feed' || channel.kind === 'yt-video')

async function lookUp(channel: Extract<TvChannel, { kind: 'yt-feed' | 'yt-video' }>, http: Upstream, now: number): Promise<TvNow> {
  if (channel.kind === 'yt-feed') {
    const videos = channelVideos(await http.text(`${YOUTUBE}/feeds/videos.xml?channel_id=${channel.channelId}`, SMALL))
    // A consent or error page served with a 200 is not a feed, and says nothing about the channel.
    if (videos.length === 0) throw new UpstreamError('bad-body', 'youtube.com did not send a channel feed')
    return broadcastOf(channel, videos, now) ?? { id: channel.id }
  }
  // YouTube's own answer about the pinned video: its title, or an error once it cannot be shown.
  const watch = encodeURIComponent(`${YOUTUBE}/watch?v=${channel.videoId}`)
  try {
    const answer = await http.json<{ title?: unknown }>(`${YOUTUBE}/oembed?url=${watch}&format=json`, SMALL)
    return { id: channel.id, videoId: channel.videoId, title: typeof answer?.title === 'string' ? answer.title.slice(0, 200) : undefined }
  } catch (err) {
    // 404: the video is gone. 403: it was made private, as a retired stream is. 401: it may no
    // longer be embedded. Any other failure says nothing about it.
    if (err instanceof UpstreamError && [401, 403, 404].includes(err.status ?? 0)) return { id: channel.id }
    throw err
  }
}

/** YouTube not answering, as opposed to answering with a refusal: worth asking once more. */
const noAnswer = (err: unknown) => err instanceof UpstreamError && (err.kind === 'timeout' || err.kind === 'network' || (err.status ?? 0) >= 500)

/**
 * What each television channel should load right now, as far as it has to be looked up: which
 * video is today's bulletin or sitting, and whether each pinned stream still exists. Ten small
 * requests per refresh, all to YouTube's feed and oEmbed addresses for the channels on our own
 * list, and one more for each that got no answer.
 * ponytail: the pinned streams are checked on every refresh although they change every few weeks;
 * remember each answer for an hour if four requests per quarter of an hour are ever too many.
 */
export const tvFeed: FeedDef = {
  id: 'tv',
  title: 'Live television',
  origins: [YOUTUBE],
  // As long as YouTube lets a channel feed be kept (max-age=900).
  ttlMs: 15 * MINUTE,
  staleMs: 2 * 60 * MINUTE,
  timeoutMs: 15_000,
  // Each channel carries its own credit, shown under its player.
  attribution: [],
  async load({ http, now }) {
    const results = await Promise.allSettled(
      ASKED.map((channel) =>
        // Asked a second time at once: a single hiccup would otherwise leave the channel unknown
        // to every visitor for the quarter of an hour this answer is kept.
        lookUp(channel, http, now).catch((err: unknown) => {
          if (!noAnswer(err)) throw err
          return lookUp(channel, http, now)
        }),
      ),
    )
    const channels = results.flatMap((result, index) => {
      if (result.status === 'fulfilled') return [result.value]
      // Only our own messages are logged: anything else could carry an address.
      console.warn(`[feed:tv] ${ASKED[index].id} not looked up: ${result.reason instanceof UpstreamError ? result.reason.message : 'could not be read'}`)
      return []
    })
    // One failed lookup costs its own channel, which the window then treats as unchecked. With
    // all of them failed YouTube is not answering, and the last good copy is worth more than none.
    if (channels.length === 0) throw results.find((result) => result.status === 'rejected')!.reason
    return { shape: 'tv', channels }
  },
}
