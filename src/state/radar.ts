import { create } from 'zustand'

export interface RadarFrame {
  /** Epoch seconds of the radar scan. */
  time: number
  /** Tile URL template for this scan. */
  tiles: string
}

interface RadarState {
  frames: RadarFrame[]
  /** Which frame is shown. Follows the newest frame unless the user has stepped back. */
  index: number
  playing: boolean
  error: string | null
  setFrames(frames: RadarFrame[]): void
  setIndex(index: number): void
  setPlaying(playing: boolean): void
  setError(error: string | null): void
}

export const useRadar = create<RadarState>()((set) => ({
  frames: [],
  index: 0,
  playing: false,
  error: null,
  setFrames: (frames) =>
    set((state) => {
      // Stay on "latest" when new scans arrive, unless the user is looking at an older one.
      const wasLatest = state.frames.length === 0 || state.index >= state.frames.length - 1
      const index = wasLatest || state.playing ? frames.length - 1 : Math.min(state.index, frames.length - 1)
      return { frames, index: Math.max(0, index), error: null }
    }),
  setIndex: (index) => set({ index }),
  setPlaying: (playing) => set({ playing }),
  setError: (error) => set({ error }),
}))
