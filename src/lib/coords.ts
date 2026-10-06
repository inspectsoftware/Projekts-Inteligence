import { forward } from 'mgrs'

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
