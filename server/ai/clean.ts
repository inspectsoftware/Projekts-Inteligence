/**
 * Whatever a model writes ends up on a public page, and what it read was other people's
 * headlines. So nothing it returns is trusted: text is cut down to plain words of a known
 * length, and numbers are forced into the range they are meant to have.
 */

const TAGS = /<[^>]*>/g
const LINKS = /\b(?:https?:\/\/|www\.)\S+/gi
// Control characters, and the invisible format characters that reorder or hide text.
const INVISIBLE = /[\p{Cc}\p{Cf}]/gu
const MARKUP = /[*_`#]/g

/** Plain text of at most `max` characters; an empty string for anything that is not text. */
export function plainText(value: unknown, max: number): string {
  if (typeof value !== 'string') return ''
  const text = value.replace(TAGS, ' ').replace(LINKS, ' ').replace(INVISIBLE, ' ').replace(MARKUP, '').replace(/\s+/g, ' ').trim()
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text
}

/** A whole number between `min` and `max`; `min` for anything that is not a number. */
export function clampInt(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, Math.round(value)))
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
