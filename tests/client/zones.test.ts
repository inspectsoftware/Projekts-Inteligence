import type { FeatureCollection, MultiPolygon } from 'geojson'
import type { Map as MapLibreMap } from 'maplibre-gl'
import { describe, expect, it } from 'vitest'
import type { Zone } from '../../shared/feeds'
import { militarySitesLayer, seaExerciseAreasLayer, siteSelection } from '../../src/layers/military'
import { seaWarningsLayer, zoneSelection } from '../../src/layers/zones'
import { ingest } from '../../src/runtime/entityStore'

const exercise: Zone = {
  id: 'sea:kaliningrad-227-26',
  kind: 'sea',
  type: 'Naval exercise',
  title: 'South-eastern Baltic · area BR-161',
  text: 'SOUTHEASTERN BALTIC\nSHIPS EXERCISES IN AREA BR-161',
  from: Date.parse('2026-09-30T21:00:00Z'),
  to: Date.parse('2026-10-31T21:00:00Z'),
  rings: [],
  point: [19.85, 55.1],
  issuer: 'Kaliningrad NAV WARN 227/26, via BALTICO',
  href: 'https://navvarn.sjofartsverket.se/en/Navigationsvarningar/Navtex',
  military: true,
}

describe('a zone in the inspector', () => {
  it('gives its validity in Rīga time, across the change to winter time', () => {
    const { model, lon, lat } = zoneSelection(exercise, [19.9, 55.12], Date.parse('2026-10-06T16:00:00Z'))
    expect([lon, lat]).toEqual([19.9, 55.12])
    expect(model).toMatchObject({ kicker: 'Sea warning', title: exercise.title, subtitle: exercise.issuer })
    expect(model.badges).toEqual([
      { text: 'Naval exercise', tone: 'mil' },
      { text: 'In force', tone: 'warn' },
    ])
    // 21:00 UTC is midnight in Rīga in summer and 23:00 once the clocks have gone back.
    expect(model.rows).toEqual([
      { label: 'From (Rīga)', value: 'Thu, 1 Oct 2026, 00:00' },
      { label: 'Until (Rīga)', value: 'Sat, 31 Oct 2026, 23:00' },
      { label: 'Notice', value: 'SOUTHEASTERN BALTIC · SHIPS EXERCISES IN AREA BR-161' },
    ])
    expect(model.links).toEqual([{ label: 'Official page', href: exercise.href }])
  })

  it('says so when a zone is still to come, or has no end', () => {
    const routine = { ...exercise, military: false, type: 'Navigation aid', from: null, to: null }
    expect(zoneSelection(exercise, [0, 0], Date.parse('2026-09-29T00:00:00Z')).model.badges[1]).toEqual({ text: 'Not yet in force', tone: 'info' })
    const { model } = zoneSelection(routine, [0, 0], 0)
    expect(model.badges[0]).toEqual({ text: 'Navigation aid', tone: 'info' })
    expect(model.rows.slice(0, 2).map((row) => row.value)).toEqual(['Not stated', 'Until withdrawn'])
  })

  it('does not call a zone in force outside its hours, or when its times could not be read', () => {
    const night = Date.parse('2026-10-06T23:30:00Z')
    const daily = zoneSelection({ ...exercise, schedule: 'DAILY 0500-1500' }, [0, 0], night).model
    expect(daily.badges[1]).toEqual({ text: 'Outside its hours', tone: 'info' })
    expect(daily.rows[2]).toEqual({ label: 'Hours (UTC)', value: 'DAILY 0500-1500' })
    expect(zoneSelection({ ...exercise, schedule: 'MON-FRI 0500-1500' }, [0, 0], night).model.badges[1].text).toBe('See notice for times')
    expect(zoneSelection({ ...exercise, unsure: true }, [0, 0], night).model.badges[1].text).toBe('See notice for times')
  })
})

describe('the zone layers on the map', () => {
  const NOW = Date.parse('2026-10-06T16:00:00Z')
  const square = (west: number, size: number): [number, number][] => [
    [west, 55],
    [west + size, 55],
    [west + size, 55 + size],
    [west, 55 + size],
  ]

  it('hands the map closed outlines, small on top of large, and nothing that has run out', () => {
    let drawn: FeatureCollection | null = null
    const layers: string[] = []
    // As much of the map as a layer touches.
    const map = {
      getSource: () => ({ setData: (data: FeatureCollection) => (drawn = data) }),
      addSource: () => {},
      removeSource: () => {},
      getLayer: (id: string) => layers.includes(id),
      addLayer: (spec: { id: string }) => layers.push(spec.id),
      removeLayer: (id: string) => layers.splice(layers.indexOf(id), 1),
    } as unknown as MapLibreMap

    ingest({
      id: 'navwarn',
      updatedAt: NOW,
      payload: {
        shape: 'zones',
        zones: [
          { ...exercise, id: 'small', rings: [square(19.2, 0.2)] },
          { ...exercise, id: 'large', rings: [square(19, 1)], from: NOW + 3_600_000 },
          { ...exercise, id: 'over', to: NOW - 1 },
          { ...exercise, id: 'position', military: false },
          { ...exercise, id: 'text', point: null },
        ],
      },
    })
    seaWarningsLayer.native!.show(map)
    expect(layers).toHaveLength(4)
    seaWarningsLayer.update!(NOW)

    const features = drawn!.features
    expect(features.map((feature) => [feature.properties!.id, feature.geometry.type, feature.properties!.active])).toEqual([
      ['large', 'MultiPolygon', false],
      ['small', 'MultiPolygon', true],
      ['position', 'Point', true],
    ])
    const [ring] = (features[1].geometry as MultiPolygon).coordinates[0]
    expect(ring).toHaveLength(5)
    expect(ring[0]).toEqual(ring[4])

    // A click hands back the feature's properties; the layer finds the zone they belong to.
    expect(seaWarningsLayer.native!.pick!({ id: 'small' }, 19.3, 55.1)).toMatchObject({ lon: 19.3, lat: 55.1, model: { title: exercise.title } })
    expect(seaWarningsLayer.native!.pick!({ id: 'gone' }, 0, 0)).toBeNull()
    seaWarningsLayer.native!.hide()
    expect(layers).toEqual([])

    // Several notices for one area: the last drawn is the one a click reaches, so the military one in force goes last.
    const same = (id: string, patch: Partial<Zone>): Zone => ({ ...exercise, id, rings: [square(19, 1)], ...patch })
    ingest({
      id: 'navwarn',
      updatedAt: NOW + 1,
      payload: {
        shape: 'zones',
        zones: [
          same('military-now', {}),
          same('military-tomorrow', { from: NOW + 86_400_000 }),
          same('routine-now', { military: false }),
          same('military-off-hours', { schedule: 'DAILY 0500-1500' }),
        ],
      },
    })
    seaWarningsLayer.native!.show(map)
    seaWarningsLayer.update!(NOW)
    expect(drawn!.features.map((feature) => feature.properties!.id)).toEqual(['military-tomorrow', 'military-off-hours', 'routine-now', 'military-now'])
    expect(drawn!.features.map((feature) => feature.properties!.active)).toEqual([false, false, true, true])
    seaWarningsLayer.native!.hide()
  })

  it('puts the standing sea areas beneath the zones announced for today, whichever is switched on first', () => {
    const added: [string, string | undefined][] = []
    const map = {
      getSource: () => undefined,
      addSource: () => {},
      removeSource: () => {},
      getLayer: () => undefined,
      getLayersOrder: () => ['water', 'ref-port', 'zones-airspace-fill', 'zones-airspace-outline'],
      addLayer: (spec: { id: string }, before?: string) => added.push([spec.id, before]),
      removeLayer: () => {},
    } as unknown as MapLibreMap
    seaExerciseAreasLayer.native!.show(map)
    militarySitesLayer.native!.show(map)
    expect(added).toEqual([
      ['sea-exercise-areas-fill', 'zones-airspace-fill'],
      ['sea-exercise-areas-outline', 'zones-airspace-fill'],
      // Markers stay on top.
      ['mil-sites-mark', undefined],
      ['mil-sites-label', undefined],
    ])
    seaExerciseAreasLayer.native!.hide()
    militarySitesLayer.native!.hide()
  })
})

describe('a military site in the inspector', () => {
  const site = {
    name: 'Lielvārde Air Base',
    country: 'LV',
    kind: 'air',
    operator: 'Latvian Air Force',
    note: 'Military air base (ICAO: EVGA).',
    source: 'https://en.wikipedia.org/wiki/Lielv%C4%81rde_Air_Base',
  }

  it('names its source and links to it', () => {
    const { model } = siteSelection(site, 24.8533, 56.7783)
    expect(model).toMatchObject({ kicker: 'Air base', title: 'Lielvārde Air Base', subtitle: 'Latvia', badges: [] })
    expect(model.rows.map((row) => row.label)).toEqual(['Operator', 'What the source says', 'Position'])
    expect(model.links).toEqual([{ label: 'Source: Wikipedia', href: site.source }])
  })

  it('flags a marker that stands on a town, and never links anywhere but the web', () => {
    const { model } = siteSelection({ ...site, operator: undefined, approx: true, source: 'javascript:alert(1)' }, 0, 0)
    expect(model.badges).toEqual([{ text: 'Marker is approximate', tone: 'warn' }])
    expect(model.rows.map((row) => row.label)).toEqual(['What the source says', 'Position'])
    expect(model.links).toEqual([])
  })
})
