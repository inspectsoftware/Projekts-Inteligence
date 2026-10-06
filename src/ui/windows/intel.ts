import { useSyncExternalStore } from 'react'
import { regionLevel } from '../../../shared/escalation'
import type { EscalationLevel, IntelBrief, NewsItem } from '../../../shared/feeds'
import { serverNow } from '../../runtime/clock'
import { getPayload, subscribeEntities } from '../../runtime/entityStore'
import type { IntelCountry, IntelSort } from '../../state/intel'
import type { WindowBadge } from './registry'

/** A headline as shown: with the language model's one-line summary, where it wrote one. */
export interface Row extends NewsItem {
  summary?: string
}

/**
 * The list as the window shows it. A rating from the brief replaces the rule score of its
 * headline before anything is filtered or ordered, so a story the model thinks little of sinks
 * and drops out like any other.
 */
export function rowsFor(
  items: readonly NewsItem[],
  ratings: IntelBrief['ratings'] | undefined,
  { sort, country, minLevel }: { sort: IntelSort; country: IntelCountry; minLevel: EscalationLevel },
): Row[] {
  return items
    .map((item): Row => ({ ...item, ...ratings?.[item.link] }))
    .filter((row) => row.escalation >= minLevel && (country === 'all' || row.countries.includes(country)))
    .sort((a, b) => (sort === 'latest' ? b.at - a.at : b.importance - a.importance || b.at - a.at))
}

/**
 * The headlines a key point of the brief rests on, as far as they are still on the list. A link
 * the list does not know is not shown: only the list's links are known to lead to a publisher.
 */
export const sourcesOf = (links: readonly string[], items: readonly NewsItem[]): NewsItem[] => items.filter((item) => links.includes(item.link))

/** The region's level: the brief's once one has arrived, until then the headlines' own. Null with neither. */
function currentLevel(): EscalationLevel | null {
  const brief = getPayload('brief', 'brief')
  if (brief) return brief.level
  const news = getPayload('news', 'news')
  return news ? regionLevel(news.items, serverNow()) : null
}

/**
 * The level on the Intel feed's dock button. It reads what the open window has fetched and starts
 * no polling of its own, so there is no badge while the window is closed.
 */
export function useIntelBadge(): WindowBadge | null {
  const level = useSyncExternalStore(subscribeEntities, currentLevel)
  return level === null ? null : { text: `L${level}`, tone: level >= 3 ? 'danger' : level === 2 ? 'warn' : 'info' }
}
