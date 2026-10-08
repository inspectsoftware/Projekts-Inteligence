import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface LayersState {
  /** Explicit choices only; a layer the user never touched follows its own default. */
  visible: Record<string, boolean>
  toggle(id: string, defaultOn: boolean): void
  /** Kinds of public transport (bus, tram…) left out of their layer. */
  hiddenModes: Record<string, boolean>
  setModeHidden(mode: string, hidden: boolean): void
}

export const useLayers = create<LayersState>()(
  persist(
    (set) => ({
      visible: {},
      hiddenModes: {},
      setModeHidden: (mode, hidden) => set((state) => ({ hiddenModes: { ...state.hiddenModes, [mode]: hidden } })),
      toggle: (id, defaultOn) =>
        set((state) => ({ visible: { ...state.visible, [id]: !(state.visible[id] ?? defaultOn) } })),
    }),
    { name: 'pwh-layers', version: 1 },
  ),
)

export function isLayerOn(visible: Record<string, boolean>, id: string, defaultOn: boolean): boolean {
  return visible[id] ?? defaultOn
}
