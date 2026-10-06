import type { Map, PaddingOptions } from 'maplibre-gl'
import { AOI_BBOX, LATVIA_BBOX } from '../../shared/region'

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
  { id: 'rix', label: 'RIX airport', center: [23.972, 56.922], zoom: 12.7, pitch: 50, bearing: 10 },
  { id: 'gulf', label: 'Gulf of Rīga', center: [23.45, 57.6], zoom: 7.9 },
  { id: 'irbe', label: 'Irbe Strait', center: [21.95, 57.78], zoom: 8.6 },
  { id: 'ventspils', label: 'Ventspils', center: [21.56, 57.397], zoom: 11.6, pitch: 42 },
  { id: 'liepaja', label: 'Liepāja', center: [21.012, 56.52], zoom: 11.4, pitch: 42 },
  { id: 'daugavpils', label: 'Daugavpils', center: [26.53, 55.875], zoom: 11.3, pitch: 42 },
  { id: 'east', label: 'Eastern border', center: [27.75, 56.6], zoom: 8.2 },
  { id: 'baltic', label: 'Baltic region', center: [22.5, 57.3], zoom: 5.1 },
]

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** Room for the floating panels, so "all of Latvia" means the visible part of the map. */
function chromePadding(map: Map): PaddingOptions {
  const wide = map.getContainer().clientWidth >= 900
  return { top: 70, bottom: 70, left: wide ? 290 : 30, right: wide ? 70 : 30 }
}

export function flyHome(map: Map, duration = 1800): void {
  map.fitBounds([LATVIA_BBOX[0], LATVIA_BBOX[1], LATVIA_BBOX[2], LATVIA_BBOX[3]], {
    padding: chromePadding(map),
    pitch: 0,
    bearing: 0,
    duration: prefersReducedMotion() ? 0 : duration,
    essential: true,
  })
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

/** Opening move: descend onto Latvia, then lock the camera to the Baltic region. */
export function runIntro(map: Map): void {
  map.once('moveend', () => {
    map.setMaxBounds([AOI_BBOX[0], AOI_BBOX[1], AOI_BBOX[2], AOI_BBOX[3]])
  })
  flyHome(map, 3400)
}
