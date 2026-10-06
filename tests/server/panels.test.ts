import { describe, expect, it } from 'vitest'
import { normaliseEnergy, normaliseInternet } from '../../shared/adapters/panels'
import { normaliseGauges, normaliseRadiation } from '../../shared/adapters/sensors'
import { radiationRule } from '../../shared/alerts/rules'

const T0 = Date.parse('2026-10-06T11:00:00Z')
const HOUR = 3600

describe('power system', () => {
  // Shapes as returned by api.energy-charts.info on 2026-10-06; the newest hour is not filled in yet.
  const power = {
    unix_seconds: [T0 / 1000 - 2 * HOUR, T0 / 1000 - HOUR],
    production_types: [
      { name: 'Cross border electricity trading', data: [204.1, null] },
      { name: 'Hydro Run-of-River', data: [291, null] },
      { name: 'Fossil gas', data: [0, null] },
      { name: 'Solar', data: [320, null] },
      { name: 'Load', data: [1003, null] },
      { name: 'Renewable share of load', data: [78.6, null] },
    ],
  }
  const flows = { unix_seconds: [1, 2], countries: [{ name: 'Estonia', data: [0.556, null] }, { name: 'Lithuania', data: [-0.1, -0.173] }, { name: 'sum', data: [0.4, 0.3] }] }
  const prices = { unix_seconds: [T0 / 1000 - 900, T0 / 1000, T0 / 1000 + 900], price: [5, 3.95, 262.72] }

  it('reads the newest complete hour, the flows and the price in force', () => {
    expect(normaliseEnergy(power, flows, prices, T0 + 60_000)).toEqual({
      at: T0 - 2 * HOUR * 1000,
      loadMw: 1003,
      generationMw: 611,
      importMw: 204.1,
      mix: [
        { source: 'Solar', mw: 320 },
        { source: 'Hydro Run-of-River', mw: 291 },
      ],
      flows: [
        { country: 'Estonia', mw: 556 },
        { country: 'Lithuania', mw: -173 },
      ],
      price: { now: 3.95, low: 3.95, high: 262.72 },
    })
  })

  it('reports what it has when a source is missing', () => {
    expect(normaliseEnergy(null, null, prices, T0)).toMatchObject({ at: null, loadMw: null, mix: [], flows: [], price: { now: 3.95 } })
  })
})

describe('internet reachability', () => {
  it('compares the plain counts with their own median and ignores the rest', () => {
    const series = (datasource: string, values: unknown[]) => ({ datasource, values })
    const ioda = { data: [[series('bgp', [7354, 7354, null, 7354, 7350, 7354, 3000]), series('gtr-sarima', [{}, {}, {}, {}, {}, {}]), series('ping-slash24', [1, 2])]] }
    expect(normaliseInternet(ioda)).toEqual([{ id: 'bgp', label: 'Networks announced (BGP)', latest: 3000, baseline: 7354 }])
  })
})

describe('sensors', () => {
  it('reads radiation stations and alerts on a raised one', () => {
    const feature = (id: string, value: number) => ({
      geometry: { coordinates: [26.54, 55.73] as [number, number] },
      properties: { id, name: id === 'LV0001' ? 'Demene' : 'Elsewhere', value, end_measure: '2026-10-06T10:00:00Z' },
    })
    const stations = normaliseRadiation({ features: [feature('LV0001', 0.079), feature('LV0002', 0.41), { geometry: {}, properties: {} }] })
    expect(stations).toMatchObject([
      { id: 'radiation:LV0001', label: 'Demene', ts: T0 - HOUR * 1000, props: { usvh: 0.079 } },
      { id: 'radiation:LV0002', props: { usvh: 0.41 } },
    ])
    const alerts = radiationRule.evaluate({ now: T0, entities: () => stations, warnings: () => [], news: () => [], insideLatvia: () => true })
    expect(alerts).toMatchObject([{ severity: 'critical', title: 'Raised radiation: Elsewhere', entityId: 'radiation:LV0002' }])
  })

  it('reads gauges, in metres whatever the unit', () => {
    const gauges = normaliseGauges(
      [
        { id: 104, name: 'Abava, Renda', lat: 57.07, lon: 22.29, ts: [{ name: 'Ūdens līmenis', value: '1.06', unit: 'm', last_date: '2026-10-06 10:50:00' }] },
        {
          id: 7,
          name: 'Liepāja',
          lat: 56.5,
          lon: 21,
          ts: [
            { name: 'Piekrastes ūdens līmenis', value: '512', unit: 'cm', last_date: '2026-10-06 10:00:00' },
            { name: 'Piekrastes ūdens temperatūra', value: '12.4', unit: 'C', last_date: '2026-10-06 10:00:00' },
          ],
        },
        { id: 9, name: 'Nothing measured', lat: 57, lon: 24, ts: [] },
      ],
      T0,
    )
    expect(gauges).toMatchObject([
      { id: 'gauge:104', ts: Date.parse('2026-10-06T10:50:00Z'), props: { levelM: 1.06, tempC: null, coastal: false } },
      { id: 'gauge:7', props: { levelM: 5.12, tempC: 12.4, coastal: true } },
    ])
  })
})
