import type { Map } from 'maplibre-gl'
import { useSyncExternalStore } from 'react'

/**
 * The one live map, published once its style has loaded. Kept outside React so
 * controllers and the HUD can drive it imperatively without re-rendering anything.
 */
let current: Map | null = null
let failure: string | null = null
const listeners = new Set<() => void>()

export function getMap(): Map | null {
  return current
}

export function setMap(map: Map | null): void {
  current = map
  for (const listener of listeners) listener()
}

/** Records why the map could not start (no WebGL2, for example), or clears it. */
export function setMapFailure(message: string | null): void {
  failure = message
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** The loaded map, or null while it is starting up or after it is torn down. */
export function useMap(): Map | null {
  return useSyncExternalStore(subscribe, getMap)
}

export function useMapFailure(): string | null {
  return useSyncExternalStore(subscribe, () => failure)
}
