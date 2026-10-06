/**
 * Keeps the camera in the address bar as `#map=zoom/lat/lon[/bearing[/pitch]]`, so a
 * view can be shared as a link. Done here rather than with the map library's own
 * option, which erases the fragment whenever a map instance is torn down.
 */
export interface UrlView {
  center: [number, number]
  zoom: number
  bearing: number
  pitch: number
}

const PATTERN = /(?:^#|&)map=([-\d.]+)\/([-\d.]+)\/([-\d.]+)(?:\/([-\d.]+))?(?:\/([-\d.]+))?/

export function parseUrlView(hash: string): UrlView | null {
  const match = hash.match(PATTERN)
  if (!match) return null
  const [zoom, lat, lon, bearing, pitch] = match.slice(1).map((part) => (part === undefined ? 0 : Number(part)))
  if (![zoom, lat, lon, bearing, pitch].every(Number.isFinite)) return null
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180 || zoom < 0 || zoom > 24) return null
  return { center: [lon, lat], zoom, bearing, pitch: Math.min(Math.max(pitch, 0), 85) }
}

export function formatUrlView(view: UrlView): string {
  const [lon, lat] = view.center
  // Enough digits to land on the same street; more would only make the link longer.
  const parts = [view.zoom.toFixed(2), lat.toFixed(4), lon.toFixed(4)]
  const bearing = Math.round(view.bearing)
  const pitch = Math.round(view.pitch)
  if (bearing !== 0 || pitch !== 0) parts.push(String(bearing))
  if (pitch !== 0) parts.push(String(pitch))
  return `#map=${parts.join('/')}`
}

export function readUrlView(): UrlView | null {
  return parseUrlView(window.location.hash)
}

export function writeUrlView(view: UrlView): void {
  const next = formatUrlView(view)
  if (next === window.location.hash) return
  // replaceState: panning the map should not fill the browser's back history.
  window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}${next}`)
}
