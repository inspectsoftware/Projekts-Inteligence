import { describe, expect, it } from 'vitest'
import { type Timetable, formatClock, nextDepartures } from '../../shared/adapters/timetable'
import { rigaTransitLayer } from '../../src/layers/rigaTransit'

// One tram line, A → B → C, eight minutes end to end. Weekdays at 08:00 and 08:20, a late run
// at 24:10 of the service day, and a Saturday-only run at 08:05.
const timetable: Timetable = {
  routes: [['1', 'tram']],
  headsigns: ['Jugla'],
  stops: ['A', 'B', 'C'],
  services: [
    ['1111100', 20260101, 20271231, [], [20261014]],
    ['0000010', 20260101, 20271231, [20261014], []],
  ],
  paths: [[0, 1, 2]],
  offsets: [[0, 3, 8]],
  trips: [
    [0, 0, 0, 0, 0, 8 * 60],
    [0, 0, 0, 0, 0, 8 * 60 + 20],
    [0, 0, 0, 0, 0, 24 * 60 + 10],
    [0, 1, 0, 0, 0, 8 * 60 + 5],
  ],
}

// Rīga is on UTC+3 until the clocks go back on 25 October 2026.
const riga = (day: number, time: string) => Date.parse(`2026-10-${day}T${time}:00+03:00`)
const times = (stop: string, now: number) => nextDepartures(timetable, stop, now).flatMap((line) => line.times.map(formatClock))

describe('timetable departures', () => {
  it('lists what leaves a stop next, in Rīga time', () => {
    expect(nextDepartures(timetable, 'B', riga(13, '07:50'))).toEqual([{ route: '1', mode: 'tram', headsign: 'Jugla', times: [483, 503] }])
    expect(times('B', riga(13, '08:04'))).toEqual(['08:23'])
  })

  it('does not count the end of the line as a departure, nor a stop it does not know', () => {
    expect(times('C', riga(13, '07:50'))).toEqual([])
    expect(times('Z', riga(13, '07:50'))).toEqual([])
  })

  it('carries a late trip of the day before past midnight', () => {
    // Tuesday the 13th's 24:10 run leaves A at 00:10 on Wednesday, a day the service itself is called off.
    expect(times('A', riga(14, '00:02'))).toEqual(['00:10'])
  })

  it('follows the calendar: weekdays, and dates added or taken away', () => {
    expect(times('A', riga(17, '07:50'))).toEqual(['08:05'])
    expect(times('A', riga(14, '07:50'))).toEqual(['08:05'])
    expect(times('A', riga(18, '07:50'))).toEqual([])
  })
})

describe('Rīga stops and routes', () => {
  it('describes a stop by the lines calling there, before the timetable has loaded', () => {
    const picked = rigaTransitLayer.native!.pick!({ class: 'stop', id: '0079', name: 'Centrālā stacija', bus: '3, 22', tram: '1', request: 1 }, 24.12, 56.946)!
    expect(picked.model).toMatchObject({ kicker: 'Public transport stop', title: 'Centrālā stacija' })
    expect(picked.model.rows).toEqual([
      { label: 'Bus', value: '3, 22' },
      { label: 'Tram', value: '1' },
    ])
    expect(picked.model.badges.map((badge) => badge.text)).toEqual(['Timetable, not live', 'Request stop'])
    expect(picked.model.links[0].href).toBe('https://saraksti.lv/#stop/0079')
  })

  it('describes a route, and links only to the operator', () => {
    const pick = rigaTransitLayer.native!.pick!
    expect(pick({ class: 'route', mode: 'tram', ref: '1', name: 'Imanta - Jugla', url: 'https://saraksti.lv/#riga/tram/1' }, 24.1, 56.95)!.model).toMatchObject({
      kicker: 'Tram',
      title: 'Route 1',
      subtitle: 'Imanta - Jugla',
      links: [{ href: 'https://saraksti.lv/#riga/tram/1' }],
    })
    expect(pick({ class: 'route', mode: 'bus', ref: '2', url: 'https://example.com/x' }, 24.1, 56.95)!.model.links[0].href).toBe('https://saraksti.lv')
  })
})
