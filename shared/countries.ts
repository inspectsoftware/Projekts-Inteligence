/** The three the site is about first, then the neighbours shown for context. */
export const COUNTRY_CODES = ['LV', 'LT', 'EE', 'FI', 'SE', 'PL', 'DE', 'RU', 'BY'] as const
export type CountryCode = (typeof COUNTRY_CODES)[number]

/** One sourced figure or name. */
export interface CountryFact {
  key: string
  label: string
  value: string | number
  unit: string | null
  /** The year the value is for. NATO's estimates carry a trailing "e" ("2026e"). */
  year: number | string
  source: string
  url: string
  /** Place in the index's ranking, for the two indices that have one. */
  rank?: number
}

/** A sourced note on the armed forces: structure, equipment, allied units. */
export interface ForceNote {
  label: string
  text: string
  /** ISO date of the page cited, or of the day it was read. */
  asOf: string
  url: string
}

export interface CountryProfile {
  name: string
  iso3: string
  /** The country and its economy. */
  facts: CountryFact[]
  /** Defence money and headcount. */
  defence: CountryFact[]
  forces: ForceNote[]
}

/** shared/data/countries.json: collected by hand from the sources it cites, and refreshed by hand. */
export interface CountryFile {
  /** ISO timestamp of the collection. */
  generatedAt: string
  note: string
  countries: Record<string, CountryProfile>
}

/** As precise as the sources are: an index score has three decimals. */
const number = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 3 })
const rounded = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 })
const MONEY: Record<string, string> = { USD: 'US$', EUR: '€', 'intl $': 'Int$' }

function money(sign: string, value: number): string {
  const size = Math.abs(value)
  if (size >= 1e12) return `${sign}${rounded.format(value / 1e12)} trn`
  if (size >= 1e9) return `${sign}${rounded.format(value / 1e9)} bn`
  if (size >= 1e6) return `${sign}${rounded.format(value / 1e6)} m`
  return `${sign}${rounded.format(value)}`
}

/** A fact's value as text, with its unit: "1,847,785", "€2.16 bn", "4.92% of GDP". */
export function formatFact({ value, unit }: CountryFact): string {
  if (typeof value === 'string') return value
  if (!unit || unit === 'people' || unit === 'index' || unit === 'score') return number.format(value)
  if (unit in MONEY) return money(MONEY[unit], value)
  if (unit === 'km2') return `${number.format(value)} km²`
  return unit.startsWith('%') ? `${number.format(value)}${unit}` : `${number.format(value)} ${unit}`
}

/** "2025", or "2026 est." for one of NATO's estimates. */
export function formatYear(year: number | string): string {
  const text = String(year)
  return text.endsWith('e') ? `${text.slice(0, -1)} est.` : text
}
