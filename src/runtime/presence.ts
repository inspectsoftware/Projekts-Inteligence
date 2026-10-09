import { useSyncExternalStore } from 'react'
import type { PresenceResponse } from '../../shared/room'
import { roomFetch } from './visitor'

const BEAT_MS = 30_000

let online: number | null = null
let pinged = 0
let timer: ReturnType<typeof setTimeout> | null = null
let busy = false
const listeners = new Set<() => void>()

/** Tells the server this browser is here and asks how many are. Stops while the tab is hidden. */
async function beat(): Promise<void> {
  timer = null
  // Picked up again by the visibility listener below.
  if (document.hidden || listeners.size === 0) return
  busy = true
  try {
    const res = await roomFetch('/api/presence')
    if (res.ok) {
      ;({ online, pinged } = (await res.json()) as PresenceResponse)
      for (const listener of listeners) listener()
    }
  } catch {
    // The next beat asks again; the top bar already shows a lost uplink.
  } finally {
    busy = false
  }
  timer = setTimeout(() => void beat(), BEAT_MS)
}

function wake(): void {
  if (!timer && !busy) void beat()
}

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) document.addEventListener('visibilitychange', wake)
  listeners.add(listener)
  wake()
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) document.removeEventListener('visibilitychange', wake)
  }
}

/** How many browsers are on the site right now, or null until the server has said. */
export function useOnline(): number | null {
  return useSyncExternalStore(subscribe, () => online)
}

/** The newest chat message that calls on this visitor, or 0. Known even while the chat window is closed. */
export function usePinged(): number {
  return useSyncExternalStore(subscribe, () => pinged)
}
