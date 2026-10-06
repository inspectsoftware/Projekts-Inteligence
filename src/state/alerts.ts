import { create } from 'zustand'
import type { Alert } from '../../shared/alerts/engine'

interface AlertsState {
  /** Conditions that hold right now, most severe first. */
  active: Alert[]
  setActive(active: Alert[]): void
}

export const useAlerts = create<AlertsState>()((set) => ({
  active: [],
  setActive: (active) => set({ active }),
}))
