import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Placement, Size } from '../ui/windows/geometry'

export interface WindowState {
  open?: boolean
  collapsed?: boolean
  placement?: Placement
  /** Only resizable windows have one. */
  size?: Size
}

interface WindowsState {
  /**
   * Explicit choices only; a window the user never touched follows its registry entry.
   * Looked up by the ids the registry knows, so ids left over from an older build are never read.
   */
  windows: Record<string, WindowState>
  /** Stacking order, back to front. A window that was never raised sits behind those that were. */
  order: string[]
  open(id: string): void
  close(id: string): void
  toggle(id: string, defaultOpen: boolean): void
  /** Brings a window to the front. */
  focus(id: string): void
  place(id: string, placement: Placement): void
  resize(id: string, size: Size): void
  setCollapsed(id: string, collapsed: boolean): void
  resetLayout(): void
}

export const useWindows = create<WindowsState>()(
  persist(
    (set, get) => {
      const patch = (id: string, change: WindowState) =>
        set((state) => ({ windows: { ...state.windows, [id]: { ...state.windows[id], ...change } } }))
      return {
        windows: {},
        order: [],
        open: (id) => {
          patch(id, { open: true })
          get().focus(id)
        },
        close: (id) => patch(id, { open: false }),
        toggle: (id, defaultOpen) => ((get().windows[id]?.open ?? defaultOpen) ? get().close(id) : get().open(id)),
        // Called on every press inside a window; only touch the store when the order really changes.
        focus: (id) => {
          if (get().order.at(-1) !== id) set((state) => ({ order: [...state.order.filter((other) => other !== id), id] }))
        },
        place: (id, placement) => patch(id, { placement }),
        resize: (id, size) => patch(id, { size }),
        setCollapsed: (id, collapsed) => patch(id, { collapsed }),
        resetLayout: () => set({ windows: {}, order: [] }),
      }
    },
    { name: 'pwh-windows', version: 1 },
  ),
)
