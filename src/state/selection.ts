import { create } from 'zustand'
import type { StaticSelection } from '../layers/types'

interface SelectionState {
  /** A live entity, by id. */
  selectedId: string | null
  /** Or a fixed map feature (an airfield, a substation). Never both. */
  feature: StaticSelection | null
  hoveredId: string | null
  /** Entity the camera is locked onto, if any. Always the selected one. */
  followId: string | null
  select(id: string | null): void
  selectFeature(feature: StaticSelection | null): void
  hover(id: string | null): void
  follow(id: string | null): void
}

export const useSelection = create<SelectionState>()((set, get) => ({
  selectedId: null,
  feature: null,
  hoveredId: null,
  followId: null,
  select: (id) => set((state) => ({ selectedId: id, feature: null, followId: state.followId === id ? id : null })),
  selectFeature: (feature) => set({ feature, selectedId: null, followId: null }),
  // Hover fires on every mouse move; only touch the store when the target changes.
  hover: (id) => {
    if (get().hoveredId !== id) set({ hoveredId: id })
  },
  follow: (id) => {
    if (get().followId !== id) set({ followId: id })
  },
}))
