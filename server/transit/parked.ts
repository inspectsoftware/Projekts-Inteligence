/**
 * Vehicles parked a long while drop off the map: a bus that has stood in its depot or at the end of
 * its line for over five minutes is no help to anyone waiting for one. It is still watched, and comes
 * back once it really drives off: twice in a row moving at 10 to 120 km/h between its fixes. One
 * jump of its position (its GPS losing itself, or snapping back) is not driving off.
 */

/** Standing still this long, a vehicle is parked. */
export const PARK_MS = 5 * 60_000
/** Moves within this many metres of where it stopped are its GPS wandering, not the vehicle. */
const STILL_M = 30
/** Between two fixes, faster than this is driving off; faster than the upper bound is a bad fix. */
const WAKE_KMH = 10
const JUMP_KMH = 120
/** Forgotten after this long unseen. */
const FORGET_MS = 3600_000

interface State {
  /** Where it came to a stop, and since when it has stood within STILL_M of there. */
  stopLon: number
  stopLat: number
  stoppedAt: number
  /** Its last position, and when it was last seen there. */
  lastLon: number
  lastLat: number
  lastAt: number
  parked: boolean
  /** Moves in a row at driving speed while parked. */
  driving: number
  seen: number
}

function metres(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const k = Math.cos((((lat1 + lat2) / 2) * Math.PI) / 180)
  return Math.hypot((lon2 - lon1) * 111_320 * k, (lat2 - lat1) * 110_540)
}

export class ParkedVehicles {
  private readonly states = new Map<string, State>()

  /** The vehicles to show of these, seen at `now`: all but those parked. */
  shown<T extends { id: string; lon: number; lat: number }>(vehicles: readonly T[], now: number): T[] {
    const out = vehicles.filter((vehicle) => !this.parked(vehicle, now))
    if (this.states.size > 20_000 || Math.random() < 0.01) for (const [id, state] of this.states) if (now - state.seen > FORGET_MS) this.states.delete(id)
    return out
  }

  private parked({ id, lon, lat }: { id: string; lon: number; lat: number }, now: number): boolean {
    const state = this.states.get(id)
    if (!state) {
      this.states.set(id, { stopLon: lon, stopLat: lat, stoppedAt: now, lastLon: lon, lastLat: lat, lastAt: now, parked: false, driving: 0, seen: now })
      return false
    }
    state.seen = now
    const step = metres(state.lastLon, state.lastLat, lon, lat)
    // The same place again: it was still there now, so its next move is timed from here.
    if (step < 1) {
      state.lastAt = now
      if (!state.parked && now - state.stoppedAt > PARK_MS) state.parked = true
      return state.parked
    }
    const kmh = (step / Math.max(1, now - state.lastAt)) * 3600
    state.lastLon = lon
    state.lastLat = lat
    state.lastAt = now
    const away = metres(state.stopLon, state.stopLat, lon, lat) > STILL_M
    if (state.parked) {
      // Away from where it stopped, too: a parked bus's GPS twitching back and forth by a few metres
      // every two seconds is already 10 km/h.
      state.driving = away && kmh >= WAKE_KMH && kmh <= JUMP_KMH ? state.driving + 1 : 0
      if (state.driving < 2) return true
      state.parked = false
      state.driving = 0
    } else if (!away) {
      if (now - state.stoppedAt > PARK_MS) state.parked = true
      return state.parked
    }
    // Moving: it stops afresh wherever it next stands.
    state.stopLon = lon
    state.stopLat = lat
    state.stoppedAt = now
    return false
  }
}
