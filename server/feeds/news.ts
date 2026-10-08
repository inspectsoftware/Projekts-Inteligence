import { type NewsEntry, type NewsSource, type RawNews, linksOf, parseFeed, rank } from '../../shared/adapters/news'
import type { NewsItem } from '../../shared/feeds'
import { type Upstream, UpstreamError } from '../core/upstream'
import { setBlurbs } from './newsBlurbs'
import type { FeedDef } from './types'

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE

/** A government body: its word confirms a story, and it may be summarised by a language model. */
const OFFICIAL = { kind: 'official', weight: 1, ai: 'summary' } as const

/**
 * Every feed read, each checked from this server with the app's own User-Agent. The addresses are
 * final ones: a redirect to a host not listed here is refused by the upstream client.
 *
 * `ai` is a cautious reading of each publisher's terms and robots.txt. LSM and ERR allow sharing
 * a headline with a link and nothing more without permission, so a model may rate them but not
 * reword them. Delfi, LRT and BNN shut language models out altogether.
 */
const SOURCES: readonly NewsSource[] = [
  // English-language news from and about the region.
  { id: 'lsm-en', url: 'https://eng.lsm.lv/rss/', publisher: 'LSM', group: 'lsm', lang: 'en', country: 'LV', kind: 'media', weight: 0.9, ai: 'rate-only' },
  { id: 'err-en', url: 'https://news.err.ee/rss', publisher: 'ERR', group: 'err', lang: 'en', country: 'EE', kind: 'media', weight: 0.9, ai: 'rate-only' },
  { id: 'lrt-en', url: 'https://www.lrt.lt/en/news-in-english?rss', publisher: 'LRT', group: 'lrt', lang: 'en', country: 'LT', kind: 'media', weight: 0.9, ai: 'none' },
  { id: 'delfi-lt-en', url: 'https://feed.delfi.lt/v2/articles/80780013?format=rss', publisher: 'Delfi', group: 'delfi', lang: 'en', country: 'LT', kind: 'media', weight: 0.75, ai: 'none', links: ['https://www.delfi.lt/'] },
  { id: 'bnn', url: 'https://bnn-news.com/feed.xml', publisher: 'BNN', group: 'bnn', lang: 'en', country: 'LV', kind: 'media', weight: 0.7, ai: 'none' },
  { id: 'kyivindependent', url: 'https://kyivindependent.com/news-archive/rss/', publisher: 'Kyiv Independent', group: 'kyivindependent', lang: 'en', country: 'INT', kind: 'media', weight: 0.7, ai: 'summary' },
  { id: 'rferl', url: 'https://www.rferl.org/api/', publisher: 'RFE/RL', group: 'rferl', lang: 'en', country: 'INT', kind: 'media', weight: 0.75, ai: 'summary' },
  { id: 'meduza-en', url: 'https://meduza.io/rss/en/all', publisher: 'Meduza', group: 'meduza', lang: 'en', country: 'INT', kind: 'media', weight: 0.7, ai: 'summary' },
  { id: 'moscowtimes', url: 'https://www.themoscowtimes.com/rss/news', publisher: 'The Moscow Times', group: 'moscowtimes', lang: 'en', country: 'INT', kind: 'media', weight: 0.65, ai: 'summary' },

  // Investigations and analysis: a few pieces a day at most.
  { id: 'theins-en', url: 'https://theins.press/en/feed', publisher: 'The Insider', group: 'theins', lang: 'en', country: 'INT', kind: 'analysis', weight: 0.65, ai: 'summary' },
  { id: 'icds', url: 'https://icds.ee/en/feed/', publisher: 'ICDS', group: 'icds', lang: 'en', country: 'INT', kind: 'analysis', weight: 0.6, ai: 'summary' },
  { id: 'euvsdisinfo', url: 'https://euvsdisinfo.eu/feed/', publisher: 'EUvsDisinfo', group: 'eu', lang: 'en', country: 'INT', kind: 'analysis', weight: 0.6, ai: 'summary' },
  { id: 'rebaltica-en', url: 'https://en.rebaltica.lv/feed/', publisher: 'Re:Baltica', group: 'rebaltica', lang: 'en', country: 'LV', kind: 'analysis', weight: 0.7, ai: 'summary' },

  // Official bodies. One country's ministries speak with one voice, hence the shared group.
  { id: 'cert-lv', url: 'https://cert.lv/lv/feed/rss/viss', publisher: 'CERT.LV', group: 'gov-lv', lang: 'lv', country: 'LV', native: true, ...OFFICIAL },
  { id: 'rs-lv', url: 'https://www.rs.gov.lv/lv/rss/articles', publisher: 'State Border Guard (LV)', group: 'gov-lv', lang: 'lv', country: 'LV', native: true, ...OFFICIAL },
  { id: 'mfa-lv-en', url: 'https://www.mfa.gov.lv/en/rss/articles', publisher: 'Foreign Ministry (LV)', group: 'gov-lv', lang: 'en', country: 'LV', ...OFFICIAL },
  { id: 'iem-lv', url: 'https://www.iem.gov.lv/lv/rss/articles', publisher: 'Interior Ministry (LV)', group: 'gov-lv', lang: 'lv', country: 'LV', native: true, ...OFFICIAL },
  { id: 'mod-ee-en', url: 'https://kaitseministeerium.ee/en/rss-feeds/rss.xml', publisher: 'Defence Ministry (EE)', group: 'gov-ee', lang: 'en', country: 'EE', ...OFFICIAL },
  { id: 'edf-et', url: 'https://mil.ee/feed/', publisher: 'Defence Forces (EE)', group: 'gov-ee', lang: 'et', country: 'EE', native: true, ...OFFICIAL },
  { id: 'ria-en', url: 'https://www.ria.ee/en/rss-feeds/rss.xml', publisher: 'RIA (EE)', group: 'gov-ee', lang: 'en', country: 'EE', links: ['https://ria.ee/'], ...OFFICIAL },
  { id: 'gov-ee-en', url: 'https://valitsus.ee/en/rss-feeds/rss.xml', publisher: 'Government (EE)', group: 'gov-ee', lang: 'en', country: 'EE', ...OFFICIAL },
  { id: 'mfa-ee-en', url: 'https://www.vm.ee/en/rss-feeds/rss.xml', publisher: 'Foreign Ministry (EE)', group: 'gov-ee', lang: 'en', country: 'EE', links: ['https://vm.ee/'], ...OFFICIAL },
  { id: 'vsat-lt', url: 'https://vsat.lrv.lt/lt/naujienos/rss/', publisher: 'State Border Guard (LT)', group: 'gov-lt', lang: 'lt', country: 'LT', native: true, ...OFFICIAL },
  { id: 'vrm-lt', url: 'https://vrm.lrv.lt/lt/naujienos/rss/', publisher: 'Interior Ministry (LT)', group: 'gov-lt', lang: 'lt', country: 'LT', native: true, ...OFFICIAL },
  { id: 'eu-council', url: 'https://www.consilium.europa.eu/en/rss/pressreleases.ashx', publisher: 'Council of the EU', group: 'eu', lang: 'en', country: 'INT', ...OFFICIAL },

  // Home-language news: faster than the English editions, and the only place some stories appear.
  { id: 'lsm-lv', url: 'https://www.lsm.lv/rss/?lang=lv&catid=14', publisher: 'LSM', group: 'lsm', lang: 'lv', country: 'LV', kind: 'media', weight: 0.9, ai: 'rate-only', native: true },
  { id: 'delfi-lv', url: 'https://www.delfi.lv/rss/index.xml', publisher: 'Delfi', group: 'delfi', lang: 'lv', country: 'LV', kind: 'media', weight: 0.75, ai: 'none', native: true },
  { id: 'err-et', url: 'https://www.err.ee/rss', publisher: 'ERR', group: 'err', lang: 'et', country: 'EE', kind: 'media', weight: 0.9, ai: 'rate-only', native: true, links: ['https://err.ee/'] },
  { id: 'lrt-lt', url: 'https://www.lrt.lt/naujienos/lietuvoje?rss', publisher: 'LRT', group: 'lrt', lang: 'lt', country: 'LT', kind: 'media', weight: 0.9, ai: 'none', native: true },
  { id: '15min', url: 'https://www.15min.lt/rss', publisher: '15min', group: '15min', lang: 'lt', country: 'LT', kind: 'media', weight: 0.75, ai: 'rate-only', native: true },
]

/** Official and analysis feeds publish a few items a day: asking them every half hour is plenty. */
const SLOW_FEED_MS = 30 * MINUTE
const WINDOW_MS = 72 * HOUR
/** The largest feed is under half a megabyte. */
const MAX_BYTES = 1024 * 1024
/** How many stories are served, and how many of those places go to the most important ones. */
const LIMIT = 150
const TOP = 110

/**
 * What each feed held the last time it answered, and when that was. Gone when the process stops,
 * which only costs one full round of requests on the next start.
 */
const lastRead = new Map<string, { at: number; items: RawNews[] }>()
/** The stories behind the last answer: a busy feed lets go of a story within hours, long before it stops mattering. */
let served: NewsEntry[] = []

/** Reads every feed that is due. One dead feed never sinks the panel; all of them dead is a failure. */
export async function readSources(http: Upstream, now: number): Promise<void> {
  const due = SOURCES.filter((source) => source.kind === 'media' || now - (lastRead.get(source.id)?.at ?? -Infinity) >= SLOW_FEED_MS)
  const results = await Promise.allSettled(
    due.map(async (source) => {
      const items = parseFeed(await http.text(source.url, { maxBytes: MAX_BYTES, timeoutMs: 12_000 }), source)
      // A challenge page or an error page served with a 200 is not a feed.
      if (items.length === 0) throw new UpstreamError('bad-body', `${new URL(source.url).host} did not send any stories`)
      lastRead.set(source.id, { at: now, items })
    }),
  )
  const failed = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
  if (failed.length === due.length) throw failed[0].reason
}

/** Every story the newsrooms still carry, unrated: what the politics page picks from. */
export function newsEntries(now: number): NewsEntry[] {
  return SOURCES.flatMap((source) =>
    (lastRead.get(source.id)?.items ?? []).filter((item) => now - item.at < WINDOW_MS).map((item) => ({ item, source })),
  )
}

/** The most important stories always make the list. What room is left goes to the newest of the rest. */
function pick(ranked: readonly NewsItem[]): NewsItem[] {
  const newest = ranked.slice(TOP).toSorted((a, b) => b.at - a.at).slice(0, LIMIT - TOP)
  const kept = new Set([...ranked.slice(0, TOP), ...newest])
  return ranked.filter((item) => kept.has(item))
}

/**
 * Headlines from the region's newsrooms and official bodies, each rated for importance and
 * escalation by rule (shared/adapters/news.ts). Titles, links and attribution only: descriptions
 * are read for scoring and kept on the server.
 */
export const newsFeed: FeedDef = {
  id: 'news',
  title: 'News',
  origins: [...new Set(SOURCES.map((source) => new URL(source.url).origin))],
  ttlMs: 10 * MINUTE,
  staleMs: 12 * HOUR,
  timeoutMs: 25_000,
  persist: true,
  attribution: SOURCES.filter((source, index) => SOURCES.findIndex((other) => other.publisher === source.publisher) === index).map(
    (source) => ({ label: source.publisher, href: linksOf(source)[0] }),
  ),
  async load({ http, now }) {
    await readSources(http, now)

    const recent = (item: RawNews) => now - item.at < WINDOW_MS
    const pool = new Map<string, NewsEntry>()
    for (const source of SOURCES) {
      for (const item of lastRead.get(source.id)?.items ?? []) {
        if (recent(item) && !pool.has(item.link)) pool.set(item.link, { item, source })
      }
    }
    // A story that has scrolled off the end of its feed is kept. One missing from the middle was withdrawn.
    for (const entry of served) {
      const oldest = Math.min(...(lastRead.get(entry.source.id)?.items ?? []).map((item) => item.at))
      if (recent(entry.item) && entry.item.at < oldest && !pool.has(entry.item.link)) pool.set(entry.item.link, entry)
    }

    const items = pick(rank([...pool.values()], now))
    served = items.map((item) => pool.get(item.link)!)
    setBlurbs(served.filter(({ item, source }) => source.ai !== 'none' && item.desc).map(({ item }) => [item.link, item.desc]))
    const sources = SOURCES.filter((source, index) => SOURCES.findIndex((other) => other.publisher === source.publisher) === index).map(
      ({ publisher, kind, country, ...source }) => ({ publisher, href: linksOf(source)[0], kind, country }),
    )
    return { shape: 'news', items, sources }
  },
  // Also turns away the copy an older build left on disk: its headlines carry no ratings, and the cache drops a copy that cannot be counted.
  count(payload) {
    if (payload.shape !== 'news' || payload.items.some((item) => !item.tags)) throw new Error('Not rated headlines')
    return payload.items.length
  },
}
