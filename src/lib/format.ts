import { locale, t } from '../i18n'

const integer = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 })

export function formatInt(value: number): string {
  return integer.format(Math.round(value))
}

/** "021°" */
export function formatBearing(degrees: number): string {
  return `${Math.round(((degrees % 360) + 360) % 360)
    .toString()
    .padStart(3, '0')}°`
}

/** "4 s ago", "3 min ago" */
export function formatAge(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 90) return t('{n} s ago', { n: seconds })
  const minutes = Math.round(seconds / 60)
  if (minutes < 90) return t('{n} min ago', { n: minutes })
  return t('{n} h ago', { n: Math.round(minutes / 60) })
}
