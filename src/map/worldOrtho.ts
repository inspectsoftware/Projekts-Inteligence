import type { AddProtocolAction } from 'maplibre-gl'
import { TILE_ORIGINS } from '../../shared/origins'
import type { RasterSource } from './basemaps'

/**
 * Air photos that countries outside the Baltic publish openly, without a key. Each service answers
 * differently beyond its own border: some with 404, some with a blank white or black tile. So their
 * tiles come through one protocol that turns both into nothing, and the satellite mosaic shows there.
 * ponytail: a tile that is half photo and half blank is passed on whole, which leaves pale wedges
 * along a border. Cut them to an outline as Latvia's are (orthoClip.ts) if that matters.
 */
export const WORLD_SCHEME = 'ortho'

interface WorldOrtho {
  id: string
  /** Tile address for level z, column x, row y. */
  url(z: number, x: number, y: number): string
  maxzoom: number
  bounds: [number, number, number, number]
  label: string
  href: string
}

const wmts = (base: string, layer: string, set: string, matrix = '') => (z: number, x: number, y: number) =>
  `${base}?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=${layer}&STYLE=${layer === 'ORTHOIMAGERY.ORTHOPHOTOS' ? 'normal' : 'default'}&TILEMATRIXSET=${set}&TILEMATRIX=${matrix}${z}&TILEROW=${y}&TILECOL=${x}&FORMAT=image/jpeg`

const O = TILE_ORIGINS

/** Drawn in this order, so where two overlap at a border the later one lies on top. */
export const WORLD_ORTHOS: readonly WorldOrtho[] = [
  { id: 'us', url: (z, x, y) => `${O.usgs}/arcgis/rest/services/USGSImageryOnly/MapServer/tile/${z}/${y}/${x}`, maxzoom: 16, bounds: [-125, 24.3, -66.8, 49.5], label: 'USGS The National Map: Imagery', href: 'https://www.usgs.gov/programs/national-geospatial-program/national-map' },
  { id: 'jp', url: (z, x, y) => `${O.gsiJapan}/xyz/seamlessphoto/${z}/${x}/${y}.jpg`, maxzoom: 18, bounds: [122.9, 24, 146, 45.6], label: 'Geospatial Information Authority of Japan', href: 'https://maps.gsi.go.jp/development/ichiran.html' },
  { id: 'es', url: wmts(`${O.ignSpain}/wmts/pnoa-ma`, 'OI.OrthoimageCoverage', 'GoogleMapsCompatible'), maxzoom: 19, bounds: [-9.4, 35.9, 4.4, 43.9], label: 'PNOA © Instituto Geográfico Nacional de España (CC BY 4.0)', href: 'https://pnoa.ign.es' },
  { id: 'fr', url: wmts(`${O.ignFrance}/wmts`, 'ORTHOIMAGERY.ORTHOPHOTOS', 'PM'), maxzoom: 19, bounds: [-5.3, 41.2, 9.7, 51.2], label: '© IGN France (Licence Ouverte 2.0)', href: 'https://geoservices.ign.fr' },
  { id: 'nl', url: (z, x, y) => `${O.pdok}/hwh/luchtfotorgb/wmts/v1_0/Actueel_orthoHR/EPSG:3857/${z}/${x}/${y}.jpeg`, maxzoom: 19, bounds: [3.2, 50.7, 7.3, 53.6], label: 'Beeldmateriaal Nederland, via PDOK (CC BY 4.0)', href: 'https://www.pdok.nl' },
  { id: 'lu', url: (z, x, y) => `${O.geoportailLu}/opendata/wmts/ortho_latest/GLOBAL_WEBMERCATOR_4_V3/${z}/${x}/${y}.jpeg`, maxzoom: 19, bounds: [5.7, 49.4, 6.6, 50.2], label: 'Administration du cadastre et de la topographie, Luxembourg (CC0)', href: 'https://data.public.lu' },
  { id: 'ch', url: (z, x, y) => `${O.swisstopo}/1.0.0/ch.swisstopo.swissimage/default/current/3857/${z}/${x}/${y}.jpeg`, maxzoom: 19, bounds: [5.9, 45.8, 10.5, 47.9], label: '© swisstopo', href: 'https://www.swisstopo.admin.ch' },
  { id: 'at', url: (z, x, y) => `${O.basemapAt}/basemap/bmaporthofoto30cm/normal/google3857/${z}/${y}/${x}.jpeg`, maxzoom: 19, bounds: [9.5, 46.3, 17.2, 49.1], label: 'basemap.at (CC BY 4.0)', href: 'https://basemap.at' },
  { id: 'cz', url: (z, x, y) => `${O.cuzk}/arcgis1/rest/services/ORTOFOTO_WM/MapServer/tile/${z}/${y}/${x}`, maxzoom: 19, bounds: [12, 48.5, 18.9, 51.1], label: '© ČÚZK', href: 'https://geoportal.cuzk.cz' },
  { id: 'pl', url: wmts(`${O.geoportalPl}/wss/service/PZGIK/ORTO/WMTS/StandardResolution`, 'ORTOFOTOMAPA', 'EPSG:3857', 'EPSG:3857:'), maxzoom: 19, bounds: [14.1, 49, 24.2, 54.9], label: 'Geoportal.gov.pl, GUGiK', href: 'https://www.geoportal.gov.pl' },
]

/** The address an `ortho://id/z/x/y` tile is really fetched from. */
export function worldOrthoUrl(url: string): string {
  const [id, z, x, y] = url.slice(WORLD_SCHEME.length + 3).split('/')
  return WORLD_ORTHOS.find((ortho) => ortho.id === id)!.url(Number(z), Number(x), Number(y))
}

// A transparent 1x1 PNG: what the map is given where a service has no photo.
const NOTHING = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNgYGBgAAAABQABeqhXUAAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0)).buffer
/** A photographed tile is tens of kilobytes; one flat colour compresses to one or two. */
const BLANK_BYTES = 3000

export const loadWorldOrthoTile: AddProtocolAction = async ({ url }, abort) => {
  const res = await fetch(worldOrthoUrl(url), { signal: abort.signal })
  if (!res.ok) return { data: NOTHING }
  const data = await res.arrayBuffer()
  return { data: data.byteLength < BLANK_BYTES ? NOTHING : data }
}

// The national photos take over from the 10 m mosaic at one zoom everywhere, as the Baltic ones do.
export const WORLD_ORTHO_SOURCES: RasterSource[] = WORLD_ORTHOS.map((ortho) => ({
  id: ortho.id,
  tiles: () => `${WORLD_SCHEME}://${ortho.id}/{z}/{x}/{y}`,
  minzoom: 14,
  maxzoom: ortho.maxzoom,
  bounds: ortho.bounds,
  coversStreets: true,
  attribution: { label: ortho.label, href: ortho.href },
}))
