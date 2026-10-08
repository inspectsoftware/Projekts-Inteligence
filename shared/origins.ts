/**
 * Every third-party origin the browser talks to directly. The map style and the
 * Content-Security-Policy are both built from this list, so they cannot drift apart.
 */
export const TILE_ORIGINS = {
  /** Vector basemap, glyphs. */
  openFreeMap: 'https://tiles.openfreemap.org',
  /** Sentinel-2 cloudless imagery. */
  eox: 'https://tiles.maps.eox.at',
  /** National orthophotos laid over it at street zoom: Latvia (LVM GEO) and Estonia. */
  lvmGeo: 'https://geoserver.lvmgeo.lv',
  maaamet: 'https://tiles.maaamet.ee',
  /** Open national orthophotos elsewhere: USA, Japan, Spain, France, the Netherlands, Luxembourg, Switzerland, Austria, Czechia, Poland. */
  usgs: 'https://basemap.nationalmap.gov',
  gsiJapan: 'https://cyberjapandata.gsi.go.jp',
  ignSpain: 'https://www.ign.es',
  ignFrance: 'https://data.geopf.fr',
  pdok: 'https://service.pdok.nl',
  geoportailLu: 'https://wmts1.geoportail.lu',
  swisstopo: 'https://wmts.geo.admin.ch',
  basemapAt: 'https://mapsneu.wien.gv.at',
  cuzk: 'https://ags.cuzk.gov.cz',
  geoportalPl: 'https://mapy.geoportal.gov.pl',
  /** NASA GIBS daily imagery and night lights. */
  gibs: 'https://gibs.earthdata.nasa.gov',
  /** Ground elevation for the 3D relief. */
  mapterhorn: 'https://tiles.mapterhorn.com',
  /** RainViewer: the list of radar scans, and the radar tiles themselves. */
  rainViewerApi: 'https://api.rainviewer.com',
  rainViewerTiles: 'https://tilecache.rainviewer.com',
} as const

export const RADAR_INDEX_URL = `${TILE_ORIGINS.rainViewerApi}/public/weather-maps.json`

/**
 * Lithuania's orthophoto service asks, in its own metadata, to be told by email
 * (pagalba@geoportal.lt) before it is used in another system. Nobody has written yet, so the
 * layer is built but switched off. Set this to true once they have been written to: the tiles,
 * the credit, the Display text and the origin's place in the policy all follow from it.
 */
export const LITHUANIA_ENABLED: boolean = false

export const LITHUANIA_ORIGIN = 'https://www.geoportal.lt'

export const BROWSER_ORIGINS: readonly string[] = [...Object.values(TILE_ORIGINS), ...(LITHUANIA_ENABLED ? [LITHUANIA_ORIGIN] : [])]

/** Players the page may embed in an iframe (live television, live cameras). */
export const FRAME_ORIGINS: readonly string[] = [
  // Live cameras: YouTube without cookies until play, and the player Kuldīga's own site embeds.
  'https://www.youtube-nocookie.com',
  'https://cdn.tiesraides.lv',
  // Live television: LRT's own embed pages. The channels on YouTube use the player listed above.
  'https://www.lrt.lt',
]

/**
 * Hosts a <video> may stream from. An HLS player fetches the playlist and segments itself,
 * so these are allowed for fetch() as well as for media.
 */
export const MEDIA_ORIGINS: readonly string[] = [
  // Live cameras: Freeport of Riga, Tallinn TV tower, Ventspils (answers on this port only),
  // ipcamlive's numbered stream hosts (Cēsis, Saulkrasti), Alūksne.
  'https://rop.lv',
  'https://sv.levira.com',
  'https://vstreams.ventspils.lv:8080',
  'https://*.ipcamlive.com',
  'https://skats.aluksne.lv:8125',
  // Live television: the Riigikogu chamber stream, whose address redirects to a numbered node.
  'https://*.euddn.net',
]

/** Hosts whose pictures are shown straight from the source (camera stills, video posters). */
export const IMAGE_ORIGINS: readonly string[] = [
  // Live cameras: stills and posters their publishers let another site's page show.
  'https://webcam.riga.lv',
  'https://www.siguldassports.lv',
  'https://www.madona.lv',
  'https://vstreams.ventspils.lv:8080',
  'https://*.ipcamlive.com',
  'https://i.ytimg.com',
  'https://app.levira.com',
  'https://ristmikud.tallinn.ee',
  'https://eismoinfo.lt',
]

export interface Attribution {
  label: string
  href: string
}

export const BASEMAP_ATTRIBUTION: readonly Attribution[] = [
  { label: 'OpenFreeMap', href: 'https://openfreemap.org' },
  { label: '© OpenMapTiles', href: 'https://www.openmaptiles.org/' },
  { label: '© OpenStreetMap contributors', href: 'https://www.openstreetmap.org/copyright' },
]
