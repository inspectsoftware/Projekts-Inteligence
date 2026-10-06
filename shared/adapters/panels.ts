import type { EnergySnapshot, InternetSignal, NewsItem } from '../feeds'

// ---- Power system (energy-charts.info, Fraunhofer ISE, from ENTSO-E data) --------------------

/** One energy-charts time series answer: a time axis and named columns of the same length. */
export interface ChartSeries {
  unix_seconds?: number[]
  production_types?: { name: string; data: (number | null)[] }[]
  countries?: { name: string; data: (number | null)[] }[]
  price?: (number | null)[]
}

/** Columns of the power answer that are not a source of generation. */
const NOT_A_SOURCE = /^(Load|Residual load|Renewable share|Cross border)/

const lastKnown = (data: readonly (number | null)[]) => data.findLastIndex((value) => value !== null)

/** Any of the three answers may be missing: whatever arrived is reported, the rest stays empty. */
export function normaliseEnergy(
  power: ChartSeries | null,
  flows: ChartSeries | null,
  prices: ChartSeries | null,
  now: number,
): EnergySnapshot {
  const columns = power?.production_types ?? []
  // The newest hour for which the load is known; the other columns are read at that same hour.
  const hour = lastKnown(columns.find((column) => column.name === 'Load')?.data ?? [])
  const at = (name: string) => columns.find((column) => column.name === name)?.data[hour] ?? null
  const mix = columns.flatMap((column) => {
    const mw = column.data[hour]
    return NOT_A_SOURCE.test(column.name) || !mw || mw <= 0 ? [] : [{ source: column.name, mw }]
  })

  const times = prices?.unix_seconds ?? []
  const amounts = (prices?.price ?? []).filter((price): price is number => price !== null)
  return {
    at: hour >= 0 ? (power?.unix_seconds?.[hour] ?? 0) * 1000 : null,
    loadMw: at('Load'),
    generationMw: mix.length ? mix.reduce((sum, part) => sum + part.mw, 0) : null,
    importMw: at('Cross border electricity trading'),
    mix: mix.sort((a, b) => b.mw - a.mw),
    // Flows come in gigawatts, each neighbour with its own newest value.
    flows: (flows?.countries ?? []).flatMap((country) => {
      const gw = country.data[lastKnown(country.data)]
      return country.name === 'sum' || gw === null || gw === undefined ? [] : [{ country: country.name, mw: Math.round(gw * 1000) }]
    }),
    price: {
      now: prices?.price?.[times.findLastIndex((seconds) => seconds * 1000 <= now)] ?? null,
      low: amounts.length ? Math.min(...amounts) : null,
      high: amounts.length ? Math.max(...amounts) : null,
    },
  }
}

// ---- Internet reachability (IODA, Georgia Tech) ------------------------------------------

export interface IodaSignals {
  data?: unknown[]
}

/** The two IODA measures that are plain counts and steady enough to compare with their own median. */
const SIGNALS: Record<string, string> = {
  bgp: 'Networks announced (BGP)',
  'ping-slash24': 'Networks answering probes',
}

export function normaliseInternet(ioda: IodaSignals): InternetSignal[] {
  const series = (ioda.data ?? []).flat(2) as { datasource?: string; values?: unknown[] }[]
  return series.flatMap((one) => {
    const label = SIGNALS[one.datasource ?? '']
    const values = (one.values ?? []).filter((value): value is number => typeof value === 'number')
    if (!label || values.length < 6) return []
    const baseline = values.toSorted((a, b) => a - b)[values.length >> 1]
    return [{ id: one.datasource!, label, latest: values[values.length - 1], baseline }]
  })
}

// ---- News headlines (RSS) -----------------------------------------------------------------

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

/** Feed text as plain text: no markup survives, so nothing from a feed is ever rendered as HTML. */
function plain(xml: string | undefined): string {
  return (xml ?? '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x?[0-9a-f]+|\w+);/gi, (whole, name: string) =>
      name[0] === '#'
        ? String.fromCodePoint(name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1)))
        : (ENTITIES[name] ?? whole),
    )
    .replace(/\s+/g, ' ')
    .trim()
}

/** Headlines with links, newest first. A link is only kept if it leads to the site the feed came from. */
export function parseRss(xml: string, site: string, limit = 12): NewsItem[] {
  const items: NewsItem[] = []
  for (const [, item] of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const field = (name: string) => plain(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`).exec(item)?.[1])
    const title = field('title')
    // Tracking parameters add nothing for the reader.
    const link = field('link').split('?')[0]
    const at = Date.parse(field('pubDate'))
    if (title && link.startsWith(site) && Number.isFinite(at)) items.push({ title, link, at })
  }
  return items.sort((a, b) => b.at - a.at).slice(0, limit)
}
