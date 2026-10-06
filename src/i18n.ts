import { type Lang, LANGS, LOCALES, isLang, translate } from '../shared/i18n'

const KEY = 'pwh-lang'

function initial(): Lang {
  // No page (tests under node): English, whatever language the machine itself is set to.
  if (typeof document === 'undefined') return 'en'
  try {
    const stored = localStorage.getItem(KEY)
    if (isLang(stored)) return stored
  } catch {
    // Storage can be switched off; the browser's own language is the next best guess.
  }
  const browser = navigator.language.slice(0, 2).toLowerCase()
  return LANGS.find((code) => code === browser) ?? 'en'
}

/** Fixed for the life of the page: changing it reloads, so nothing has to re-render mid-flight. */
export const lang: Lang = initial()
export const locale = LOCALES[lang]
if (typeof document !== 'undefined') document.documentElement.lang = lang

/** The text in the reader's language. Write the English in full: `t('Close')`, `t('{n} aircraft', { n })`. */
export const t = (text: string, vars?: Record<string, string | number>): string => translate(lang, text, vars)

export function setLang(next: Lang): void {
  try {
    localStorage.setItem(KEY, next)
  } catch {
    return
  }
  window.location.reload()
}
