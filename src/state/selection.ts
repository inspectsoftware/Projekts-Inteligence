import { create } from 'zustand'

interface SelectionState {
  selectedId: string | null
  hoveredId: string | null
  /** Entity the camera is locked onto, if any. Always the selected one. */
  followId: string | null
  select(id: string | null): void
  hover(id: string | null): void
  follow(id: string | null): void
}

export const useSelection = create<SelectionState>()((set, get) => ({
  selectedId: null,
  hoveredId: null,
  followId: null,
  select: (id) => set((state) => ({ selectedId: id, followId: state.followId === id ? id : null })),
  // Hover fires on every mouse move; only touch the store when the target changes.
  hover: (id) => {
    if (get().hoveredId !== id) set({ hoveredId: id })
  },
  follow: (id) => {
    if (get().followId !== id) set({ followId: id })
  },
}))
