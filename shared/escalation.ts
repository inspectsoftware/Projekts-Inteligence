import type { EscalationLevel, NewsItem } from './feeds'

/** What each escalation level is called, by level. Kept apart from the scorer's word lists, which the browser has no use for. */
export const LEVEL_NAMES = ['Routine', 'Posture', 'Hybrid pressure', 'Serious incident', 'Crisis', 'Armed attack'] as const

/**
 * Hours, by level: how long a story takes to lose half its importance, and also how long it goes
 * on counting towards the region's level. An exercise is old news the same day; a cut cable is not.
 */
export const HALF_LIFE_H = [6, 12, 24, 48, 72, 168] as const

const HOUR = 3600 * 1000

/**
 * The level a list of rated stories puts the region at, or one country when `country` is given:
 * the highest level among the stories still live. A level of 3 or more also needs a second
 * publisher behind it, because one headline alone can be wrong, mistranslated or planted;
 * without that backing the reading stops at 2.
 */
export function regionLevel(items: readonly NewsItem[], now: number, country?: string): EscalationLevel {
  const live = items.filter((item) => now - item.at <= HALF_LIFE_H[item.escalation] * HOUR && (!country || item.countries.includes(country)))
  const top = Math.max(0, ...live.map((item) => item.escalation))
  for (let level = top; level >= 3; level--) {
    const reports = live.filter((item) => item.escalation >= level)
    if (reports.some((item) => item.corroboration > 0) || new Set(reports.map((item) => item.publisher)).size > 1) return level as EscalationLevel
  }
  return Math.min(top, 2) as EscalationLevel
}
