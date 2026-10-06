import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { useWindows } from '../../../state/windows'

interface TvState {
  /** The channel in the player: an id from shared/media/tv.ts. Remembered between visits. */
  channelId: string | null
  /**
   * How many times a channel has been asked for during this visit. While it is zero the player
   * waits for a click: a channel brought back from last time would start a third party's player unasked.
   */
  plays: number
  /** Puts a channel in the player and starts it. Asking for the one already there starts it afresh. */
  watch(id: string): void
}

/** What the Live TV window is showing. */
export const useTv = create<TvState>()(
  persist(
    (set) => ({
      channelId: null,
      plays: 0,
      watch: (id) => set((state) => ({ channelId: id, plays: state.plays + 1 })),
    }),
    { name: 'pwh-tv', version: 1, partialize: ({ channelId }) => ({ channelId }) },
  ),
)

/** Opens the Live TV window on a channel and starts it: for the command palette and any other feature. */
export function watchChannel(id: string): void {
  const { windows, open, setCollapsed } = useWindows.getState()
  useTv.getState().watch(id)
  open('tv')
  // Opened out as well: in a folded window the player would start where nobody sees it.
  if (windows.tv?.collapsed) setCollapsed('tv', false)
}
