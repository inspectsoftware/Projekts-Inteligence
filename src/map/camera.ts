import type { Map, PaddingOptions } from 'maplibre-gl'
import { haversine } from '../../shared/geo/sphere'
import { BALTIC_BBOX } from '../../shared/region'
import { t } from '../i18n'

export interface View {
  id: string
  label: string
  center: [number, number]
  zoom: number
  pitch?: number
  bearing?: number
}

/** Where the camera starts before it flies in: the Baltic from high up. */
export const INTRO_START = { center: [19.5, 56.2] as [number, number], zoom: 3.4 }

export const VIEWS: readonly View[] = [
  { id: 'riga', label: 'Rīga', center: [24.105, 56.949], zoom: 11.4, pitch: 48, bearing: -18 },
  { id: 'rix', label: t('RIX airport'), center: [23.972, 56.922], zoom: 12.7, pitch: 50, bearing: 10 },
  { id: 'gulf', label: t('Gulf of Rīga'), center: [23.45, 57.6], zoom: 7.9 },
  { id: 'irbe', label: t('Irbe Strait'), center: [21.95, 57.78], zoom: 8.6 },
  { id: 'ventspils', label: 'Ventspils', center: [21.56, 57.397], zoom: 11.6, pitch: 42 },
  { id: 'liepaja', label: 'Liepāja', center: [21.012, 56.52], zoom: 11.4, pitch: 42 },
  { id: 'daugavpils', label: 'Daugavpils', center: [26.53, 55.875], zoom: 11.3, pitch: 42 },
  { id: 'east', label: t('Eastern border'), center: [27.75, 56.6], zoom: 8.2 },
  { id: 'baltic', label: t('Baltic region'), center: [22.5, 57.3], zoom: 5.1 },
]

export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * Room for the fixed chrome, so "all of the Baltic" means the visible part of the map. The page opens
 * with no windows, and those opened later are deliberately not followed.
 */
function chromePadding(map: Map): PaddingOptions {
  // Wide (the --breakpoint-md in index.css): the floating bars take the top edge and
  // the map buttons the right. Narrow: the taskbar and the HUD row above it take the bottom edge.
  const wide = map.getContainer().clientWidth >= 640
  return wide ? { top: 80, bottom: 50, left: 50, right: 70 } : { top: 70, bottom: 110, left: 30, right: 30 }
}

export function flyHome(map: Map, duration = 1800): void {
  map.fitBounds([BALTIC_BBOX[0], BALTIC_BBOX[1], BALTIC_BBOX[2], BALTIC_BBOX[3]], {
    padding: chromePadding(map),
    pitch: 0,
    bearing: 0,
    duration: prefersReducedMotion() ? 0 : duration,
    essential: true,
  })
}

/**
 * The flight to something found by search, as a game's camera makes it: up, across, and down onto
 * it. How high it rises follows how far it goes, so the next street over barely lifts the camera
 * and the other end of the country pulls it up to see both. Never lower than either end.
 */
export function flyThere(map: Map, center: [number, number], zoom: number): void {
  if (prefersReducedMotion()) return void map.jumpTo({ center, zoom })
  const from = map.getCenter()
  const km = haversine(from.lng, from.lat, center[0], center[1]) / 1000
  const peak = Math.max(4.5, Math.min(map.getZoom() - 1, zoom - 1.5, 12.5 - Math.log2(Math.max(1, km))))
  map.flyTo({ center, zoom, minZoom: peak, duration: 2200 + Math.min(1800, km * 12), essential: true })
}

export function flyToView(map: Map, view: View): void {
  map.flyTo({
    center: view.center,
    zoom: view.zoom,
    pitch: view.pitch ?? 0,
    bearing: view.bearing ?? 0,
    duration: prefersReducedMotion() ? 0 : 2200,
    essential: true,
  })
}

/** Opening move: descend onto Latvia. The camera is free to leave afterwards: any place on Earth can be looked up. */
export function runIntro(map: Map): void {
  flyHome(map, 3400)
}
