import type { OrbitalElement, SatGroup } from '../feeds'

const NUMERIC = [
  'MEAN_MOTION',
  'ECCENTRICITY',
  'INCLINATION',
  'RA_OF_ASC_NODE',
  'ARG_OF_PERICENTER',
  'MEAN_ANOMALY',
  'NORAD_CAT_ID',
  'ELEMENT_SET_NO',
  'BSTAR',
  'MEAN_MOTION_DOT',
  'MEAN_MOTION_DDOT',
] as const

/**
 * Keeps the fields SGP4 needs from one CelesTrak group and tags each record with the
 * group. Records that are incomplete are dropped rather than passed on to the browser.
 */
export function normaliseElements(raw: unknown, group: SatGroup): OrbitalElement[] {
  if (!Array.isArray(raw)) return []
  const out: OrbitalElement[] = []

  for (const item of raw as Record<string, unknown>[]) {
    if (typeof item?.OBJECT_NAME !== 'string' || typeof item.EPOCH !== 'string') continue
    const numbers = {} as Record<(typeof NUMERIC)[number], number>
    let complete = true
    for (const key of NUMERIC) {
      const value = Number(item[key])
      if (!Number.isFinite(value)) {
        complete = false
        break
      }
      numbers[key] = value
    }
    if (!complete) continue

    out.push({
      OBJECT_NAME: item.OBJECT_NAME.trim(),
      OBJECT_ID: typeof item.OBJECT_ID === 'string' ? item.OBJECT_ID : '',
      EPOCH: item.EPOCH,
      ...numbers,
      GROUP: group,
    })
  }
  return out
}

/** A satellite listed in two groups is kept once, under the group listed first. */
export function mergeElements(groups: readonly OrbitalElement[][]): OrbitalElement[] {
  const byId = new Map<number, OrbitalElement>()
  for (const group of groups) {
    for (const sat of group) if (!byId.has(sat.NORAD_CAT_ID)) byId.set(sat.NORAD_CAT_ID, sat)
  }
  return [...byId.values()]
}
