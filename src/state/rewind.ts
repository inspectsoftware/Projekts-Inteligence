import { create } from 'zustand'
import type { EntityKind } from '../../shared/entity'
import type { HistoryFeedId, HistoryIndex } from '../../shared/history'

interface RewindState {
  /** The rewind bar is on screen. */
  open: boolean
  /** The moment the moving layers show, epoch ms on the server's clock; null is live. */
  at: number | null
  /** When the server has frames, refreshed while the bar is open. */
  index: HistoryIndex | null
  setOpen(open: boolean): void
  setAt(at: number | null): void
  setIndex(index: HistoryIndex): void
}

export const useRewind = create<RewindState>()((set) => ({
  open: false,
  at: null,
  index: null,
  setOpen: (open) => set(open ? { open } : { open, at: null }),
  setAt: (at) => set({ at }),
  setIndex: (index) => set({ index }),
}))

/** True while the map shows the past. Read in hot paths, so no subscription. */
export const rewinding = (): boolean => useRewind.getState().at !== null

/** Whether things of this kind are being shown from the past: the aircraft and ships, whose feeds keep a history. */
export const rewound = (kind: EntityKind): boolean => (kind === 'aircraft' || kind === 'ship') && rewinding()

/** The time of the frame that answers for `at`: the newest at or before it, else the oldest. */
export function frameTime(index: HistoryIndex | null, id: HistoryFeedId, at: number): number {
  const times = index?.feeds[id] ?? []
  let found = times[0] ?? at
  for (const time of times) {
    if (time > at) break
    found = time
  }
  return found
}
