/** Mean Earth radius in metres. */
const R = 6_371_008.8
const RAD = Math.PI / 180

/** Great-circle distance in metres. */
export function haversine(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const dLat = (lat2 - lat1) * RAD
  const dLon = (lon2 - lon1) * RAD
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)))
}

/** Initial compass bearing from the first point to the second, degrees true (0 to 360). */
export function bearing(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const y = Math.sin((lon2 - lon1) * RAD) * Math.cos(lat2 * RAD)
  const x =
    Math.cos(lat1 * RAD) * Math.sin(lat2 * RAD) -
    Math.sin(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.cos((lon2 - lon1) * RAD)
  return (Math.atan2(y, x) / RAD + 360) % 360
}

/**
 * Where something ends up after moving `metres` along `bearing` (degrees true).
 * Flat-earth step: accurate to well under a metre for the few kilometres an
 * aircraft covers between two polls, and far cheaper than the spherical formula.
 */
export function advance(lon: number, lat: number, bearing: number, metres: number): [number, number] {
  const b = bearing * RAD
  const dLat = (metres * Math.cos(b)) / R
  const dLon = (metres * Math.sin(b)) / (R * Math.cos(lat * RAD))
  return [lon + dLon / RAD, lat + dLat / RAD]
}
