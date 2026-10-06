import { readFileSync } from 'node:fs'
import type { FeatureCollection, Polygon } from 'geojson'
import { describe, expect, it } from 'vitest'
import { type AlertInput, AlertEngine, type AlertRule } from '../../shared/alerts/engine'
import { RULES, emergencyRule, gpsInterferenceRule, militaryInsideRule, weatherWarningRule } from '../../shared/alerts/rules'
import { type Aircraft, type Entity, Flag } from '../../shared/entity'
import type { WeatherWarning } from '../../shared/feeds'
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
    },
  }
}

const input = (entities: Entity[], now = 0, warnings: WeatherWarning[] = []): AlertInput => ({
  now,
  entities: (slot) => (slot === 'aircraft' ? entities : []),
  warnings: () => warnings,
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
