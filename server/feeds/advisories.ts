import type { Advisory, AdvisoryLevel } from '../../shared/feeds'
import type { FeedDef } from './types'

const HOUR = 3600 * 1000
const GOV_UK = 'https://www.gov.uk'

interface Index {
  links: { children: { api_url: string; web_url: string; public_updated_at: string; details: { country: { name: string; slug: string } } }[] }
}

interface CountryPage {
  details: { alert_status?: string[]; change_description?: string }
}

/** The widest warning in force decides the level; a warning about part of a country ranks under one about all of it. */
export function advisoryLevel(status: readonly string[]): AdvisoryLevel {
  if (status.includes('avoid_all_travel_to_whole_country')) return 4
  if (status.includes('avoid_all_but_essential_travel_to_whole_country')) return 3
  if (status.includes('avoid_all_travel_to_parts')) return 2
  if (status.includes('avoid_all_but_essential_travel_to_parts')) return 1
  return 0
}

/** What each country's page said, by the time the page was last changed: an unchanged page is not asked for again. */
const read = new Map<string, Advisory>()

/**
 * How dangerous each country is, in the words of the UK Foreign Office's travel advice (Open
 * Government Licence). The index does not carry the warning itself, so each country's page is read
 * once and again only after it changes: some 230 requests on a cold start, a handful a day after.
 */
export const advisoriesFeed: FeedDef = {
  id: 'advisories',
  title: 'Travel advisories',
  origins: [GOV_UK],
  ttlMs: 6 * HOUR,
  staleMs: 7 * 24 * HOUR,
  timeoutMs: 120_000,
  persist: true,
  attribution: [{ label: 'FCDO travel advice (OGL v3.0)', href: `${GOV_UK}/foreign-travel-advice` }],
  async load({ http }) {
    const index = await http.json<Index>(`${GOV_UK}/api/content/foreign-travel-advice`)
    const pages = index.links.children
    const due = pages.filter((page) => read.get(page.details.country.slug)?.updatedAt !== Date.parse(page.public_updated_at))
    // Eight at a time: well under the ten requests a second the API allows.
    for (let start = 0; start < due.length; start += 8) {
      await Promise.allSettled(
        due.slice(start, start + 8).map(async (page) => {
          const { details } = await http.json<CountryPage>(page.api_url, { timeoutMs: 15_000 })
          const status = details.alert_status ?? []
          read.set(page.details.country.slug, {
            name: page.details.country.name,
            level: advisoryLevel(status),
            status,
            note: details.change_description ?? '',
            updatedAt: Date.parse(page.public_updated_at),
            href: page.web_url,
          })
        }),
      )
    }
    if (read.size === 0) throw new Error('No travel advice could be read')
    return { shape: 'advisories', countries: [...read.values()].sort((a, b) => b.level - a.level || a.name.localeCompare(b.name)) }
  },
}
