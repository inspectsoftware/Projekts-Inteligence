import { create } from 'zustand'
import type { Placement, Size } from '../ui/windows/geometry'

export interface WindowState {
  open?: boolean
  collapsed?: boolean
  placement?: Placement
  size?: Size
}

interface Layout {
  /**
   * Explicit choices only; a window the user never touched follows its registry entry.
   * Looked up by the ids the registry knows, so ids left over from an older build are never read.
   */
  windows: Record<string, WindowState>
  /** Stacking order, back to front. A window that was never raised sits behind those that were. */
  order: string[]
}

interface WindowsState extends Layout {
  open(id: string): void
  close(id: string): void
  toggle(id: string, defaultOpen: boolean): void
  /** Brings a window to the front. */
  focus(id: string): void
  place(id: string, placement: Placement): void
  /** A new size, and where the window stands with it: a top or left corner moves it as it resizes. */
  resize(id: string, size: Size, placement: Placement): void
  setCollapsed(id: string, collapsed: boolean): void
  /** Keeps the layout as it is now for the next visit. Nothing is kept without it. */
  saveLayout(): void
  /** Closes everything, and forgets the saved layout and the remembered sizes too. */
  resetLayout(): void
}

const KEY = 'pwh-windows'
/**
 * Sizes are kept apart from the layout and without a save: a window resized once comes back at
 * that size, and where it stood with it.
 */
const SIZES = 'pwh-window-sizes'
type Kept = Pick<WindowState, 'size' | 'placement'>

/** The layout saved on an earlier visit. A page opens with a clear map unless there is one. */
export function savedLayout(): Layout {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? 'null') as { state?: Partial<Layout> } | null
    // The shape the store was kept in before saving became a deliberate act is still read.
    if (stored?.state?.windows && Array.isArray(stored.state.order)) return { windows: stored.state.windows, order: stored.state.order }
  } catch {
    // No storage, or something else's data under the key: start clear.
  }
  return { windows: {}, order: [] }
}

/** The saved layout, with every size the reader has given a window since laid over it. */
function startingLayout(): Layout {
  const layout = savedLayout()
  try {
    const kept = JSON.parse(localStorage.getItem(SIZES) ?? 'null') as Record<string, Kept | Size> | null
    // What was kept before positions were kept with sizes is a bare size.
    for (const [id, entry] of Object.entries(kept ?? {})) layout.windows[id] = { ...layout.windows[id], ...('w' in entry ? { size: entry } : entry) }
  } catch {
    // No storage, or something else's data under the key: the registry sizes stand.
  }
  return layout
}

export const useWindows = create<WindowsState>()((set, get) => {
  const patch = (id: string, change: WindowState) =>
    set((state) => ({ windows: { ...state.windows, [id]: { ...state.windows[id], ...change } } }))
  return {
    ...startingLayout(),
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
    resize: (id, size, placement) => {
      patch(id, { size, placement })
      const kept = Object.fromEntries(
        Object.entries(get().windows).flatMap(([other, state]): [string, Kept][] => (state.size ? [[other, { size: state.size, placement: state.placement }]] : [])),
      )
      try {
        localStorage.setItem(SIZES, JSON.stringify(kept))
      } catch {
        // Storage can be switched off; the size then lasts as long as the page.
      }
    },
    setCollapsed: (id, collapsed) => patch(id, { collapsed }),
    saveLayout: () => {
      const { windows, order } = get()
      try {
        localStorage.setItem(KEY, JSON.stringify({ state: { windows, order }, version: 1 }))
      } catch {
        // Storage can be switched off; the layout then lasts as long as the page.
      }
    },
    resetLayout: () => {
      set({ windows: {}, order: [] })
      try {
        localStorage.removeItem(KEY)
        localStorage.removeItem(SIZES)
      } catch {
        // Nothing was kept, so there is nothing to forget.
      }
    },
  }
})
