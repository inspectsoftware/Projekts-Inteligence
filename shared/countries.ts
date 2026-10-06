import { msg, translate } from './i18n'

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

/** How a text is put into the reader's language. English is the key, so English needs nothing done. */
type Tr = (text: string, vars?: Record<string, string | number>) => string
const english: Tr = (text, vars) => translate('en', text, vars)

/**
 * The labels the fact file uses for more than one country, and the units that are words, for the
 * translators: whoever shows a label or a unit translates it there. A label written for one
 * country alone (a budget "adopted by Saeima 2025-12-04", a named unit) stays as the file has it.
 */
export const FACT_WORDS = [
  msg('Capital'),
  msg('Head of state'),
  msg('Head of government'),
  msg('Currency'),
  msg('Official language(s)'),
  msg('Borders (ISO codes)'),
  msg('Population'),
  msg('Population on 1 January'),
  msg('Surface area'),
  msg('Population growth'),
  msg('Population aged 65+'),
  msg('Urban population'),
  msg('Fertility rate'),
  msg('Life expectancy at birth'),
  msg('GDP (current US$)'),
  msg('GDP per capita (current US$)'),
  msg('GDP per capita, PPP'),
  msg('Real GDP growth'),
  msg('Real GDP growth forecast'),
  msg('Inflation, consumer prices'),
  msg('Inflation forecast'),
  msg('Unemployment (ILO modelled)'),
  msg('General government gross debt'),
  msg('General government net lending/borrowing'),
  msg('Exports of goods and services'),
  msg('Current account balance'),
  msg('Gini index'),
  msg('Energy imports, net'),
  msg('Energy import dependency'),
  msg('Renewables in gross final energy consumption (provisional)'),
  msg('Individuals using the Internet'),
  msg('Corruption Perceptions Index (0-100, higher = cleaner)'),
  msg('Global Peace Index (lower = more peaceful)'),
  msg('Defence budget (national)'),
  msg('Defence expenditure (national, NATO criteria)'),
  msg('Core defence expenditure'),
  msg('Core defence expenditure (current prices)'),
  msg('Core defence expenditure per capita (2021 prices)'),
  msg('Annual real change in core defence expenditure'),
  msg('Equipment share of core defence expenditure'),
  msg('Personnel share of core defence expenditure'),
  msg('Infrastructure share of core defence expenditure'),
  msg('Military personnel (peacetime strength)'),
  msg('Military expenditure'),
  msg('Military expenditure (current US$)'),
  msg('Military expenditure (World Bank series, older SIPRI vintage)'),
  msg('Armed forces personnel incl. paramilitary (stale)'),
  // Notes on the armed forces.
  msg('Structure'),
  msg('Wartime structure'),
  msg('Peacetime strength (NATO count)'),
  msg('Conscription'),
  msg('Latest conscript intake'),
  msg('Budget priorities'),
  msg('Tanks'),
  msg('Infantry fighting vehicles'),
  msg('Armoured personnel carriers'),
  msg('Artillery'),
  msg('Long-range fires'),
  msg('Air defence'),
  msg('Air defence and artillery'),
  msg('Coastal defence'),
  msg('Helicopters'),
  // Units.
  msg('% per year'),
  msg('% of population'),
  msg('% of labour force'),
  msg('% of GDP'),
  msg('% of energy use'),
  msg('births per woman'),
  msg('years'),
] as const

/** As precise as the sources are: an index score has three decimals. */
const number = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 3 })
const rounded = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 })
const MONEY: Record<string, string> = { USD: 'US$', EUR: '€', 'intl $': 'Int$' }

function money(sign: string, value: number, tr: Tr): string {
  const size = Math.abs(value)
  if (size >= 1e12) return tr('{amount} trn', { amount: `${sign}${rounded.format(value / 1e12)}` })
  if (size >= 1e9) return tr('{amount} bn', { amount: `${sign}${rounded.format(value / 1e9)}` })
  if (size >= 1e6) return tr('{amount} m', { amount: `${sign}${rounded.format(value / 1e6)}` })
  return `${sign}${rounded.format(value)}`
}

/**
 * A fact's value as text, with its unit: "1,847,785", "€2.16 bn", "4.92% of GDP". The words are
 * translated; the digits are written the one way in every language, so that a figure in a brief
 * can be checked against the fact it came from.
 */
export function formatFact({ value, unit }: CountryFact, tr: Tr = english): string {
  if (typeof value === 'string') return value
  if (!unit || unit === 'people' || unit === 'index' || unit === 'score') return number.format(value)
  if (unit in MONEY) return money(MONEY[unit], value, tr)
  if (unit === 'km2') return `${number.format(value)} km²`
  return unit.startsWith('%') ? `${number.format(value)}${tr(unit)}` : `${number.format(value)} ${tr(unit)}`
}

/** "2025", or "2026 est." for one of NATO's estimates. */
export function formatYear(year: number | string, tr: Tr = english): string {
  const text = String(year)
  return text.endsWith('e') ? tr('{year} est.', { year: text.slice(0, -1) }) : text
}
