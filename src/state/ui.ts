import { useSyncExternalStore } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { t } from '../i18n'
import type { BaseMode } from '../map/basemaps'

export type VisionMode = 'normal' | 'nvg' | 'flir' | 'crt'
export type ThemeChoice = 'system' | 'light' | 'dark'

export const THEMES: readonly { id: ThemeChoice; label: string; hint: string }[] = [
  { id: 'system', label: t('Auto'), hint: t('Follow this device’s light or dark setting') },
  { id: 'light', label: t('Light'), hint: t('Light panels and a light map') },
  { id: 'dark', label: t('Dark'), hint: t('Dark panels and the dark tactical map') },
]

const prefersDark = () => window.matchMedia('(prefers-color-scheme: dark)')

/**
 * The theme in force: the reader's choice, or the device's own setting while the choice is "system".
 * Light unless the device asks for dark, so a device that states no preference gets the light page.
 */
/** The same, read once outside React. */
export function currentTheme(): 'light' | 'dark' {
  const choice = useUi.getState().theme
  if (choice !== 'system') return choice
  return prefersDark().matches ? 'dark' : 'light'
}

/** The palette the map is painted in now: over a photo it keeps its dark lettering, whatever the theme. */
export function currentMapTheme(): 'light' | 'dark' {
  return useUi.getState().base === 'dark' ? currentTheme() : 'dark'
}

export function useTheme(): 'light' | 'dark' {
  const choice = useUi((s) => s.theme)
  const device = useSyncExternalStore(
    (onChange) => {
      const media = prefersDark()
      media.addEventListener('change', onChange)
      return () => media.removeEventListener('change', onChange)
    },
    () => (prefersDark().matches ? 'dark' : 'light'),
  )
  return choice === 'system' ? device : choice
}

export const VISION_MODES: readonly { id: VisionMode; label: string; hint: string }[] = [
  { id: 'normal', label: t('Std'), hint: t('Standard display') },
  { id: 'nvg', label: 'NVG', hint: t('Night-vision green phosphor') },
  { id: 'flir', label: 'FLIR', hint: t('White-hot thermal look') },
  { id: 'crt', label: 'CRT', hint: t('Scanline monitor') },
]

interface UiState {
  vision: VisionMode
  base: BaseMode
  relief: boolean
  theme: ThemeChoice
  /** Shows the windows that are only of use to whoever builds or debugs the app, on a rail of their own. */
  developer: boolean
  setVision(vision: VisionMode): void
  setBase(base: BaseMode): void
  setRelief(relief: boolean): void
  setTheme(theme: ThemeChoice): void
  setDeveloper(developer: boolean): void
}

/** How many days into the past the recent imagery is turned back. Starts at the newest on every visit. */
export const useRecent = create<{ back: number; setBack(back: number): void }>()((set) => ({
  back: 0,
  setBack: (back) => set({ back }),
}))

/** Small, slow-changing UI choices only. Live entities never go through React state. */
export const useUi = create<UiState>()(
  persist(
    (set) => ({
      vision: 'normal',
      base: 'dark',
      relief: false,
      theme: 'system',
      developer: false,
      setVision: (vision) => set({ vision }),
      setBase: (base) => set({ base }),
      setRelief: (relief) => set({ relief }),
      setTheme: (theme) => set({ theme }),
      setDeveloper: (developer) => set({ developer }),
    }),
    { name: 'pwh-ui', version: 1 },
  ),
)
