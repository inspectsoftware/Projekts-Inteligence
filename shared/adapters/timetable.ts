import type { TransitMode } from './transit'

/**
 * A GTFS timetable boiled down to what "when does the next one leave from here" needs,
 * as baked by scripts/bake-riga-transit.ts. Everything refers to everything else by array index.
 */
export interface Timetable {
  routes: [name: string, mode: TransitMode][]
  headsigns: string[]
  /** GTFS stop ids. */
  stops: string[]
  /** The weekdays it runs, Monday first ("1111100"), between two dates (yyyymmdd), then the dates added and the dates taken away. */
  services: [days: string, from: number, to: number, added: number[], removed: number[]][]
  /** The stops along a trip, in order. */
  paths: number[][]
  /** Minutes from a trip's first departure to its departure from each stop of its path. */
  offsets: number[][]
  /** `start` is in minutes after midnight of the service day, and passes 24 h for trips that run into the night. */
  trips: [route: number, service: number, headsign: number, path: number, offsets: number, start: number][]
}

export interface Departures {
  route: string
  mode: TransitMode
  headsign: string
  /** Minutes after midnight, Rīga time, soonest first. */
  times: number[]
}

const DAY_MS = 86_400_000
const DAY_MIN = 1440

const RIGA = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Riga',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  hourCycle: 'h23',
})

export const formatClock = (minutes: number): string =>
  `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`

/** The next few departures of every line from one stop, the line leaving soonest first. */
export function nextDepartures(timetable: Timetable, stopId: string, now: number, perLine = 3, withinMin = 180): Departures[] {
  const stop = timetable.stops.indexOf(stopId)
  if (stop === -1) return []
  const clock = Object.fromEntries(RIGA.formatToParts(now).map((part) => [part.type, Number(part.value)]))
  const midnight = Date.UTC(clock.year, clock.month - 1, clock.day)
  const minutes = clock.hour * 60 + clock.minute
  const lines = new Map<string, Departures>()

  // Yesterday's service day is still running after midnight: its late trips are timed past 24:00.
  for (const back of [1, 0]) {
    const day = new Date(midnight - back * DAY_MS)
    const date = day.getUTCFullYear() * 10_000 + (day.getUTCMonth() + 1) * 100 + day.getUTCDate()
    const weekday = (day.getUTCDay() + 6) % 7
    const running = timetable.services.map(
      ([days, from, to, added, removed]) => !removed.includes(date) && (added.includes(date) || (days[weekday] === '1' && date >= from && date <= to)),
    )
    const from = minutes + back * DAY_MIN

    for (const [route, service, headsign, path, offsets, start] of timetable.trips) {
      if (!running[service]) continue
      const stops = timetable.paths[path]
      // The last stop of a trip is where it ends, not a departure.
      for (let i = 0; i < stops.length - 1; i++) {
        if (stops[i] !== stop) continue
        const at = start + timetable.offsets[offsets][i]
        if (at < from || at >= from + withinMin) continue
        const key = `${route}|${headsign}`
        const [name, mode] = timetable.routes[route]
        const line = lines.get(key) ?? { route: name, mode, headsign: timetable.headsigns[headsign], times: [] }
        line.times.push(at - back * DAY_MIN)
        lines.set(key, line)
      }
    }
  }

  for (const line of lines.values()) line.times = line.times.sort((a, b) => a - b).slice(0, perLine)
  return [...lines.values()].sort((a, b) => a.times[0] - b.times[0])
}
