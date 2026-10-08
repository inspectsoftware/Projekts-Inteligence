import { type NewsEntry, type NewsSource, type RawNews, linksOf, parseFeed } from '../../shared/adapters/news'
import type { PoliticsItem } from '../../shared/feeds'
import { newsEntries, newsFeed, readSources } from './news'
import type { FeedDef } from './types'

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const WINDOW_MS = 72 * HOUR
const LIMIT = 300

const BODY = { kind: 'official', weight: 1, ai: 'none' } as const

/**
 * Governments and parliaments read for this page only; everything they publish is politics.
 * The newsrooms and ministries come from the news feed's own reading, so no host is asked twice.
 * Latvia's cabinet, president and Saeima publish no feed, so their word arrives through the newsrooms.
 */
const BODIES: readonly NewsSource[] = [
  { id: 'gov-lt', url: 'https://lrv.lt/lt/naujienos/rss/', publisher: 'Government (LT)', group: 'gov-lt', lang: 'lt', country: 'LT', native: true, ...BODY },
  { id: 'riigikogu-en', url: 'https://www.riigikogu.ee/en/feed/', publisher: 'Riigikogu', group: 'gov-ee', lang: 'en', country: 'EE', ...BODY },
  { id: 'gov-ee-et', url: 'https://valitsus.ee/rss-feeds/rss.xml', publisher: 'Government (EE)', group: 'gov-ee', lang: 'et', country: 'EE', native: true, ...BODY },
]

/** Feeds of the news list whose every item is politics too: governments and foreign ministries. */
const POLITICAL_FEEDS = new Set(['gov-ee-en', 'mfa-lv-en', 'mfa-ee-en', 'eu-council'])

/**
 * Word stems of politics in English, Latvian, Lithuanian and Estonian.
 * ponytail: a keyword net, so it lets through a "party" that is a celebration and misses a story
 * that names only a politician. Use the publishers' own politics sections where they have a feed.
 */
const POLITICS =
  /parliament|government|minist|president|prezident|election|coalition|koal[iī]cij|koalitsioon|opposition|opoz[iī]cij|opositsioon|\bpart(?:y|ies)\b|partij|erakon|politi|poliiti|referendum|saeim|\bseim|riigikogu|valdīb|vyriausyb|valitsus|vēlēšan|rinkim|valimi|deputāt|likum|įstatym|seadus|budžet|biudžet|eelarve|\bbudget|premjer|peaminist|mayor|\bvot(?:e|es|ed|ing)\b|sanction|sankcij|sanktsioon/iu

const lastRead = new Map<string, RawNews[]>()

/** The political stories among these, newest first, exactly as their publishers worded them. */
export function pickPolitics(entries: readonly NewsEntry[], now: number): PoliticsItem[] {
  const seen = new Set<string>()
  return entries
    .filter(({ item, source }) => {
      if (now - item.at >= WINDOW_MS || seen.has(item.link)) return false
      const political = BODIES.includes(source) || POLITICAL_FEEDS.has(source.id) || POLITICS.test(`${item.title} ${item.desc}`)
      if (political) seen.add(item.link)
      return political
    })
    .map(({ item, source }) => ({
      title: item.title,
      link: item.link,
      at: item.at,
      publisher: source.publisher,
      lang: source.lang,
      country: source.country,
      official: source.kind === 'official',
    }))
    .sort((a, b) => b.at - a.at)
    .slice(0, LIMIT)
}

/**
 * Baltic politics as it is published: headline, publisher, time and link, newest first. Nothing is
 * rated, summarised or left out for being unimportant.
 */
export const politicsFeed: FeedDef = {
  id: 'politics',
  title: 'Politics',
  // The newsrooms' hosts too: after a restart this feed may have to read them itself, once.
  origins: [...new Set([...BODIES.map((source) => new URL(source.url).origin), ...newsFeed.origins])],
  ttlMs: 10 * MINUTE,
  staleMs: 12 * HOUR,
  timeoutMs: 25_000,
  persist: true,
  attribution: [...newsFeed.attribution, ...BODIES.map((source) => ({ label: source.publisher, href: linksOf(source)[0] }))].filter(
    (credit, index, all) => all.findIndex((other) => other.label === credit.label) === index,
  ),
  async load({ http, now, feed }) {
    // Brings the newsrooms' feeds up to date. If that fails, what was read before still stands.
    await feed('news').catch(() => undefined)
    // A restart can leave the news list served from disk with nothing read in this process yet.
    if (newsEntries(now).length === 0) await readSources(http, now).catch(() => undefined)
    await Promise.allSettled(
      BODIES.map(async (source) => {
        const items = parseFeed(await http.text(source.url, { maxBytes: 1024 * 1024, timeoutMs: 12_000 }), source)
        if (items.length > 0) lastRead.set(source.id, items)
      }),
    )
    const own = BODIES.flatMap((source) => (lastRead.get(source.id) ?? []).map((item) => ({ item, source })))
    const items = pickPolitics([...own, ...newsEntries(now)], now)
    if (items.length === 0) throw new Error('No political headlines could be read')
    return { shape: 'politics', items }
  },
}
