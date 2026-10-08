import { forward, toPoint } from 'mgrs'

/** "35V LD 23939 15504": grid zone, 100 km square, then easting and northing in metres. */
export function formatMgrs(lon: number, lat: number): string {
  // MGRS is only defined between 80°S and 84°N.
  if (lat < -80 || lat > 84) return '—'
  const raw = forward([lon, lat], 5)
  const split = raw.length - 10
  return `${raw.slice(0, split - 2)} ${raw.slice(split - 2, split)} ${raw.slice(split, split + 5)} ${raw.slice(split + 5)}`
}

export function formatLat(lat: number): string {
  return `${Math.abs(lat).toFixed(5)}° ${lat >= 0 ? 'N' : 'S'}`
}

export function formatLon(lon: number): string {
  return `${Math.abs(lon).toFixed(5).padStart(9, '0')}° ${lon >= 0 ? 'E' : 'W'}`
}

// One half of a position: degrees, then minutes and seconds only where their marks say so, with
// the hemisphere letter before or after.
const HALF = String.raw`([NSEW])?\s*(-?\d+(?:\.\d+)?)\s*°?\s*(?:(\d+(?:\.\d+)?)\s*['′]\s*)?(?:(\d+(?:\.\d+)?)\s*(?:"|″|'')\s*)?([NSEW])?`
const POSITION = new RegExp(`^${HALF}[\\s,;/]+${HALF}$`)
const MGRS = /^\d{1,2}[C-X][A-Z]{2}(\d\d)+$/

function halfValue(deg: string, min: string | undefined, sec: string | undefined, hemisphere: string | undefined): number | null {
  const minutes = Number(min ?? 0)
  const seconds = Number(sec ?? 0)
  if (minutes >= 60 || seconds >= 60) return null
  const size = Math.abs(Number(deg)) + minutes / 60 + seconds / 3600
  return deg.startsWith('-') || hemisphere === 'S' || hemisphere === 'W' ? -size : size
}

/**
 * A position somebody typed, as [lon, lat]: "56.95, 24.1", "56.95N 24.1E", "56°56'58.6"N 24°06'18.7"E"
 * or an MGRS reference. Latitude comes first unless the hemisphere letters say otherwise.
 */
export function parseCoords(text: string): [number, number] | null {
  const typed = text.trim().toUpperCase()
  const grid = typed.replace(/\s+/g, '')
  if (MGRS.test(grid)) {
    try {
      const [lon, lat] = toPoint(grid)
      return Number.isFinite(lon) && Number.isFinite(lat) ? [lon, lat] : null
    } catch {
      return null
    }
  }
  const match = typed.match(POSITION)
  if (!match) return null
  const [, a1, aDeg, aMin, aSec, a2, b1, bDeg, bMin, bSec, b2] = match
  const first = halfValue(aDeg, aMin, aSec, a1 ?? a2)
  const second = halfValue(bDeg, bMin, bSec, b1 ?? b2)
  if (first === null || second === null) return null
  const lonFirst = /[EW]/.test(a1 ?? a2 ?? '') && !/[EW]/.test(b1 ?? b2 ?? '')
  const [lat, lon] = lonFirst ? [second, first] : [first, second]
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? [lon, lat] : null
}

/** Ground distance covered by one CSS pixel. MapLibre's zoom 0 is one 512 px tile for the world. */
export function metresPerPixel(lat: number, zoom: number): number {
  return (78271.51696 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom
}

/** Largest round distance (1, 2 or 5 times a power of ten) that fits in maxPx. */
export function scaleBar(lat: number, zoom: number, maxPx = 110): { px: number; label: string } {
  const mpp = metresPerPixel(lat, zoom)
  const maxMetres = mpp * maxPx
  const magnitude = 10 ** Math.floor(Math.log10(maxMetres))
  const step = [5, 2, 1].find((s) => s * magnitude <= maxMetres) ?? 1
  const metres = step * magnitude
  return { px: metres / mpp, label: metres >= 1000 ? `${metres / 1000} km` : `${metres} m` }
}
