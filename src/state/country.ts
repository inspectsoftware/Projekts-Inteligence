import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { CountryCode } from '../../shared/countries'

export const COUNTRY_TABS = [
  { id: 'brief', label: 'Brief', hint: 'A written profile of the country' },
  { id: 'economy', label: 'Economy', hint: 'People, output, prices and public finances, each with its source' },
  { id: 'defence', label: 'Defence', hint: 'Defence budgets and headcount, each with its source' },
  { id: 'forces', label: 'Forces', hint: 'Structure, equipment and allied units, each with its source' },
] as const
export type CountryTab = (typeof COUNTRY_TABS)[number]['id']

interface CountryState {
  country: CountryCode
  tab: CountryTab
  setCountry(country: CountryCode): void
  setTab(tab: CountryTab): void
}

/** Where the Country briefs window was left: which country, which tab. */
export const useCountry = create<CountryState>()(
  persist(
    (set) => ({
      country: 'LV',
      tab: 'brief',
      setCountry: (country) => set({ country }),
      setTab: (tab) => set({ tab }),
    }),
    { name: 'pwh-country', version: 1 },
  ),
)
