import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { CountryCode } from '../../shared/countries'
import { t } from '../i18n'

export const COUNTRY_TABS = [
  { id: 'brief', label: t('Brief'), hint: t('A written profile of the country') },
  { id: 'economy', label: t('Economy'), hint: t('People, output, prices and public finances, each with its source') },
  { id: 'defence', label: t('Defence'), hint: t('Defence budgets and headcount, each with its source') },
  { id: 'forces', label: t('Forces'), hint: t('Structure, equipment and allied units, each with its source') },
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
