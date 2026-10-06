import type { AddProtocolAction } from 'maplibre-gl'
import { TILE_ORIGINS } from '../../shared/origins'

/**
 * NASA renders the recent 30 m passes on demand and answers with HTTP 500 when a page asks for
 * many tiles at once. The map never asks twice, so each refusal would stay a square hole in the
 * picture. Tiles named `gibsq://<path>` are therefore fetched a few at a time and asked again.
 */
export const PATIENT_SCHEME = 'gibsq'

const AT_ONCE = 6
const TRIES = 3

/** The address a `gibsq://` tile is really fetched from. */
export function patientUrl(url: string): string {
  return `${TILE_ORIGINS.gibs}/${url.slice(PATIENT_SCHEME.length + 3)}`
}

let running = 0
const waiting: (() => void)[] = []

/** Takes one of the few places in the queue; call the result to give it back. */
async function turn(): Promise<() => void> {
  if (running >= AT_ONCE) await new Promise<void>((resolve) => waiting.push(resolve))
  else running += 1
  // A place is handed straight to the next in line, so `running` only falls when nobody waits.
  return () => {
    const next = waiting.shift()
    if (next) next()
    else running -= 1
  }
}

const pause = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => (clearTimeout(timer), reject(signal.reason)), { once: true })
  })

export const loadPatientTile: AddProtocolAction = async ({ url }, abort) => {
  const done = await turn()
  try {
    for (let attempt = 1; ; attempt += 1) {
      // A tile the camera has left is not worth its place in the queue.
      abort.signal.throwIfAborted()
      const res = await fetch(patientUrl(url), { signal: abort.signal })
      if (res.ok) return { data: await res.arrayBuffer() }
      if (res.status < 500 || attempt === TRIES) throw new Error(`Tile refused: HTTP ${res.status}`)
      await pause(600 * attempt, abort.signal)
    }
  } finally {
    done()
  }
}
