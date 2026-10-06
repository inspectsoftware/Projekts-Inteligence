import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { BaseMode } from '../map/basemaps'

export type VisionMode = 'normal' | 'nvg' | 'flir' | 'crt'

export const VISION_MODES: readonly { id: VisionMode; label: string; hint: string }[] = [
  { id: 'normal', label: 'Std', hint: 'Standard display' },
  { id: 'nvg', label: 'NVG', hint: 'Night-vision green phosphor' },
  { id: 'flir', label: 'FLIR', hint: 'White-hot thermal look' },
  { id: 'crt', label: 'CRT', hint: 'Scanline monitor' },
]

interface UiState {
  vision: VisionMode
  base: BaseMode
  setVision(vision: VisionMode): void
  setBase(base: BaseMode): void
}

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
