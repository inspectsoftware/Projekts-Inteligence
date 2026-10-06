/**
 * The channels of the Live TV window, in the order they are listed: Latvia first, then Lithuania,
 * Estonia, and the international newsrooms that cover the region's security.
 *
 * Every embedded entry played from another site's page on 2026-10-06, through an embed its
 * publisher offers. Where a broadcaster's terms ask for written permission first (LSM, ReTV), forbid
 * reuse (ERR) or its site refuses to be framed, the channel is a link to its own page and nothing more.
 */

export type TvCountry = 'LV' | 'LT' | 'EE' | 'INT'

/** Latvia, Lithuania and Estonia keep the same time, so one zone dates every broadcast and every slot. */
export const BALTIC_TIME = 'Europe/Riga'

/** A programme that starts at the same time every day, as "HH:MM" in Baltic time. */
export interface TvSlot {
  title: RegExp
  at: string
  minutes: number
}

interface Listing {
  id: string
  name: string
  country: TvCountry
  lang: 'lv' | 'lt' | 'et' | 'en' | 'ru'
  /** When it is on air. Absent for a channel that is on round the clock. */
  schedule?: string
  /** The broadcaster's own page for the same thing: the way out when a player fails, and all there is of a link-only channel. */
  link: string
  credit: string
}

export type TvChannel = Listing &
  (
    | { kind: 'yt-channel'; channelId: string }
    | { kind: 'yt-video'; videoId: string; channelId: string }
    /** A YouTube channel that broadcasts now and then. `title` picks its broadcasts out of the channel feed; each such title names its day. */
    | { kind: 'yt-feed'; channelId: string; title: RegExp; slots?: readonly TvSlot[] }
    /** The broadcaster's own embeddable player page. */
    | { kind: 'iframe'; src: string }
    | { kind: 'hls'; src: string }
    | { kind: 'link' }
  )

const YOUTUBE = 'https://www.youtube.com'

/** A YouTube channel with one live stream, which the channel's own player address always finds. */
const single = (channelId: string) => ({ kind: 'yt-channel', channelId, link: `${YOUTUBE}/channel/${channelId}/live` }) as const

/**
 * One stream of a YouTube channel that runs several, where the channel's player address finds none.
 * The video id changes without notice (Sky's every few weeks) and nothing keyless can find the new
 * one: when the feed reports the old one gone, put the new id here.
 */
const pinned = (videoId: string, channelId: string) => ({ kind: 'yt-video', videoId, channelId, link: `${YOUTUBE}/watch?v=${videoId}` }) as const

const lrt = (slug: string) =>
  ({ kind: 'iframe', src: `https://www.lrt.lt/mediateka/tiesiogiai/${slug}?embed`, link: `https://www.lrt.lt/mediateka/tiesiogiai/${slug}`, country: 'LT', lang: 'lt', credit: 'LRT' }) as const

export const TV_CHANNELS: readonly TvChannel[] = [
  // ---- Latvia. Nothing here is on round the clock: see the README for what LSM and ReTV would have to allow.
  {
    id: 'ltv-news',
    name: 'LTV news',
    country: 'LV',
    lang: 'lv',
    schedule: 'Dienas ziņas at 18:00 and Panorāma at 20:30, Riga time',
    kind: 'yt-feed',
    channelId: 'UCOSAAyJoybqsY5sZ76BaqFA',
    title: /Dienas ziņas|Panorāma/,
    slots: [
      { title: /Dienas ziņas/, at: '18:00', minutes: 35 },
      // Runs on into "Šodienas jautājums", in the same broadcast.
      { title: /Panorāma/, at: '20:30', minutes: 55 },
    ],
    link: `${YOUTUBE}/channel/UCOSAAyJoybqsY5sZ76BaqFA/live`,
    credit: 'LTV / LSM',
  },
  {
    id: 'saeima',
    name: 'Saeima',
    country: 'LV',
    lang: 'lv',
    schedule: 'Parliament sittings, usually on Thursdays',
    kind: 'yt-feed',
    channelId: 'UCdQ1YxaZG3i7ygGCdU8mPKQ',
    title: /^Saeimas sēde/,
    // Saeima lets its sittings be embedded from its YouTube account and asks for a link to saeima.lv.
    link: 'https://www.saeima.lv/lv/streams/video',
    credit: 'Saeima',
  },
  {
    id: 'lv-cabinet',
    name: 'Cabinet of Ministers',
    country: 'LV',
    lang: 'lv',
    schedule: 'Government sittings on Tuesdays, and the press conference after',
    kind: 'yt-feed',
    channelId: 'UCcG5Xi9yY89axvOTHszLCcA',
    title: /^Ministru kabineta sēde|^Preses konference pēc Ministru kabineta sēdes/,
    link: 'https://www.mk.gov.lv/lv/tiesraide',
    credit: 'Valsts kanceleja',
  },
  {
    id: 'lv-president',
    name: 'President of Latvia',
    country: 'LV',
    lang: 'lv',
    schedule: 'Statements and press conferences, as they happen',
    kind: 'yt-feed',
    channelId: 'UChG7C8090M0h6eCU8TM-vGQ',
    // The live events are the uploads that start with their date; the rest are short clips of meetings.
    title: /^\d{2}\.\d{2}\.\d{4}\. /,
    link: `${YOUTUBE}/channel/UChG7C8090M0h6eCU8TM-vGQ/live`,
    credit: 'Valsts prezidenta kanceleja',
  },
  { id: 'ltv1', name: 'LTV1', country: 'LV', lang: 'lv', kind: 'link', link: 'https://replay.lsm.lv/lv/skaties/tiesraide/ltv1', credit: 'LSM' },
  { id: 'ltv7', name: 'LTV7', country: 'LV', lang: 'lv', kind: 'link', link: 'https://replay.lsm.lv/lv/skaties/tiesraide/ltv7', credit: 'LSM' },
  { id: 'lr1', name: 'Latvijas Radio 1', country: 'LV', lang: 'lv', kind: 'link', link: 'https://latvijasradio.lsm.lv/lv/tiesraide/?channel=1', credit: 'Latvijas Radio / LSM' },
  { id: 'retv', name: 'ReTV', country: 'LV', lang: 'lv', kind: 'link', link: 'https://retv.lv/tiesraide/', credit: 'ReTV' },
  { id: 'tv24', name: 'TV24', country: 'LV', lang: 'lv', kind: 'link', link: 'https://xtv.lv/rigatv24', credit: 'TV24' },

  // ---- Lithuania. LRT publishes an embeddable page for each of its channels.
  { id: 'lrt-tv', name: 'LRT Televizija', ...lrt('lrt-televizija') },
  // The channel made for viewers abroad, so the one least likely to be held back outside Lithuania.
  { id: 'lrt-lituanica', name: 'LRT Lituanica', ...lrt('lrt-lituanica') },
  { id: 'lrt-plius', name: 'LRT Plius', ...lrt('lrt-plius') },
  { id: 'lrt-radijas', name: 'LRT Radijas', ...lrt('lrt-radijas') },
  {
    id: 'seimas',
    name: 'Seimas',
    country: 'LT',
    lang: 'lt',
    schedule: 'Parliament sittings on Tuesdays and Thursdays',
    kind: 'yt-feed',
    channelId: 'UCN6ZSYI-7pxml6bE_zrTgow',
    title: /^\d{4}-\d{2}-\d{2} Seimo .*posėdis/,
    // Not /live: that leads to whatever comes next on the channel, often a committee meeting.
    link: `${YOUTUBE}/channel/UCN6ZSYI-7pxml6bE_zrTgow/streams`,
    credit: 'Lietuvos Respublikos Seimas',
  },
  { id: 'delfi-lt', name: 'Delfi TV', country: 'LT', lang: 'lt', kind: 'link', link: 'https://www.delfi.lt/tv/', credit: 'Delfi' },
  { id: 'lrytas', name: 'Lietuvos rytas TV', country: 'LT', lang: 'lt', kind: 'link', link: 'https://tv.lrytas.lt/', credit: 'Lietuvos rytas' },

  // ---- Estonia. ERR's terms allow a link and nothing else, so its television is not embedded.
  {
    id: 'riigikogu',
    name: 'Riigikogu',
    country: 'EE',
    lang: 'et',
    schedule: 'The chamber of parliament: a title card while it is not sitting',
    kind: 'hls',
    // Read from the player on Riigikogu's own live page. If it stops answering, read it there again.
    src: 'https://router.euddn.net/862366dd346d6b6392d5231546f3d179/smil:rk_live_1.smil/playlist.m3u8?c=8005',
    link: 'https://www.riigikogu.ee/info-ja-meedia/otseulekanded/',
    credit: 'Riigikogu',
  },
  {
    id: 'ee-government',
    name: 'Government of Estonia',
    country: 'EE',
    lang: 'et',
    schedule: 'Government press conference on Thursdays',
    kind: 'yt-feed',
    channelId: 'UCy2B86RwjKly8vab4GTg5Fw',
    // The comma leaves out the second upload of each one, with sign language, which arrives a day late.
    title: /^Valitsuse pressikonverents,/,
    link: `${YOUTUBE}/channel/UCy2B86RwjKly8vab4GTg5Fw/live`,
    credit: 'Riigikantselei',
  },
  { id: 'etv', name: 'ETV', country: 'EE', lang: 'et', kind: 'link', link: 'https://otse.err.ee/k/etv', credit: 'ERR' },
  { id: 'etv-plus', name: 'ETV+', country: 'EE', lang: 'ru', kind: 'link', link: 'https://otse.err.ee/k/etvpluss', credit: 'ERR' },
  { id: 'vikerraadio', name: 'Vikerraadio', country: 'EE', lang: 'et', kind: 'link', link: 'https://otse.err.ee/k/vikerraadio', credit: 'ERR' },

  // ---- International, on YouTube with embedding switched on by each publisher.
  { id: 'tvp-world', name: 'TVP World', country: 'INT', lang: 'en', credit: 'TVP', ...single('UCBjUPsHj7bXt24SUWNoZ0zA') },
  { id: 'dw', name: 'DW News', country: 'INT', lang: 'en', credit: 'Deutsche Welle', ...single('UCknLrEdhRCp1aegoMqRaCZg') },
  { id: 'france24', name: 'France 24', country: 'INT', lang: 'en', credit: 'France 24', ...single('UCQfwfsi5VrQ8yKZ-UWmAEFg') },
  { id: 'euronews', name: 'Euronews', country: 'INT', lang: 'en', credit: 'Euronews', ...pinned('pykpO5kQJ98', 'UCSrZ3UV4jOidv8ppoVuvW9Q') },
  { id: 'sky', name: 'Sky News', country: 'INT', lang: 'en', credit: 'Sky News', ...pinned('xDWQ3LkccY8', 'UCoMdktPbSTixAyNGwb-UYkQ') },
  { id: 'aljazeera', name: 'Al Jazeera', country: 'INT', lang: 'en', credit: 'Al Jazeera', ...single('UCNye-wNBqNL5ZzHSJj3l8Bg') },
  { id: 'uatv', name: 'UATV', country: 'INT', lang: 'en', credit: 'UATV', ...single('UCOmfcmDrWs7iJrXx7V5Cnwg') },
  { id: 'current-time', name: 'Current Time', country: 'INT', lang: 'ru', credit: 'RFE/RL', ...single('UCBG57608Hukev3d0d-gvLhQ') },
  // Not the stream its channel page leads to: that one starts anew every morning.
  { id: 'freedom', name: 'FREEDOM', country: 'INT', lang: 'ru', credit: 'FREEДОМ', ...pinned('O0zGN7A7dMw', 'UCt3igz3aIXfS108KV_jZsMA') },
  { id: 'dw-ru', name: 'DW на русском', country: 'INT', lang: 'ru', credit: 'Deutsche Welle', ...pinned('gP7872YRFDk', 'UCXoAjrdHFa2hEL3Ug8REC1w') },
  { id: 'euronews-ru', name: 'Euronews по-русски', country: 'INT', lang: 'ru', credit: 'Euronews', ...single('UCFzJjgVicCtFxJ5B0P_ei8A') },
  { id: 'bloomberg', name: 'Bloomberg TV', country: 'INT', lang: 'en', credit: 'Bloomberg', ...single('UCIALMKvObZNtJ6AmdCLP7Lg') },
]
