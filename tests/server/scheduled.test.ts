import { describe, expect, it } from 'vitest'
import { indexGtfs, seconds } from '../../server/transit/gtfs'
import { answerFor } from '../../server/transit/match'
import { nameFromTimetable, scheduledVehicles } from '../../server/transit/scheduled'

// One line through three stops eastwards along 58.38° N in Tartu, on weekdays, plus one with no line.
const index = indexGtfs(
  new Map([
    ['stops.txt', 'stop_id,stop_name,stop_lat,stop_lon\nA,Kaubamaja,58.38,26.72\nB,Raekoja plats,58.38,26.73\nC,Annelinn,58.38,26.74\n'],
    ['routes.txt', 'route_id,route_short_name,route_long_name,route_type\nr4,4,Kaubamaja–Annelinn,3\n'],
    ['calendar.txt', 'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\nwd,1,1,1,1,1,0,0,20260101,20271231\n'],
    ['trips.txt', 'route_id,service_id,trip_id,trip_headsign,shape_id\nr4,wd,T1,Annelinn,east\nr4,wd,T2,Annelinn,\n'],
    ['shapes.txt', 'shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence\neast,58.38,26.72,1\neast,58.38,26.73,2\neast,58.38,26.74,3\n'],
    [
      'stop_times.txt',
      'trip_id,arrival_time,departure_time,stop_id,stop_sequence\nT1,10:00:00,10:00:00,A,1\nT1,10:04:00,10:05:00,B,2\nT1,10:10:00,10:10:00,C,3\n' +
        'T2,10:00:00,10:00:00,A,1\nT2,10:10:00,10:10:00,C,2\n',
    ],
  ]),
)
const tartu = { id: 'tartu', name: 'Tartu' }
/** Monday 9 November 2026, local (EET, UTC+2) time. */
const at = (time: string) => Date.UTC(2026, 10, 9) + (seconds(time) - 2 * 3600) * 1000

describe('vehicles by the timetable', () => {
  it('puts each running trip with a line where its timetable has it, heading along it', () => {
    const [bus, ...rest] = scheduledVehicles(index, tartu, at('10:02:30'))
    expect(bus.id).toMatch(/^transit:tartu:s[0-9a-z]+$/)
    expect(rest).toEqual([])
    // Half way from leaving A at 10:00 to leaving B at 10:05.
    expect(bus).toMatchObject({ label: '4', trk: 90, props: { network: 'Tartu', route: '4', trip: 'T1', scheduled: true } })
    expect(bus.lon).toBeCloseTo(26.725, 4)
    expect(bus.lat).toBeCloseTo(58.38, 5)
    expect(bus.props.ahead?.length).toBeGreaterThanOrEqual(2)
  })

  it('is at a stop at its departure time, and its card finds the same trip', () => {
    const [bus] = scheduledVehicles(index, tartu, at('10:05:00'))
    expect(bus.lon).toBeCloseTo(26.73, 5)
    const answer = answerFor(index, { lon: bus.lon, lat: bus.lat, route: bus.props.route, mode: bus.props.mode, trip: bus.props.trip }, at('10:05:00'))
    expect(answer).toMatchObject({ headsign: 'Annelinn', next: 2, delay: 0 })
  })

  it('shows nothing before the first departure, after the last arrival, or on a day off', () => {
    expect(scheduledVehicles(index, tartu, at('09:59:00'))).toEqual([])
    expect(scheduledVehicles(index, tartu, at('10:10:30'))).toEqual([])
    // Saturday.
    expect(scheduledVehicles(index, tartu, at('10:02:00') + 5 * 86_400_000)).toEqual([])
  })
})

describe('live vehicles that report no route', () => {
  it('takes the route and trip of the timetable vehicle nearest each, nearest pairs first, each once', () => {
    const [planned] = scheduledVehicles(index, tartu, at('10:02:30'))
    const live = (id: string, lon: number) =>
      ({ id, kind: 'transit', lon, lat: 58.38, ts: 0, flags: 0, props: { network: 'Tartu', mode: 'bus', route: null, vehicle: id } }) as Parameters<typeof nameFromTimetable>[0][number]
    // One 30 m from the timetable's bus, one 200 m, one 2 km away.
    const near = live('a', planned.lon + 0.0005)
    const further = live('b', planned.lon + 0.0033)
    const far = live('c', planned.lon + 0.033)
    expect(nameFromTimetable([further, near, far], [planned])).toBe(1)
    expect(near.props).toMatchObject({ route: '4', trip: 'T1' })
    expect(near.label).toBe('4')
    // The timetable's one bus is taken: the next nearest, and the far one, keep no route.
    expect(further.props.route).toBeNull()
    expect(far.props.route).toBeNull()
  })
})
