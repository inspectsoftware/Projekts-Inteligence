import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { EscalationLevel } from '../../shared/feeds'

export type IntelSort = 'importance' | 'latest'
export type IntelCountry = 'all' | 'LV' | 'LT' | 'EE'

interface IntelState {
  sort: IntelSort
  country: IntelCountry
  /** Headlines below this level are left out. */
  minLevel: EscalationLevel
  setSort(sort: IntelSort): void
  setCountry(country: IntelCountry): void
  setMinLevel(minLevel: EscalationLevel): void
}

/** How the Intel feed's list is ordered and narrowed down. Kept across reloads. */
export const useIntel = create<IntelState>()(
  persist(
    (set) => ({
      sort: 'importance',
      country: 'all',
      minLevel: 0,
      setSort: (sort) => set({ sort }),
      setCountry: (country) => set({ country }),
      setMinLevel: (minLevel) => set({ minLevel }),
    }),
    { name: 'pwh-intel', version: 1 },
  ),
)
