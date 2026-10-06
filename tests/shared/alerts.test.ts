import { readFileSync } from 'node:fs'
import type { FeatureCollection, Polygon } from 'geojson'
import { describe, expect, it } from 'vitest'
import { type AlertInput, AlertEngine, type AlertRule } from '../../shared/alerts/engine'
import {
  RULES,
  emergencyRule,
  gpsInterferenceRule,
  militaryInsideRule,
  militaryZoneRule,
  watchedAircraftRule,
  weatherWarningRule,
} from '../../shared/alerts/rules'
import { type Aircraft, type Entity, Flag } from '../../shared/entity'
import type { WeatherWarning, Zone } from '../../shared/feeds'
import { createRegionTest, pointInRing } from '../../shared/geo/pip'

const border = JSON.parse(
  readFileSync(new URL('../../public/data/lv-border.json', import.meta.url), 'utf8'),
) as FeatureCollection<Polygon>
const insideLatvia = createRegionTest(border.features.map((feature) => feature.geometry))

const RIGA = { lon: 24.105, lat: 56.949 }
const VILNIUS = { lon: 25.28, lat: 54.687 }

function aircraft(hex: string, at: { lon: number; lat: number }, flags = 0, squawk: string | null = null): Aircraft {
  return {
    id: `aircraft:${hex}`,
    kind: 'aircraft',
    ...at,
    label: hex.toUpperCase(),
    ts: 0,
    flags,
    props: {
      hex,
      callsign: hex.toUpperCase(),
      registration: 'YL-TST',
      type: 'B738',
      category: 'A3',
      squawk,
      source: 'adsb',
      nic: 8,
      nacP: 10,
      gpsLost: false,
      reportsIntegrity: true,
      role: null,
      description: null,
      operator: null,
    },
  }
}

const input = (entities: Entity[], now = 0, warnings: WeatherWarning[] = []): AlertInput => ({
  now,
  entities: (slot) => (slot === 'aircraft' ? entities : []),
  warnings: () => warnings,
  news: () => [],
  insideLatvia,
})

describe('point in polygon', () => {
  const square = [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
    [0, 0],
  ]
  const hole = [
    [4, 4],
    [6, 4],
    [6, 6],
    [4, 6],
    [4, 4],
  ]

  it('tells inside from outside', () => {
    expect(pointInRing(5, 5, square)).toBe(true)
    expect(pointInRing(15, 5, square)).toBe(false)
    expect(pointInRing(5, -1, square)).toBe(false)
  })

  it('respects holes and multiple polygons', () => {
    const test = createRegionTest([
      { type: 'Polygon', coordinates: [square, hole] },
      { type: 'MultiPolygon', coordinates: [[[[20, 20], [22, 20], [22, 22], [20, 22], [20, 20]]]] },
    ])
    expect(test(2, 2)).toBe(true)
    expect(test(5, 5)).toBe(false)
    expect(test(21, 21)).toBe(true)
    expect(test(15, 15)).toBe(false)
  })

  it('places real towns on the right side of the baked Latvian border', () => {
    expect(insideLatvia(RIGA.lon, RIGA.lat)).toBe(true)
    expect(insideLatvia(26.53, 55.875)).toBe(true) // Daugavpils
    expect(insideLatvia(21.01, 56.51)).toBe(true) // Liepāja
    expect(insideLatvia(VILNIUS.lon, VILNIUS.lat)).toBe(false)
    expect(insideLatvia(24.75, 59.44)).toBe(false) // Tallinn
    expect(insideLatvia(23.5, 57.6)).toBe(false) // open water in the Gulf of Rīga
  })
})

describe('rules', () => {
  it('raises an emergency wherever the aircraft is', () => {
    const [alert] = emergencyRule.evaluate(input([aircraft('aaa111', VILNIUS, Flag.EMERGENCY, '7700')]))
    expect(alert).toMatchObject({
      key: 'emergency:aircraft:aaa111',
      severity: 'critical',
      detail: 'Squawk 7700: general emergency',
      entityId: 'aircraft:aaa111',
    })
    expect(emergencyRule.evaluate(input([aircraft('bbb222', RIGA)]))).toEqual([])
  })

  it('reports military aircraft only when airborne inside the border', () => {
    const over = aircraft('mil001', RIGA, Flag.MIL)
    const abroad = aircraft('mil002', VILNIUS, Flag.MIL)
    const parked = aircraft('mil003', RIGA, Flag.MIL | Flag.ON_GROUND)
    const alerts = militaryInsideRule.evaluate(input([over, abroad, parked]))
    expect(alerts.map((alert) => alert.key)).toEqual(['military:aircraft:mil001'])
    expect(alerts[0].detail).toBe('B738 · YL-TST')
  })

  it('lists reconnaissance, early-warning and tanker aircraft quietly while they are airborne, wherever that is', () => {
    const withRole = (hex: string, role: Aircraft['props']['role'], flags: number = Flag.MIL): Aircraft => {
      const base = aircraft(hex, VILNIUS, flags)
      return { ...base, props: { ...base.props, role } }
    }
    const alerts = watchedAircraftRule.evaluate(
      input([
        withRole('tank01', 'tanker'),
        withRole('isr001', 'isr'),
        withRole('ftr001', 'fighter'),
        withRole('awx001', 'aew', Flag.MIL | Flag.ON_GROUND),
        withRole('unk001', null),
      ]),
    )
    expect(alerts.map((alert) => [alert.severity, alert.title])).toEqual([
      ['info', 'Tanker airborne: TANK01'],
      ['info', 'ISR / SIGINT airborne: ISR001'],
    ])
    expect(alerts[0]).toMatchObject({ key: 'watched:aircraft:tank01', entityId: 'aircraft:tank01', detail: 'B738 · YL-TST' })
  })

  it('calls it GPS interference only when several aircraft over Latvia are affected', () => {
    const degraded = (hex: string, lon: number) => aircraft(hex, { lon, lat: 56.9 }, Flag.GPS_DEGRADED)
    expect(gpsInterferenceRule.evaluate(input([degraded('a', 24), degraded('b', 25)]))).toEqual([])

    const [alert] = gpsInterferenceRule.evaluate(
      input([degraded('a', 24), degraded('b', 25), degraded('c', 26), aircraft('d', VILNIUS, Flag.GPS_DEGRADED)]),
    )
    expect(alert).toMatchObject({ key: 'gps-interference:latvia', detail: '3 aircraft reporting degraded or lost GPS' })
    expect(alert.at!.lon).toBeCloseTo(25)
  })
})

describe('weather warning rule', () => {
  const warning = (patch: Partial<WeatherWarning>): WeatherWarning => ({
    id: 'w1',
    type: 'Wind',
    level: 'yellow',
    description: '',
    onset: Date.parse('2026-10-05T06:00:00Z'),
    expires: Date.parse('2026-10-06T22:00:00Z'),
    sent: 0,
    areas: ['Gulf of Riga East', 'Gulf of Riga West', 'Southern Gulf of Riga'],
    polygons: [],
    ...patch,
  })
  const NOW = Date.parse('2026-10-06T10:00:00Z')

  it('lists a yellow warning quietly, with where and until when', () => {
    const [alert] = weatherWarningRule.evaluate(input([], NOW, [warning({})]))
    expect(alert).toMatchObject({
      severity: 'info',
      title: 'Wind warning (yellow)',
      detail: 'Gulf of Riga East, Gulf of Riga West +1 · until Wed 01:00',
    })
    // A sea area has no outline, so the alert has nowhere to fly to.
    expect(alert.at).toBeUndefined()
  })

  it('escalates orange and red, and points at the affected area', () => {
    const land = warning({
      level: 'red',
      type: 'Rain',
      areas: ['Riga'],
      onset: Date.parse('2026-10-06T15:00:00Z'),
      polygons: [[[24, 56.8], [24.4, 56.8], [24.4, 57.1], [24, 57.1]]],
    })
    const [alert] = weatherWarningRule.evaluate(input([], NOW, [land]))
    expect(alert).toMatchObject({ severity: 'critical', title: 'Rain warning (red)', detail: 'Riga · from Tue 18:00' })
    expect(alert.at!.lon).toBeCloseTo(24.2)
    expect(weatherWarningRule.evaluate(input([], NOW, [warning({ level: 'orange' })]))[0].severity).toBe('warn')
  })
})

describe('military zone rule', () => {
  const NOW = Date.parse('2026-10-06T16:00:00Z')
  const zone = (patch: Partial<Zone>): Zone => ({
    id: 'sea:baltic-sea-29-26',
    kind: 'sea',
    type: 'Naval exercise',
    title: 'Central Baltic',
    text: '',
    from: Date.parse('2026-10-02T21:00:00Z'),
    to: Date.parse('2026-10-10T21:00:00Z'),
    // BALTIC SEA NAV WARN 029/26: west of Ventspils, its eastern corner inside Latvia's economic zone.
    rings: [[[20.0933, 57.625], [20.5917, 57.4517], [19.935, 56.9], [19.4317, 57.0817]]],
    point: [20.0129, 57.2646],
    issuer: 'Baltic Sea NAV WARN 029/26, via BALTICO',
    href: 'https://navvarn.sjofartsverket.se/en/Navigationsvarningar/Navtex',
    military: true,
    ...patch,
  })
  const alertsFor = (...zones: Zone[]) => militaryZoneRule.evaluate({ ...input([], NOW), zones: () => zones })

  it('reports an exercise area that reaches into Latvian waters, and only while it is in force', () => {
    expect(alertsFor(zone({}))).toEqual([
      {
        key: 'military-zone:sea',
        severity: 'info',
        title: 'Exercise or danger area in Latvian waters',
        detail: 'Naval exercise · Central Baltic',
        at: { lon: 20.0129, lat: 57.2646 },
      },
    ])
    expect(alertsFor(zone({ from: NOW + 3_600_000 }))).toEqual([])
    expect(alertsFor(zone({ military: false }))).toEqual([])
    // Off Kaliningrad: announced, but not Latvia's waters.
    expect(alertsFor(zone({ rings: [[[19.755, 55.1583], [20, 55.1583], [20, 55.0333], [19.66, 55.0333]]], point: [19.8537, 55.0958] }))).toEqual([])
    // A notice with no position cannot be placed anywhere.
    expect(alertsFor(zone({ rings: [], point: null }))).toEqual([])
    expect(militaryZoneRule.evaluate(input([], NOW))).toEqual([])
  })

  it('stays quiet about an area outside its daily hours, or with times that could not be read', () => {
    // LGS A5397/26: valid for a fortnight, but only "DAILY 0500-1500".
    const cekule = zone({ id: 'air:lv:A5397/26', kind: 'air', type: 'Restricted area', title: 'EVR490', schedule: 'DAILY 0500-1500' })
    const at = (time: string) => militaryZoneRule.evaluate({ ...input([], Date.parse(time)), zones: () => [cekule] })
    expect(at('2026-10-06T12:00:00Z')).toHaveLength(1)
    expect(at('2026-10-06T16:30:00Z')).toEqual([])
    expect(at('2026-10-06T23:30:00Z')).toEqual([])
    expect(alertsFor(zone({ unsure: true }))).toEqual([])
  })

  it('sums up activated military airspace over Latvia in one alert', () => {
    const air = (id: string, title: string, patch: Partial<Zone> = {}) =>
      zone({ id, kind: 'air', type: 'Restricted area', title, rings: [], point: null, ...patch })
    const alerts = alertsFor(
      air('air:lv:A5651/26', 'EVR69A PLISUNS1', { point: [27.86, 56.36] }),
      air('air:lv:A5650/26', 'EVR68A SIVERS1'),
      // No outline in the AIP, but a Latvian NOTAM all the same.
      air('air:lv:A5470/26', 'EVD457', { type: 'Danger area' }),
      air('air:lv:A3951/26', 'RIGA FIR', { type: 'GNSS interference' }),
      air('air:ee:A2858/26', 'EED5 (KILTSI)', { type: 'Danger area' }),
    )
    expect(alerts).toEqual([
      {
        key: 'military-zone:air',
        severity: 'info',
        title: 'Military airspace active over Latvia',
        detail: '3 notices · EVR69A PLISUNS1, EVR68A SIVERS1 +1',
        at: { lon: 27.86, lat: 56.36 },
      },
    ])
  })
})

describe('AlertEngine', () => {
  const mil = aircraft('mil001', RIGA, Flag.MIL)

  it('raises once, however often the condition is seen', () => {
    const engine = new AlertEngine(RULES)
    const first = engine.evaluate(input([mil], 0))
    expect(first.raised).toHaveLength(1)
    expect(first.changed).toBe(true)

    const second = engine.evaluate(input([mil], 10_000))
    expect(second.raised).toHaveLength(0)
    expect(second.changed).toBe(false)
    expect(second.alerts[0].raisedAt).toBe(0)
    expect(second.alerts[0].seenAt).toBe(10_000)
  })

  it('withdraws an alert only after the condition has been absent long enough', () => {
    const engine = new AlertEngine(RULES)
    engine.evaluate(input([mil], 0))

    // One poll without the aircraft: still active.
    const blip = engine.evaluate(input([], 10_000))
    expect(blip.alerts).toHaveLength(1)
    expect(blip.changed).toBe(false)

    // It comes back: same alert, no second "raised".
    expect(engine.evaluate(input([mil], 20_000)).raised).toHaveLength(0)

    const gone = engine.evaluate(input([], 70_000))
    expect(gone.cleared).toHaveLength(1)
    expect(gone.alerts).toHaveLength(0)
    expect(gone.changed).toBe(true)
  })

  it('reports a change when the wording of an active alert changes', () => {
    const counting: AlertRule = {
      id: 'count',
      clearAfterMs: 0,
      evaluate: ({ entities }) => [
        { key: 'count', severity: 'info', title: 'Count', detail: `${entities('aircraft').length} aircraft` },
      ],
    }
    const engine = new AlertEngine([counting])
    engine.evaluate(input([mil], 0))
    const next = engine.evaluate(input([mil, aircraft('x', RIGA)], 1000))
    expect(next.changed).toBe(true)
    expect(next.alerts[0].detail).toBe('2 aircraft')
  })

  it('lists the most severe first, then the most recent', () => {
    const engine = new AlertEngine(RULES)
    engine.evaluate(input([mil], 0))
    const { alerts } = engine.evaluate(
      input([mil, aircraft('mil002', { lon: 25.5, lat: 57 }, Flag.MIL), aircraft('emg001', VILNIUS, Flag.EMERGENCY, '7600')], 5000),
    )
    expect(alerts.map((alert) => alert.key)).toEqual([
      'emergency:aircraft:emg001',
      'military:aircraft:mil002',
      'military:aircraft:mil001',
    ])
  })
})
