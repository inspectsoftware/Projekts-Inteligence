import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { FeedCache } from '../../server/core/cache'
import { GpsInterferenceMap, gpsHexFeed } from '../../server/feeds/gpsHex'
import type { FeedDef } from '../../server/feeds/types'
import { normaliseFires } from '../../shared/adapters/fires'
import { type RawObservation, type RawStationPoint, normaliseStations } from '../../shared/adapters/stations'
import { type CapFeed, normaliseWarnings } from '../../shared/adapters/warnings'
import { type Aircraft, Flag } from '../../shared/entity'
import { simplify } from '../../shared/geo/simplify'

const fixture = <T>(name: string): T =>
  JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8')) as T

function aircraft(hex: string, lon: number, lat: number, flags = 0, reportsIntegrity = true): Aircraft {
  return {
    id: `aircraft:${hex}`,
    kind: 'aircraft',
    lon,
    lat,
    ts: 0,
    flags,
    props: {
      hex,
      callsign: null,
      registration: null,
      type: null,
      category: null,
      squawk: null,
      source: 'adsb',
      nic: 8,
      nacP: 10,
      gpsLost: false,
      reportsIntegrity,
    },
  }
}

describe('GPS interference map', () => {
  const T0 = Date.parse('2026-10-06T10:00:00Z')

  it('counts distinct aircraft per cell, healthy and degraded', () => {
    const map = new GpsInterferenceMap()
    map.observe([aircraft('a', 24.1, 56.95), aircraft('b', 24.12, 56.96, Flag.GPS_DEGRADED)], T0)
    // The same two aircraft ten seconds later must not be counted twice.
    map.observe([aircraft('a', 24.13, 56.95), aircraft('b', 24.14, 56.96, Flag.GPS_DEGRADED)], T0 + 10_000)

    const [cell] = map.view()
    expect(map.view()).toHaveLength(1)
    expect(cell).toMatchObject({ good: 1, bad: 1 })
    expect(cell.boundary).toHaveLength(7)
    expect(cell.boundary[0]).toEqual(cell.boundary[6])
  })

  it('remembers that an aircraft had trouble in a cell even after it recovers there', () => {
    const map = new GpsInterferenceMap()
    map.observe([aircraft('a', 24.1, 56.95, Flag.GPS_DEGRADED)], T0)
    map.observe([aircraft('a', 24.11, 56.95)], T0 + 10_000)
    expect(map.view()[0]).toMatchObject({ good: 0, bad: 1 })
  })

  it('ignores aircraft on the ground and those that report no integrity at all', () => {
    const map = new GpsInterferenceMap()
    map.observe(
      [aircraft('ground', 24.1, 56.95, Flag.ON_GROUND | Flag.GPS_DEGRADED), aircraft('old', 24.1, 56.95, 0, false)],
      T0,
    )
    expect(map.view()).toEqual([])
  })

  it('forgets sightings older than the window', () => {
    const map = new GpsInterferenceMap()
    map.observe([aircraft('a', 24.1, 56.95, Flag.GPS_DEGRADED)], T0)
    map.observe([aircraft('b', 21.0, 56.5)], T0 + 91 * 60_000)
    const cells = map.view()
    expect(cells).toHaveLength(1)
    expect(cells[0]).toMatchObject({ good: 1, bad: 0 })
    expect(map.windowStart).toBe(T0 + 60_000)
  })

  it('is served as a feed that leans on the aircraft feed', async () => {
    const aircraftFeed: FeedDef = {
      id: 'aircraft',
      title: 'Aircraft',
      origins: [],
      ttlMs: 10_000,
      staleMs: 60_000,
      attribution: [],
      load: async () => ({ shape: 'entities', entities: [] }),
    }
    let asked = 0
    const cache = new FeedCache({
      log: () => {},
      resolve: (id) => {
        asked += 1
        return id === 'aircraft' ? aircraftFeed : undefined
      },
    })
    const { snapshot } = await cache.get(gpsHexFeed)
    expect(asked).toBe(1)
    expect(snapshot.payload.shape).toBe('cells')
  })
})

describe('normaliseWarnings', () => {
  const feed = fixture<CapFeed>('warnings.meteoalarm.json')

  it('keeps only what is in force, and only the newest revision of each warning', () => {
    // During the fog warning of 1–2 October: an Alert and a later Update describe the same warning.
    const during = normaliseWarnings(feed, Date.parse('2026-10-02T04:00:00Z'))
    expect(during).toHaveLength(1)
    expect(during[0]).toMatchObject({ type: 'Fog', level: 'yellow' })
    // The Update pushed the end from 10:00 to 13:00 local time.
    expect(new Date(during[0].expires).toISOString()).toBe('2026-10-02T10:00:00.000Z')
  })

  it('turns CAP outlines into simplified lon/lat rings', () => {
    const [fog] = normaliseWarnings(feed, Date.parse('2026-10-02T04:00:00Z'))
    expect(fog.areas).toHaveLength(2)
    expect(fog.polygons.length).toBeGreaterThanOrEqual(2)
    for (const ring of fog.polygons) {
      expect(ring.length).toBeGreaterThanOrEqual(4)
      expect(ring.length).toBeLessThan(60)
      for (const [lon, lat] of ring) {
        expect(lon).toBeGreaterThan(20.9)
        expect(lon).toBeLessThan(28.3)
        expect(lat).toBeGreaterThan(55.6)
        expect(lat).toBeLessThan(58.1)
      }
    }
  })

  it('keeps sea-area warnings, which have names but no outlines', () => {
    const now = normaliseWarnings(feed, Date.parse('2026-10-06T10:00:00Z'))
    expect(now).toHaveLength(1)
    expect(now[0]).toMatchObject({ type: 'Wind', level: 'yellow', polygons: [] })
    expect(now[0].areas).toContain('Southern Gulf of Riga')
  })

  it('drops everything once it has expired, and ignores tests and cancellations', () => {
    expect(normaliseWarnings(feed, Date.parse('2026-10-08T00:00:00Z'))).toEqual([])
    const tampered: CapFeed = {
      warnings: feed.warnings!.map((w) => ({ ...w, alert: { ...w.alert, status: 'Test' } })),
    }
    expect(normaliseWarnings(tampered, Date.parse('2026-10-06T10:00:00Z'))).toEqual([])
    expect(normaliseWarnings({}, 0)).toEqual([])
  })
})

describe('normaliseStations', () => {
  const { points, observations } = fixture<{ points: RawStationPoint[]; observations: RawObservation[] }>(
    'stations.lvgmc.json',
  )

  it('joins each station with its newest observation', () => {
    const stations = normaliseStations(points, observations)
    expect(stations).toHaveLength(3)
    const riga = stations.find((station) => station.props.code === 'RIGASLU')!
    expect(riga).toMatchObject({ id: 'station:RIGASLU', kind: 'station', label: '17°' })
    expect(riga.lon).toBeCloseTo(24.116, 3)
    expect(new Date(riga.ts).toISOString()).toBe('2026-10-06T10:00:00.000Z')
    expect(riga.props).toMatchObject({ tempC: 16.6, windMs: 6.4, windDir: 317, humidity: 60, visibilityM: 20000 })
  })

  it('reads missing values as unknown rather than zero', () => {
    const [station] = normaliseStations(
      [{ kods: 'X', nosaukums: 'Test', lon: '24', lat: '57' }],
      [{ station_code: 'X', time: '2026.10.06 10:00:00', air_temperature_actual: null, wind_speed_actual: '3.5', precipitation: '' }],
    )
    expect(station.label).toBe('–')
    expect(station.props).toMatchObject({ tempC: null, precipMm: null, windMs: 3.5, elevationM: null })
  })

  it('leaves out points that report neither temperature nor wind', () => {
    const stations = normaliseStations(
      [{ kods: 'X', lon: '24', lat: '57' }],
      [{ station_code: 'X', time: '2026.10.06 10:00:00', precipitation: '1.2' }],
    )
    expect(stations).toEqual([])
  })

  it('leaves out stations with no observation or no position', () => {
    expect(normaliseStations(points, [])).toEqual([])
    expect(normaliseStations([{ kods: 'RIGASLU', lon: 'x', lat: '57' }], observations)).toEqual([])
  })
})

describe('normaliseFires', () => {
  const CSV = [
    'latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,confidence,version,bright_ti5,frp,daynight',
    '56.91234,24.56789,331.2,0.39,0.36,2026-10-06,45,N,n,2.0NRT,290.1,4.82,N',
    '48.5,2.3,340,0.4,0.4,2026-10-06,1130,N,h,2.0NRT,295,12.5,D',
    '57.5,26.1,345.9,0.4,0.4,2026-10-06,1042,N,h,2.0NRT,296,25.0,D',
    'broken,row',
  ].join('\n')
  const LATVIA = [20.4, 55.3, 28.7, 58.4] as const

  it('keeps detections inside the box and reads their details', () => {
    const fires = normaliseFires(CSV, LATVIA)
    expect(fires).toHaveLength(2)
    expect(fires[0]).toMatchObject({ kind: 'fire', lon: 24.56789, lat: 56.91234 })
    expect(fires[0].props).toMatchObject({ frpMw: 4.82, brightnessK: 331.2, confidence: 'nominal', night: true })
    // "45" means 00:45 UTC.
    expect(new Date(fires[0].ts).toISOString()).toBe('2026-10-06T00:45:00.000Z')
    expect(new Date(fires[1].ts).toISOString()).toBe('2026-10-06T10:42:00.000Z')
    expect(fires[1].props.confidence).toBe('high')
  })

  it('copes with an empty file or unexpected columns', () => {
    expect(normaliseFires('', LATVIA)).toEqual([])
    expect(normaliseFires('lat,lon\n56,24', LATVIA)).toEqual([])
  })
})

describe('simplify', () => {
  it('drops points that add nothing and keeps the corners', () => {
    const line: [number, number][] = [
      [0, 0],
      [1, 0.0001],
      [2, 0],
      [2, 2],
      [0, 2],
    ]
    expect(simplify(line, 0.01)).toEqual([
      [0, 0],
      [2, 0],
      [2, 2],
      [0, 2],
    ])
    expect(simplify(line, 0)).toEqual(line)
  })
})
