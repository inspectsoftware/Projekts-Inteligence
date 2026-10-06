import { type Attribution, TILE_ORIGINS } from '../../shared/origins'

export type BaseMode = 'dark' | 'imagery' | 'daily' | 'night'

export interface RasterBase {
  /** Tile URL template. GIBS and EOX both use {z}/{y}/{x} order. */
  tiles(now: Date): string
  maxzoom: number
  attribution: Attribution
  /** Imagery is toned down so overlays stay readable on top of it. */
  brightnessMax: number
  saturation: number
}

export const BASE_MODES: readonly { id: BaseMode; label: string; hint: string }[] = [
  { id: 'dark', label: 'Dark', hint: 'Vector tactical basemap' },
  { id: 'imagery', label: 'Sat', hint: 'Sentinel-2 cloudless mosaic (2024)' },
  { id: 'daily', label: 'Daily', hint: "Yesterday's VIIRS true-colour pass" },
  { id: 'night', label: 'Night', hint: 'VIIRS night lights composite (2016)' },
]

const GIBS = `${TILE_ORIGINS.gibs}/wmts/epsg3857/best`

const GIBS_ATTRIBUTION: Attribution = {
  label: 'NASA EOSDIS GIBS',
  href: 'https://www.earthdata.nasa.gov/engage/open-data-services-software/earthdata-developer-portal/gibs-api',
}

/** Yesterday in UTC: today's pass over the Baltic is often not processed yet. */
export function gibsDate(now: Date): string {
  return new Date(now.getTime() - 24 * 3600 * 1000).toISOString().slice(0, 10)
}

export const RASTER_BASES: Record<Exclude<BaseMode, 'dark'>, RasterBase> = {
  imagery: {
    tiles: () => `${TILE_ORIGINS.eox}/wmts/1.0.0/s2cloudless-2024_3857/default/g/{z}/{y}/{x}.jpg`,
    maxzoom: 15,
    attribution: {
      label: 'Sentinel-2 cloudless 2024 by EOX (modified Copernicus Sentinel data), CC BY-NC-SA 4.0',
      href: 'https://s2maps.eu',
    },
    brightnessMax: 0.7,
    saturation: -0.25,
  },
  daily: {
    tiles: (now) =>
      `${GIBS}/VIIRS_NOAA20_CorrectedReflectance_TrueColor/default/${gibsDate(now)}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`,
    maxzoom: 9,
    attribution: GIBS_ATTRIBUTION,
    brightnessMax: 0.8,
    saturation: -0.15,
  },
  night: {
    tiles: () => `${GIBS}/VIIRS_Black_Marble/default/2016-01-01/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png`,
    maxzoom: 8,
    attribution: GIBS_ATTRIBUTION,
    brightnessMax: 1,
    saturation: 0,
  },
}
