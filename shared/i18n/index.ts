import { et } from './et'
import { lt } from './lt'
import { lv } from './lv'
import { ru } from './ru'

export const LANGS = ['en', 'lv', 'lt', 'et', 'ru'] as const
export type Lang = (typeof LANGS)[number]

/** Each language under its own name, so a reader finds theirs whatever the page is showing. */
export const LANG_NAMES: Record<Lang, string> = { en: 'English', lv: 'Latviešu', lt: 'Lietuvių', et: 'Eesti', ru: 'Русский' }

/** For Intl date and number formats. */
export const LOCALES: Record<Lang, string> = { en: 'en-GB', lv: 'lv-LV', lt: 'lt-LT', et: 'et-EE', ru: 'ru-RU' }

const DICTS: Record<Exclude<Lang, 'en'>, Record<string, string>> = { lv, lt, et, ru }

export function isLang(value: unknown): value is Lang {
  return (LANGS as readonly unknown[]).includes(value)
}

/**
 * The English text is the key: the source reads as plain English, English needs no dictionary,
 * and a text nobody has translated yet simply stays English. `{name}` marks a value to fill in.
 */
export function translate(lang: Lang, text: string, vars?: Record<string, string | number>): string {
  // "dock::Layer" is "Layer" where it has to be short: the same English, its own translation.
  const found = (lang === 'en' ? text : (DICTS[lang][text] ?? text)).replace(/^\w+::/, '')
  return vars ? found.replace(/\{(\w+)\}/g, (whole, name: string) => String(vars[name] ?? whole)) : found
}

/**
 * Marks an English text in a data table as one to translate, without translating it there:
 * whoever shows it calls t() on the value. The mark is what puts it on the translators' list.
 */
export const msg = (text: string): string => text
