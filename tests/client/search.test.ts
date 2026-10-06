import { describe, expect, it } from 'vitest'
import { gradeCell } from '../../src/layers/gpsHex'
import { aerodromesLayer, powerLayer, underseaLayer } from '../../src/layers/reference'
import { type SearchItem, fold, rank } from '../../src/lib/search'
import { formatUrlView, parseUrlView } from '../../src/map/urlView'

const item = (title: string, extra: Partial<SearchItem> = {}): SearchItem => ({
  id: title,
  group: 'Place',
  title,
  run: () => {},
  ...extra,
})

describe('search', () => {
  it('ignores case and diacritics', () => {
    expect(fold('Rīga')).toBe('riga')
    expect(fold('Liepāja')).toBe('liepaja')
    expect(fold('Ķegums')).toBe('kegums')
    expect(rank('riga', [item('Rīga'), item('Tallinn')]).map((i) => i.title)).toEqual(['Rīga'])
    expect(rank('JĒKAB', [item('Jēkabpils')])).toHaveLength(1)
  })

  it('puts titles that start with the query ahead of looser matches', () => {
    const results = rank('val', [
      item('Smiltene', { keywords: 'valka district' }),
      item('Lielvārde'),
      item('Jaunā Valka'),
      item('Valmiera'),
    ])
    expect(results.map((i) => i.title)).toEqual(['Valmiera', 'Jaunā Valka', 'Smiltene'])
  })

  it('breaks ties by weight, so the bigger town comes first', () => {
    const results = rank('sa', [item('Sabile', { weight: 3 }), item('Salaspils', { weight: 9 }), item('Saldus', { weight: 6 })])
    expect(results.map((i) => i.title)).toEqual(['Salaspils', 'Saldus', 'Sabile'])
  })

  it('finds things by their keywords, such as a registration', () => {
    const results = rank('yl-aba', [item('BTI4EK', { keywords: 'YL-ABA 502d1a BCS3' }), item('RYR12')])
    expect(results.map((i) => i.title)).toEqual(['BTI4EK'])
  })

  it('returns nothing for an empty query, and no more than the limit', () => {
    const many = Array.from({ length: 50 }, (_, n) => item(`Place ${n}`))
    expect(rank('  ', many)).toEqual([])
    expect(rank('place', many, 12)).toHaveLength(12)
  })
})

describe('gps interference grading', () => {
  it('needs more than one aircraft before it says anything', () => {
    expect(gradeCell({ good: 0, bad: 1 })).toBe('unknown')
    expect(gradeCell({ good: 1, bad: 0 })).toBe('unknown')
  })

  it('discounts a single affected aircraft', () => {
    expect(gradeCell({ good: 9, bad: 1 })).toBe('none')
    expect(gradeCell({ good: 30, bad: 2 })).toBe('some')
    expect(gradeCell({ good: 6, bad: 3 })).toBe('heavy')
    expect(gradeCell({ good: 0, bad: 4 })).toBe('heavy')
  })
})

describe('reference features', () => {
  it('describes an airfield', () => {
    const picked = aerodromesLayer.native!.pick!({ class: 'aerodrome', name: 'Riga International Airport', icao: 'EVRA', iata: 'RIX' }, 23.971, 56.924)!
    expect(picked.model).toMatchObject({ kicker: 'Airfield', title: 'Riga International Airport', subtitle: 'EVRA · RIX' })
    expect(picked.model.rows.map((row) => row.label)).toEqual(['Position', 'MGRS'])
    expect(picked.model.links[0].href).toContain('openstreetmap.org')
    expect(picked).toMatchObject({ lon: 23.971, lat: 56.924 })
  })

  it('marks a military airfield', () => {
    const picked = aerodromesLayer.native!.pick!({ class: 'aerodrome', name: 'Lielvārde', military: 1 }, 24.85, 56.78)!
    expect(picked.model.kicker).toBe('Military airfield')
    expect(picked.model.badges).toEqual([{ text: 'Military', tone: 'mil' }])
  })

  it('describes plants, substations, lines and cables by what they are', () => {
    const pick = powerLayer.native!.pick!
    expect(pick({ class: 'power-plant', name: 'Pļaviņu HES', source: 'hydro', output: '908 MW' }, 25, 56.6)!.model).toMatchObject({
      kicker: 'Power plant',
      subtitle: 'Hydroelectric',
    })
    expect(pick({ class: 'substation', kv: 330 }, 25, 56.6)!.model.rows[0]).toEqual({ label: 'Voltage', value: '330 kV' })
    expect(pick({ class: 'power-line', kv: 110 }, 25, 56.6)!.model.title).toBe('110 kV line')
    expect(underseaLayer.native!.pick!({ class: 'undersea', kind: 'telecom' }, 21, 57.5)!.model.title).toBe('Telecom cable')
  })
})

describe('shareable view links', () => {
  it('round-trips a camera through the address bar', () => {
    const view = { center: [24.1052, 56.9496] as [number, number], zoom: 11.4, bearing: -18, pitch: 48 }
    const hash = formatUrlView(view)
    expect(hash).toBe('#map=11.40/56.9496/24.1052/-18/48')
    expect(parseUrlView(hash)).toEqual(view)
  })

  it('leaves out bearing and pitch when the view is flat and north-up', () => {
    expect(formatUrlView({ center: [23.633, 56.9], zoom: 6.32, bearing: 0, pitch: 0 })).toBe('#map=6.32/56.9000/23.6330')
    expect(parseUrlView('#map=6.32/56.9/23.633')).toEqual({ center: [23.633, 56.9], zoom: 6.32, bearing: 0, pitch: 0 })
  })

  it('finds the view among other fragment parameters and rejects nonsense', () => {
    expect(parseUrlView('#foo=1&map=8/57/24')).toMatchObject({ zoom: 8, center: [24, 57] })
    expect(parseUrlView('')).toBeNull()
    expect(parseUrlView('#map=abc/1/2')).toBeNull()
    expect(parseUrlView('#map=8/123/24')).toBeNull()
    expect(parseUrlView('#map=99/57/24')).toBeNull()
  })
})
