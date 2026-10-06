import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { t } from '../i18n'
import type { BaseMode } from '../map/basemaps'

export type VisionMode = 'normal' | 'nvg' | 'flir' | 'crt'

export const VISION_MODES: readonly { id: VisionMode; label: string; hint: string }[] = [
  { id: 'normal', label: t('Std'), hint: t('Standard display') },
  { id: 'nvg', label: 'NVG', hint: t('Night-vision green phosphor') },
  { id: 'flir', label: 'FLIR', hint: t('White-hot thermal look') },
  { id: 'crt', label: 'CRT', hint: t('Scanline monitor') },
]

interface UiState {
  vision: VisionMode
  base: BaseMode
  setVision(vision: VisionMode): void
  setBase(base: BaseMode): void
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
      setVision: (vision) => set({ vision }),
      setBase: (base) => set({ base }),
    }),
    { name: 'pwh-ui', version: 1 },
  ),
)
