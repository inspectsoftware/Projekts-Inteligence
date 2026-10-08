import { create } from 'zustand'
import type { FeedId, FeedMeta, FeedStatus } from '../../shared/feeds'
import type { Attribution } from '../../shared/origins'

export interface Stat {
  label: string
  value: number
  tone: 'info' | 'warn' | 'danger' | 'mil'
}

export interface FeedView {
  title: string
  status: FeedStatus
  updatedAt: number | null
  count: number | null
  error: string | null
  attribution: readonly Attribution[]
  /** Headline numbers for the layer list, e.g. how many aircraft are military. */
  stats: Stat[]
}

interface FeedsState {
  feeds: Partial<Record<FeedId, FeedView>>
  /** Seeds titles, credits and locked ("needs-key") states from GET /api/feeds. */
  seed(list: FeedMeta[]): void
  report(id: FeedId, patch: Partial<FeedView>): void
}

const BLANK: FeedView = {
  title: '',
  status: 'idle',
  updatedAt: null,
  count: null,
  error: null,
  attribution: [],
  stats: [],
}

/** Feed health for the chrome. Updated once per poll, not per entity. */
export const useFeeds = create<FeedsState>()((set) => ({
  feeds: {},
  seed: (list) =>
    set((state) => {
      const feeds = { ...state.feeds }
      for (const meta of list) {
        const current = feeds[meta.id]
        feeds[meta.id] = {
          ...BLANK,
          ...current,
          title: meta.title,
          attribution: meta.attribution,
          updatedAt: current?.updatedAt ?? meta.updatedAt,
          // A feed being polled already knows its own status better than the list does.
          status: current && current.status !== 'idle' ? current.status : meta.status,
        }
      }
      return { feeds }
    }),
  report: (id, patch) =>
    set((state) => ({ feeds: { ...state.feeds, [id]: { ...BLANK, ...state.feeds[id], ...patch } } })),
}))
