/**
 * Every third-party origin the browser talks to directly. The map style and the
 * Content-Security-Policy are both built from this list, so they cannot drift apart.
 */
export const TILE_ORIGINS = {
  /** Vector basemap, glyphs. */
  openFreeMap: 'https://tiles.openfreemap.org',
  /** Sentinel-2 cloudless imagery. */
  eox: 'https://tiles.maps.eox.at',
  /** NASA GIBS daily imagery and night lights. */
  gibs: 'https://gibs.earthdata.nasa.gov',
  /** RainViewer: the list of radar scans, and the radar tiles themselves. */
  rainViewerApi: 'https://api.rainviewer.com',
  rainViewerTiles: 'https://tilecache.rainviewer.com',
} as const

export const RADAR_INDEX_URL = `${TILE_ORIGINS.rainViewerApi}/public/weather-maps.json`

export const BROWSER_ORIGINS: readonly string[] = Object.values(TILE_ORIGINS)

export interface Attribution {
  label: string
  href: string
}

export const BASEMAP_ATTRIBUTION: readonly Attribution[] = [
  { label: 'OpenFreeMap', href: 'https://openfreemap.org' },
  { label: '© OpenMapTiles', href: 'https://www.openmaptiles.org/' },
  { label: '© OpenStreetMap contributors', href: 'https://www.openstreetmap.org/copyright' },
]
