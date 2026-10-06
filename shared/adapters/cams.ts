import type { Entity } from '../entity'
import type { Cam } from '../feeds'
import { msg } from '../i18n'
import type { Camera } from './roads'

/** A camera with a known position, as a dot on the map. */
export type CamEntity = Entity<Cam>

/** Five decimals is about a metre: enough for a dot, and it keeps the feed small. */
const round = (degrees: number) => Math.round(degrees * 1e5) / 1e5

/**
 * Address of a camera's picture at this moment, or null for a view that has none. It changes
 * once per refresh period, so the browser fetches a new frame then and never in between.
 */
export function pictureOf(cam: Cam, now: number): string | null {
  const url = cam.kind === 'still' ? cam.src : cam.poster
  if (!url || !cam.refreshS) return url ?? null
  return `${url}${url.includes('?') ? '&' : '?'}t=${Math.floor(now / (cam.refreshS * 1000))}`
}

export const youtubeEmbed = (videoId: string) => `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&mute=1`

/** A channel's current live stream, whatever its video id is today. Works for public streams only. */
export const youtubeLive = (channelId: string) =>
  `https://www.youtube-nocookie.com/embed/live_stream?channel=${channelId}&autoplay=1&mute=1`

/** The video behind every YouTube player embedded in a page, once each. */
export function youtubeIds(html: string): string[] {
  const ids = [...html.matchAll(/youtube(?:-nocookie)?\.com\/embed\/([A-Za-z0-9_-]{11})(?![A-Za-z0-9_-])/g)].map((match) => match[1])
  // Two player addresses that are not videos happen to be eleven letters long as well.
  return [...new Set(ids)].filter((id) => id !== 'live_stream' && id !== 'videoseries')
}

/**
 * Where ipcamlive is serving a camera from right now, out of its answer about one alias.
 * The stream id changes whenever the camera reconnects, so it is asked for, never stored.
 */
export function ipcamStream(state: unknown): { hls: string; still: string } | null {
  const details = (state as { details?: Record<string, unknown> } | null)?.details
  const host = /^https?:\/\/(s\d+\.ipcamlive\.com)\/?$/.exec(String(details?.address))?.[1]
  const id = String(details?.streamid)
  // Both are checked letter by letter: they become addresses the browser loads.
  if (details?.streamavailable !== '1' || !host || !/^[a-z0-9]+$/.test(id)) return null
  return { hls: `https://${host}/streams/${id}/stream.m3u8`, still: `https://${host}/streams/${id}/snapshot.jpg` }
}

export interface EismoFeature {
  id: string
  name: string
  lon: number
  lat: number
}

/** The road cameras in eismoinfo.lt's map layer. Positions arrive as [lat, lon]. */
export function eismoFeatures(layers: unknown): EismoFeature[] {
  const features = (layers as { features?: { id?: unknown; name?: unknown; points?: { point?: unknown[] }[] }[] }[] | null)?.[0]?.features
  if (!Array.isArray(features)) return []
  return features.flatMap(({ id, name, points }) => {
    const [lat, lon] = points?.[0]?.point ?? []
    // The id goes into the address of the next request, so only plain numbers pass.
    if (typeof id !== 'string' || !/^\d+$/.test(id) || typeof name !== 'string' || typeof lat !== 'number' || typeof lon !== 'number') return []
    return [{ id, name, lon: round(lon), lat: round(lat) }]
  })
}

const EISMO_PHOTO = /^https:\/\/eismoinfo\.lt\/eismoinfo-backend-v2\/image-provider\/camera\/old\?id=\d+$/
/** An hour, and half of one more so the night the clocks go forward does not empty the list. */
const EISMO_STALE = 90 * 60 * 1000

/** The wall clock in Vilnius, written the way eismoinfo.lt dates its photos. */
const VILNIUS = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Vilnius', dateStyle: 'short', timeStyle: 'short' })

/** "2026-10-06 18:40" (Vilnius time) read as if it were UTC: only the gap between two of them is ever used. */
const stamp = (local: unknown) => (typeof local === 'string' ? Date.parse(`${local.replace(' ', 'T')}Z`) : NaN)

/**
 * Lithuania's road cameras with their latest photo. The details arrive without ids, in the order
 * the ids were asked for, so each row is checked against the name it should carry.
 */
export function eismoCams(features: readonly EismoFeature[], details: unknown, now: number): Cam[] {
  const rows = (Array.isArray(details) ? details : []) as { name?: unknown; info?: { dateFrom?: unknown; photos?: unknown[] }[] }[]
  const clock = stamp(VILNIUS.format(now))
  return features.flatMap((feature, index) => {
    const info = rows[index]?.info?.[0]
    const photo = info?.photos?.[0]
    // A photo this far behind the clock is a camera that has stopped, or the publisher's whole
    // pipeline: an old frame would pass for a live one.
    if (rows[index]?.name !== feature.name || typeof photo !== 'string' || !EISMO_PHOTO.test(photo) || !(clock - stamp(info?.dateFrom) <= EISMO_STALE)) return []
    return [
      {
        id: `lt-${feature.id}`,
        name: feature.name,
        place: msg('Lithuania'),
        country: 'LT' as const,
        lon: feature.lon,
        lat: feature.lat,
        kind: 'still' as const,
        // No refresh period: every new photo has an address of its own, which arrives with the feed.
        src: photo,
        road: true,
        credit: 'Via Lietuva / eismoinfo.lt',
        page: 'https://eismoinfo.lt/',
      },
    ]
  })
}

/**
 * Tallinn's junction cameras, read from the list built into the publisher's own page.
 * It gives names and no positions, so these never reach the map.
 */
export function tallinnCams(html: string): Cam[] {
  const cams = new Map<string, Cam>()
  for (const [, cam, name] of html.matchAll(/\{\s*'cam':'(cam\d{3})',\s*'name':\s*'([^']*)'/g)) {
    cams.set(cam, {
      id: `tln-${cam}`,
      // The trailing star is a footnote mark on the publisher's page.
      name: name.replace(/\*$/, '').replace(/\s+/g, ' ').trim() || cam,
      place: 'Tallinn',
      country: 'EE',
      kind: 'still',
      src: `https://ristmikud.tallinn.ee/last/${cam}.jpg`,
      refreshS: 10,
      road: true,
      credit: 'Tallinna Liikuvusamet',
      page: 'https://ristmikud.tallinn.ee/',
    })
  }
  return [...cams.values()]
}

/** Latvia's state road cameras, which the cameras feed already carries, as tiles for the camera grid. */
export function lvRoadCams(cameras: readonly Camera[]): Cam[] {
  return cameras.map((camera) => ({
    // Kept as it is, so the grid can point at the same dot the road camera layer draws.
    id: camera.id,
    name: camera.props.road,
    place: msg('Latvia'),
    country: 'LV',
    lon: camera.lon,
    lat: camera.lat,
    kind: 'still',
    src: camera.props.image,
    refreshS: 300,
    road: true,
    credit: 'Latvijas Valsts ceļi',
    page: 'https://map.transportdata.gov.lv/',
  }))
}

/** The cameras that have a position, as map entities. */
export function camEntities(cams: readonly Cam[], now: number): CamEntity[] {
  return cams.flatMap((cam) =>
    cam.lon === undefined || cam.lat === undefined
      ? []
      : [{ id: `webcam:${cam.id}`, kind: 'webcam' as const, lon: cam.lon, lat: cam.lat, label: cam.name, ts: now, flags: 0, props: cam }],
  )
}
