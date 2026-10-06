const integer = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 })

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
  if (seconds < 90) return `${seconds} s ago`
  const minutes = Math.round(seconds / 60)
  if (minutes < 90) return `${minutes} min ago`
  return `${Math.round(minutes / 60)} h ago`
}
