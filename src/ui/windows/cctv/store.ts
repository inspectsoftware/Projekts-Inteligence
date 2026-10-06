import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { CamFilter } from './pick'

interface CctvState extends CamFilter {
  /** Which page of the grid is showing. The grid never loads more than one page of pictures. */
  page: number
  /** The camera shown large, if any. */
  openId: string | null
  /**
   * Whether the visitor asked for that camera's player during this visit. A player brought back
   * from last time waits for a click: it would start a stream, or a third party's cookies, unasked.
   */
  armed: boolean
  setFilter(change: Partial<CamFilter>): void
  setPage(page: number): void
  /** Shows a camera large and lets its player start. To do this from elsewhere, also open the 'cctv' window. */
  open(id: string): void
  arm(): void
  back(): void
}

/** What the Live CCTV window was last looking at. */
export const useCctv = create<CctvState>()(
  persist(
    (set) => ({
      roads: false,
      country: 'all',
      query: '',
      page: 0,
      openId: null,
      armed: false,
      // Another filter is another list, so it starts at its first page.
      setFilter: (change) => set({ ...change, page: 0 }),
      setPage: (page) => set({ page }),
      open: (id) => set({ openId: id, armed: true }),
      arm: () => set({ armed: true }),
      back: () => set({ openId: null, armed: false }),
    }),
    {
      name: 'pwh-cctv',
      version: 1,
      partialize: ({ roads, country, query, openId }) => ({ roads, country, query, openId }),
    },
  ),
)
