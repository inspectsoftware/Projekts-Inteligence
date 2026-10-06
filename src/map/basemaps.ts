import { type Attribution, LITHUANIA_ENABLED, LITHUANIA_ORIGIN, TILE_ORIGINS } from '../../shared/origins'
import { LATVIA_BBOX } from '../../shared/region'
import { CLIP_SCHEME, TRIM_SCHEME } from './orthoClip'

export type BaseMode = 'dark' | 'imagery' | 'daily' | 'night'

/** The camera never goes deeper: the sharpest imagery there is runs out at about 0.25 m per pixel. */
export const MAX_ZOOM = 19

/** How many levels a base may be stretched past the zoom at which its sharpest tiles are shown 1:1. */
const OVERZOOM = 2

export interface RasterSource {
  id: string
  /** Tile URL template. GIBS and EOX use {z}/{y}/{x} order. */
  tiles(now: Date): string
  /** Below this level the service has nothing, or nothing that belongs on this map. */
  minzoom?: number
  /** Beyond this level the service has no tiles; the map stretches the last one instead. */
  maxzoom: number
  /** [west, south, east, north]. No tile is asked for outside it. */
  bounds?: [number, number, number, number]
  /**
   * An air photo shows every street for itself, so it is laid over the drawn ones. A satellite
   * mosaic is too coarse for that and lies under them.
   */
  coversStreets?: boolean
  attribution: Attribution
}

export interface RasterBase {
  /** Drawn bottom to top. */
  sources: readonly RasterSource[]
  /** Imagery is toned down so overlays stay readable on top of it. */
  brightnessMax: number
  saturation: number
}

const GIBS = `${TILE_ORIGINS.gibs}/wmts/epsg3857/best`

const GIBS_ATTRIBUTION: Attribution = {
  label: 'NASA EOSDIS GIBS',
  href: 'https://www.earthdata.nasa.gov/engage/open-data-services-software/earthdata-developer-portal/gibs-api',
}

/** Yesterday in UTC: today's pass over the Baltic is often not processed yet. */
export function gibsDate(now: Date): string {
  return new Date(now.getTime() - 24 * 3600 * 1000).toISOString().slice(0, 10)
}

// The national orthophotos start at tile level 14 together, so the switch from the 10 m mosaic
// happens at one zoom everywhere. Estonia must not start lower: below 14 its service hands out
// a different satellite mosaic that covers half the Baltic.
const ORTHO_MINZOOM = 14

export const ORTHO_LITHUANIA: RasterSource = {
  id: 'lt',
  // PNG, six times heavier than JPEG, because only the PNG is transparent beyond the border.
  tiles: () =>
    `${LITHUANIA_ORIGIN}/mapproxy/nzt_ort10lt_recent_public/MapServer/export?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=png32&transparent=true&f=image`,
  minzoom: ORTHO_MINZOOM,
  maxzoom: 19,
  bounds: [20.93, 53.88, 26.86, 56.47],
  coversStreets: true,
  attribution: { label: 'ORT10LT © Nacionalinė žemės tarnyba, © geoportal.lt © SSVA', href: 'https://www.geoportal.lt' },
}

export const RASTER_BASES: Record<Exclude<BaseMode, 'dark'>, RasterBase> = {
  imagery: {
    // The order matters. Estonia's photo runs a few kilometres into Latvia, where Latvia's own
    // covers it; Lithuania's is cut cleanly at its own border, so it can lie on top.
    sources: [
      {
        id: 'eox',
        tiles: () => `${TILE_ORIGINS.eox}/wmts/1.0.0/s2cloudless-2025_3857/default/g/{z}/{y}/{x}.jpg`,
        maxzoom: 15,
        attribution: {
          label: 'Sentinel-2 cloudless 2025 by EOX (Contains modified Copernicus Sentinel data 2025), CC BY-NC-SA 4.0',
          href: 'https://s2maps.eu',
        },
      },
      {
        id: 'ee',
        tiles: () => `${TRIM_SCHEME}://{z}/{x}/{y}`,
        minzoom: ORTHO_MINZOOM,
        maxzoom: 18,
        bounds: [21.5, 57.45, 28.3, 59.9],
        coversStreets: true,
        attribution: {
          label: 'Maa- ja Ruumiameti ortofoto 2026',
          href: 'https://geoportaal.maaamet.ee/est/teenused/wms-wfs-wcs-teenused/maa-ameti-kaarditeenuste-kasutustingimused-p24.html',
        },
      },
      {
        id: 'lv',
        tiles: () => `${CLIP_SCHEME}://{z}/{x}/{y}`,
        minzoom: ORTHO_MINZOOM,
        maxzoom: 19,
        bounds: [...LATVIA_BBOX],
        coversStreets: true,
        attribution: {
          label: 'Ortofoto © Latvijas Ģeotelpiskās informācijas aģentūra (LĢIA), serviss: LVM GEO',
          href: 'https://www.lvmgeo.lv/dati/tabmenu-two/brivpieejas-wms-wfs-servisi',
        },
      },
      ...(LITHUANIA_ENABLED ? [ORTHO_LITHUANIA] : []),
    ],
    brightnessMax: 0.7,
    saturation: -0.25,
  },
  daily: {
    sources: [
      {
        id: 'daily',
        tiles: (now) =>
          `${GIBS}/VIIRS_NOAA20_CorrectedReflectance_TrueColor/default/${gibsDate(now)}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`,
        maxzoom: 9,
        attribution: GIBS_ATTRIBUTION,
      },
    ],
    brightnessMax: 0.8,
    saturation: -0.15,
  },
  night: {
    sources: [
      {
        id: 'night',
        tiles: () => `${GIBS}/VIIRS_Black_Marble/default/2016-01-01/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png`,
        maxzoom: 8,
        attribution: GIBS_ATTRIBUTION,
      },
    ],
    brightnessMax: 1,
    saturation: 0,
  },
}

/**
 * The deepest the camera may go on a base. Always a whole number: given a fractional limit the map
 * library lays vector tiles out at one fixed level from zoom 16 on, and the street-level labels,
 * which step with the zoom, stop changing.
 */
export function zoomCeiling(mode: BaseMode): number {
  if (mode === 'dark') return MAX_ZOOM
  // Tiles are 256 px, so those of level z are shown 1:1 at map zoom z - 1.
  const sharpest = Math.max(...RASTER_BASES[mode].sources.map((source) => source.maxzoom)) - 1
  return Math.min(MAX_ZOOM, sharpest + OVERZOOM)
}

/** A zoom that came from outside, a shared link for one, brought within what the base can show. */
export function clampZoom(zoom: number, mode: BaseMode): number {
  return Math.min(zoom, zoomCeiling(mode))
}

/** `detail` says where a base stops getting sharper; the Display window adds the zoom limit to it. */
export const BASE_MODES: readonly { id: BaseMode; label: string; hint: string; detail: string }[] = [
  { id: 'dark', label: 'Dark', hint: 'Vector tactical basemap', detail: 'Sharp at any zoom.' },
  {
    id: 'imagery',
    label: 'Sat',
    hint: 'National orthophotos over the Sentinel-2 cloudless mosaic (2025)',
    detail: `Air photos of ${LITHUANIA_ENABLED ? 'the Baltic states' : 'Latvia and Estonia'}, about 0.25 m per pixel. Elsewhere 10 m satellite data, soft past zoom 13.`,
  },
  { id: 'daily', label: 'Daily', hint: "Yesterday's VIIRS true-colour pass", detail: 'About 250 m per pixel: soft past zoom 8.' },
  { id: 'night', label: 'Night', hint: 'VIIRS night lights composite (2016)', detail: 'About 500 m per pixel: soft past zoom 7.' },
]
