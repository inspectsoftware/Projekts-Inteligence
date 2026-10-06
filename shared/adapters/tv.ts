import type { TvNow } from '../feeds'
import { BALTIC_TIME, type TvChannel } from '../media/tv'

export interface FeedVideo {
  videoId: string
  title: string
}

const XML: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

/** The videos a YouTube channel feed lists, in the feed's own order. */
export function channelVideos(xml: string): FeedVideo[] {
  return [...xml.matchAll(/<entry>[\s\S]*?<\/entry>/g)].flatMap(([entry]) => {
    // The id becomes part of a player address, so only what looks like one passes.
    const videoId = /<yt:videoId>([A-Za-z0-9_-]{11})<\/yt:videoId>/.exec(entry)?.[1]
    const title = /<title>([^<]*)<\/title>/.exec(entry)?.[1]
    if (!videoId || !title) return []
    return [{ videoId, title: title.replace(/&(amp|lt|gt|quot|apos);/g, (_, name: string) => XML[name]).slice(0, 200) }]
  })
}

/** Month names by how they begin in Latvian and Estonian: "oktobra", "oktobrī", "oktoober". */
const MONTHS = ['janv|jaan', 'febr|veeb', 'mart|märt', 'apr', 'mai', 'jūn|juun', 'jūl|juul', 'aug', 'sept', 'okt', 'novemb', 'dec|dets'].map(
  (starts) => new RegExp(`^(?:${starts})`, 'i'),
)

const pad = (part: string | number) => String(part).padStart(2, '0')

/**
 * The day a broadcast is for, as its title says it, as "2026-10-06". The channels spell it three
 * ways: "2026-10-06 Seimo…", "…sēde 6.10.2026." and "6. oktobra…" or "…1. oktoober 2026".
 * Null when the title names no day. The feed itself only says when a video was listed, which
 * for a parliament is weeks before the sitting.
 */
export function titleDate(title: string, today: string): string | null {
  const iso = /\b\d{4}-\d{2}-\d{2}\b/.exec(title)
  if (iso) return iso[0]
  const dotted = /\b(\d{1,2})\.(\d{1,2})\.(\d{4})\b/.exec(title)
  if (dotted) return `${dotted[3]}-${pad(dotted[2])}-${pad(dotted[1])}`
  const year = /\b\d{4}\b/.exec(title)?.[0]
  for (const [, day, word] of title.matchAll(/\b(\d{1,2})\. (\p{L}+)/gu)) {
    const month = MONTHS.findIndex((name) => name.test(word)) + 1
    if (month === 0) continue
    const date = `${year ?? today.slice(0, 4)}-${pad(month)}-${pad(day)}`
    // A title without a year is a recent one: "31. decembra" read on 1 January was last year's.
    return year || date <= today ? date : `${Number(today.slice(0, 4)) - 1}${date.slice(4)}`
  }
  return null
}

/** "2026-10-06 18:00": the day and the time of day in the Baltic states at an instant. */
const BALTIC = new Intl.DateTimeFormat('sv-SE', { timeZone: BALTIC_TIME, dateStyle: 'short', timeStyle: 'short' })

const minutesOf = (time: string) => {
  const [hours, minutes] = time.split(':').map(Number)
  return hours * 60 + minutes
}

/**
 * What a scheduled channel should show at this moment, out of its feed: today's broadcast if one
 * is listed, else the latest one already held. Never an entry for a later day, which a player
 * would show as a countdown of a week. Null when the feed lists no broadcast at all.
 *
 * Where the day has several programmes at fixed times, it is the one on air or the next to start,
 * with its slot; after the last one, the last one the feed lists. A busy day pushes a bulletin
 * that has not started out of the feed's fifteen entries: its slot is then given without a video,
 * and the channel's own player address is what finds it.
 */
export function broadcastOf(channel: Extract<TvChannel, { kind: 'yt-feed' }>, videos: readonly FeedVideo[], clock: number): TvNow | null {
  const [today, time] = BALTIC.format(clock).split(' ')
  const held = videos.flatMap((video) => {
    const day = channel.title.test(video.title) ? titleDate(video.title, today) : null
    return day && day <= today ? [{ ...video, day }] : []
  })
  if (held.length === 0) return null
  // The first of the newest day: a feed lists what is on air ahead of what the same day held earlier.
  const latest = held.reduce((best, video) => (video.day > best.day ? video : best))
  const now: TvNow = { id: channel.id, videoId: latest.videoId, title: latest.title, today: latest.day === today }
  if (!now.today || !channel.slots) return now

  // Off by an hour only when the clocks change between now and the slot, which they do at night.
  const midnight = Math.floor(clock / 60_000) * 60_000 - minutesOf(time) * 60_000
  let last: TvNow | undefined
  for (const slot of channel.slots) {
    const video = held.find((candidate) => candidate.day === today && slot.title.test(candidate.title))
    // A slot is believed without its video only after one the feed does list: by itself, a
    // missing bulletin may just as well be one that is not made that day.
    if (!video && !last) continue
    const from = midnight + minutesOf(slot.at) * 60_000
    const to = from + slot.minutes * 60_000
    const show: TvNow = { id: channel.id, ...(video && { videoId: video.videoId, title: video.title }), today: true, from, to }
    if (clock < to) return show
    if (video) last = show
  }
  return last ?? now
}

/**
 * What can honestly be said about a channel: on air; a known start still ahead; a broadcast listed
 * for today, which the player shows as a countdown, live or as a recording; nothing today; nothing
 * known (no lookup, or it failed); or no player at all.
 */
export type Air = 'live' | 'next' | 'today' | 'off' | 'unknown' | 'link'

export function airOf(channel: TvChannel, now: TvNow | undefined, clock: number): Air {
  if (playersOf(channel, now).length === 0) return 'link'
  if (!channel.schedule) return 'live'
  if (!now) return 'unknown'
  if (now.from !== undefined && now.to !== undefined) return clock < now.from ? 'next' : clock < now.to ? 'live' : 'off'
  return now.today ? 'today' : 'off'
}

export interface TvPlayer {
  kind: 'youtube' | 'iframe' | 'hls'
  src: string
  poster?: string
}

const PLAYER = 'https://www.youtube-nocookie.com/embed'
/** Muted, or no browser lets it start by itself; in the page, or an iPhone takes over the whole screen. */
const START = 'autoplay=1&mute=1&playsinline=1'

const video = (videoId: string): TvPlayer => ({
  kind: 'youtube',
  src: `${PLAYER}/${videoId}?${START}`,
  poster: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
})

/** Finds a channel's stream by itself, but only while the channel has exactly one live or upcoming. */
const channelPlayer = (channelId: string): TvPlayer => ({ kind: 'youtube', src: `${PLAYER}/live_stream?channel=${channelId}&${START}` })

/**
 * The players to try for a channel, best first: the video the feed resolved or the pinned one,
 * then the channel's own player address where that can work. When the list is empty, or none of
 * them starts, the channel's link is all there is.
 */
export function playersOf(channel: TvChannel, now: TvNow | undefined): TvPlayer[] {
  switch (channel.kind) {
    case 'link':
      return []
    case 'iframe':
    case 'hls':
      return [{ kind: channel.kind, src: channel.src }]
    case 'yt-channel':
      return [channelPlayer(channel.channelId)]
    case 'yt-video': {
      // Unchecked, the pinned stream is still worth a try: its player reports a dead one itself.
      const videoId = now ? now.videoId : channel.videoId
      return videoId ? [video(videoId)] : []
    }
    case 'yt-feed':
      return [...(now?.videoId ? [video(now.videoId)] : []), channelPlayer(channel.channelId)]
  }
}

/** Where to send the viewer instead of a player. Once a pinned stream is gone its own page is too, so then it is the channel's list of streams. */
export function linkOf(channel: TvChannel, now: TvNow | undefined): string {
  return channel.kind === 'yt-video' && now && !now.videoId ? `https://www.youtube.com/channel/${channel.channelId}/streams` : channel.link
}
