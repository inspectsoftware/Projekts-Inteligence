import { describe, expect, it } from 'vitest'
import { indexGtfs, seconds, withoutStopKinks } from '../../server/transit/gtfs'
import { answerFor, balticDay, findTrip, pathAlong, snapToRoute } from '../../server/transit/match'

// One bus line through three stops eastwards along 54.68° N in Vilnius, every half hour, on weekdays.
const files = new Map([
  ['stops.txt', 'stop_id,stop_name,stop_lat,stop_lon\nA,Stotis,54.68,25.27\nB,"Rotušė, centras",54.68,25.28\nC,Antakalnis,54.68,25.29\n'],
  ['routes.txt', 'route_id,route_short_name,route_long_name,route_type\nb4,4,Stotis–Antakalnis,3\nt4,4,Trolleybus four,800\n'],
  ['calendar.txt', 'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\nwd,1,1,1,1,1,0,0,20260101,20271231\n'],
  ['calendar_dates.txt', 'service_id,date,exception_type\nwd,20261110,2\n'],
  ['trips.txt', 'route_id,service_id,trip_id,trip_headsign,shape_id\nb4,wd,T1000,Antakalnis,east\nb4,wd,T1030,Antakalnis,east\nt4,wd,TR1000,Elsewhere,\n'],
  // The line the buses follow, its points out of order on purpose.
  ['shapes.txt', 'shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence\neast,54.68,25.29,3\neast,54.68,25.27,1\neast,54.68,25.28,2\n'],
  [
    'stop_times.txt',
    // Out of order on purpose: the index sorts by stop_sequence.
    'trip_id,arrival_time,departure_time,stop_id,stop_sequence\nT1000,10:10:00,10:10:00,C,3\nT1000,10:00:00,10:00:00,A,1\nT1000,10:05:00,10:05:00,B,2\n' +
      'T1030,10:30:00,10:30:00,A,1\nT1030,10:35:00,10:35:00,B,2\nT1030,10:40:00,10:40:00,C,3\n' +
      'TR1000,10:00:00,10:00:00,A,1\nTR1000,10:10:00,10:10:00,C,2\n',
  ],
])
const index = indexGtfs(files)
/** Monday 9 November 2026, local (EET, UTC+2) time. */
const at = (time: string) => Date.UTC(2026, 10, 9) + (seconds(time) - 2 * 3600) * 1000

describe('timetable trips', () => {
  it('reads stops, quoted names and trips in stop order', () => {
    expect(index.stops[1].name).toBe('Rotušė, centras')
    expect(Array.from(index.trips[0].times)).toEqual([36_000, 36_300, 36_600])
    expect(index.tripsByRoute.get('4')).toHaveLength(3)
  })

  it('knows the Baltic day and second, across a change of date', () => {
    expect(balticDay(at('10:05:00'))).toMatchObject({ date: 20261109, weekday: 0, second: 36_300 })
  })

  it('finds a bus by route and place, and tells it from the trolleybus of the same number', () => {
    const fix = { lon: 25.285, lat: 54.68, route: '4', mode: 'bus' }
    expect(findTrip(index, fix, at('10:07:30'))?.trip.id).toBe('T1000')
    expect(findTrip(index, { ...fix, mode: 'trolleybus' }, at('10:07:30'))?.trip.id).toBe('TR1000')
    // The next one along, by the minute it set out.
    expect(findTrip(index, { ...fix, start: 630 }, at('10:37:30'))?.trip.id).toBe('T1030')
    // Tuesday the 10th is taken out of the calendar; and nothing fits a bus kilometres away.
    expect(findTrip(index, fix, at('10:07:30') + 86_400_000)).toBeNull()
    expect(findTrip(index, { ...fix, lat: 54.75 }, at('10:07:30'))).toBeNull()
  })

  it('says which stops are passed and how late the bus is', () => {
    // Half way from B to C at 10:09:30, due there at 10:07:30: two minutes late.
    const answer = answerFor(index, { lon: 25.285, lat: 54.68, route: '4', mode: 'bus' }, at('10:09:30'))
    expect(answer).toMatchObject({ route: '4', headsign: 'Antakalnis', next: 2, delay: 120 })
    expect(answer?.stops.map((stop) => stop.at)).toEqual([at('10:00:00'), at('10:05:00'), at('10:10:00')])
    expect(answer?.shape[0]).toEqual([25.27, 54.68])
  })

  it('takes a trip by its id when the feed gives one', () => {
    const answer = answerFor(index, { lon: 25.27, lat: 54.68, route: null, mode: 'bus', trip: 'T1030' }, at('10:29:00'))
    expect(answer).toMatchObject({ next: 0 })
    expect(answer?.stops[0].at).toBe(at('10:30:00'))
  })
})

describe('vehicles on their routes', () => {
  it('puts a bus that the GPS has off the street back on its line, heading the way the line runs', () => {
    // About 30 m north of the line, between B and C, at 10:07:30.
    const snapped = snapToRoute(index, { lon: 25.285, lat: 54.68027, route: '4', mode: 'bus' }, at('10:07:30'))
    expect(snapped).toMatchObject({ lon: 25.285, lat: 54.68, trk: 90 })
    // Half way along the second of two 643 m stretches.
    expect(snapped?.along).toBeCloseTo(965, -1)
    // Its next stop, C, at the end of the line: where carrying it on along its route has to end.
    expect(snapped?.nextStop).toBeCloseTo(1287, -1)
  })

  it('leaves a bus well off its line, and one with no trip, where it said it was', () => {
    expect(snapToRoute(index, { lon: 25.285, lat: 54.681, route: '4', mode: 'bus' }, at('10:07:30'))).toBeNull()
    expect(snapToRoute(index, { lon: 25.285, lat: 54.68, route: '99', mode: 'bus' }, at('10:07:30'))).toBeNull()
  })
})

describe('the way a vehicle went', () => {
  // An L: 643 m east along 54.68° N, then about 555 m north.
  const shape = Float64Array.from([25.27, 54.68, 25.28, 54.68, 25.28, 54.685])

  it('follows the line round its bend between two distances along it', () => {
    const path = pathAlong(shape, 320, 900)
    expect(path).toHaveLength(3)
    expect(path[0][0]).toBeCloseTo(25.275, 4)
    expect(path[1]).toEqual([25.28, 54.68])
    expect(path[2][0]).toBeCloseTo(25.28, 6)
    expect(path[2][1]).toBeGreaterThan(54.682)
  })

  it('is a single straight piece when both ends lie on one stretch', () => {
    expect(pathAlong(shape, 100, 300)).toHaveLength(2)
  })
})

describe('route lines', () => {
  it('lose the jog the operator drew to each stop on the pavement, and keep their real bends', () => {
    // Along 54.68° N, through a stop 12 m to the north, then a real corner north.
    const line = Float64Array.from([25.27, 54.68, 25.275, 54.68011, 25.28, 54.68, 25.28, 54.685])
    const kept = withoutStopKinks(line, [{ lon: 25.275, lat: 54.68011 }])
    expect(Array.from(kept)).toEqual([25.27, 54.68, 25.28, 54.68, 25.28, 54.685])
    // A stop the line passes straight through stays a vertex; so does any vertex with no stop on it.
    const straight = Float64Array.from([25.27, 54.68, 25.275, 54.68, 25.28, 54.68])
    expect(withoutStopKinks(straight, [{ lon: 25.275, lat: 54.68 }])).toHaveLength(6)
    expect(withoutStopKinks(line, [])).toHaveLength(8)
  })
})

describe('a vehicle off its timetable, in its lane all the same', () => {
  it("is put on its route's line nearby, its way, once the line is in its lanes", async () => {
    const { onRouteNear } = await import('../../server/transit/match')
    const lanes = indexGtfs(files)
    // Off its line until the line is put in its lanes (streets.ts).
    expect(onRouteNear(lanes, '4', 'bus', 25.285, 54.68012, 90)).toBeNull()
    lanes.onStreets = lanes.shapes.map(() => true)
    // 13 m north of the line, heading east as it runs: on it.
    const near = onRouteNear(lanes, '4', 'bus', 25.285, 54.68012, 90)
    expect(near?.lat).toBeCloseTo(54.68, 6)
    expect(near?.lon).toBeCloseTo(25.285, 6)
    expect(near?.trk).toBe(90)
    // Heading west, against the line: it is not this line's lane.
    expect(onRouteNear(lanes, '4', 'bus', 25.285, 54.68012, 270)).toBeNull()
    // 55 m off: not on it.
    expect(onRouteNear(lanes, '4', 'bus', 25.285, 54.6805, 90)).toBeNull()
  })
})

describe("a trolleybus where the timetable has none", () => {
  it('is matched as the bus it is, but not where the town has trolleybuses of its own', async () => {
    const { modeIn } = await import('../../server/transit/match')
    // This timetable has a trolleybus route (t4): a trolleybus stays one.
    expect(modeIn(indexGtfs(files), 'trolleybus')).toBe('trolleybus')
    // Without it (Tallinn since 2023): a bus.
    const busesOnly = new Map(files)
    busesOnly.set('routes.txt', 'route_id,route_short_name,route_long_name,route_type\nb4,4,Stotis–Antakalnis,3\n')
    busesOnly.set('trips.txt', 'route_id,service_id,trip_id,trip_headsign,shape_id\nb4,wd,T1000,Antakalnis,east\n')
    expect(modeIn(indexGtfs(busesOnly), 'trolleybus')).toBe('bus')
    expect(modeIn(indexGtfs(busesOnly), 'tram')).toBe('tram')
  })
})
