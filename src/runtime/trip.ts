import { create } from 'zustand'
import type { TripAnswer } from '../../shared/adapters/transit'
import { useSelection } from '../state/selection'

interface TripState {
  /** The vehicle asked about: the selected bus, tram or train. */
  id: string | null
  answer: TripAnswer | null
  /** 'none': its network has no timetable here, or no trip fits it. */
  status: 'idle' | 'loading' | 'ok' | 'none' | 'error'
}

/** The selected vehicle's timetable trip, for its card and for drawing its route on the map. */
export const useTrip = create<TripState>()(() => ({ id: null, answer: null, status: 'idle' }))

/** How often the trip is asked about again while it stays selected: the vehicle moves along it. */
const REFRESH_MS = 30_000

const hasTrip = (id: string | null): id is string => !!id && (id.startsWith('transit:') || id.startsWith('train:'))

let timer: ReturnType<typeof setInterval> | null = null
let controller: AbortController | null = null

function watch(id: string | null): void {
  if (useTrip.getState().id === id) return
  if (timer) clearInterval(timer)
  controller?.abort()
  timer = null
  useTrip.setState({ id, answer: null, status: id ? 'loading' : 'idle' })
  if (!id) return

  const load = async () => {
    controller?.abort()
    const ask = new AbortController()
    controller = ask
    try {
      const res = await fetch(`/api/trip?id=${encodeURIComponent(id)}`, { signal: ask.signal })
      if (useTrip.getState().id !== id) return
      if (res.status === 204 || res.status === 404) return useTrip.setState({ answer: null, status: 'none' })
      if (!res.ok) throw new Error(String(res.status))
      useTrip.setState({ answer: (await res.json()) as TripAnswer, status: 'ok' })
    } catch {
      // Keeps what it had: a refresh that fails mid-trip should not blank the card.
      if (!ask.signal.aborted && useTrip.getState().id === id && !useTrip.getState().answer) useTrip.setState({ status: 'error' })
    }
  }
  void load()
  timer = setInterval(() => void (document.hidden || load()), REFRESH_MS)
}

// Follows the selection for as long as the app runs: a vehicle picked is a trip asked about.
useSelection.subscribe((state) => watch(hasTrip(state.selectedId) ? state.selectedId : null))
