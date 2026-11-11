import { describe, expect, it } from 'vitest'
import { type RoadRow, normaliseCameras, normaliseEeRestrictions, normaliseLtRestrictions, normaliseRoadEvents, normaliseTallinnWorks } from '../../shared/adapters/roads'
import { roadAccidentRule } from '../../shared/alerts/rules'
import { translate } from '../../shared/i18n'

const T0 = Date.parse('2026-10-06T11:00:00Z')
const UNPLANNED = 'public.kafkamessages_notplannedevent_public'
const PLANNED = 'public.kafkamessages_plannedevent_public'
const row = (layer: string, properties: Record<string, unknown>): RoadRow => ({ layer, properties, lon: 24.5, lat: 57.07 })

// Attributes as served by map.transportdata.gov.lv on 2026-10-06.
const accident = row(UNPLANNED, {
  id: 21411,
  restrictions: "['lanesBlocked']",
  event_enum: 'accidentInvolvingHeavyLorries',
  date_from: '2026-10-06 06:15:08.202+00',
  updated: '2026-10-06 08:00:37.525+00',
  linear_reference: 'A7 (36.793km)',
  status: 'ACTIVE',
})
const roadworks = row(PLANNED, {
  id: 3703,
  contractor: 'PA "Igate-Roadeks"',
  restrictions: "['roadPartiallyObstructed']",
  speed_limit: 50,
  event_enum: 'constructionWork',
  date_from: '2026-08-18 05:00:00.1+00',
  date_to: '2026-10-16 14:00:00.1+00',
  linear_reference: 'A8 (60km-76.14km)',
  status: 'ACTIVE',
  geographic_name: 'Pagrieziens uz Lielvircavu - Lietuvas robeža',
})

describe('road events', () => {
  it('keeps what a driver would care about, once each', () => {
    const events = normaliseRoadEvents(
      [
        accident,
        accident,
        roadworks,
        // Same number as the roadworks, but in the other series: a different event.
        row(UNPLANNED, { id: 3703, event_enum: 'animalsOnTheRoad', restrictions: '[None]', linear_reference: 'P5 (17km)', status: 'ACTIVE' }),
        row(UNPLANNED, { id: 1, event_enum: 'UVIS', status: 'ACTIVE', linear_reference: 'P73 (16km-17km)' }),
        row(PLANNED, { id: 2, event_enum: 'massRestrictions', status: 'ACTIVE', linear_reference: 'V1078 (22.6km)' }),
        row(PLANNED, { id: 3, event_enum: 'roadClosed', status: 'PLANNED', linear_reference: 'V527 (1.86km)' }),
        row(PLANNED, { id: 4, event_enum: 'roadClosed', status: 'ACTIVE', date_to: '2026-10-01 15:00:00+00', linear_reference: 'V1 (1km)' }),
      ],
      T0,
    )
    expect(events.map((event) => [event.id, event.props.category])).toEqual([
      ['road-event:u21411', 'accident'],
      ['road-event:p3703', 'roadworks'],
      ['road-event:u3703', 'hazard'],
    ])
    expect(events[0]).toMatchObject({ kind: 'road-event', label: 'A7 (36.793km)', ts: Date.parse('2026-10-06T08:00:37.525Z') })
    expect(events[0].props.restrictions).toEqual(['lanesBlocked'])
    expect(events[1].props).toMatchObject({ speedLimit: 50, until: Date.parse('2026-10-16T14:00:00.100Z'), contractor: 'PA "Igate-Roadeks"' })
    expect(events[2].props.restrictions).toEqual([])
  })

  it('raises an alert for an accident only', () => {
    const alerts = roadAccidentRule.evaluate({
      now: T0,
      entities: (slot) => (slot === 'roads' ? normaliseRoadEvents([accident, roadworks], T0) : []),
      warnings: () => [],
      news: () => [],
      insideLatvia: () => true,
      tr: translate.bind(null, 'en'),
    })
    expect(alerts).toMatchObject([{ title: 'Road accident: A7 (36.793km)', detail: 'lanes blocked', entityId: 'road-event:u21411' }])
  })
})

describe('road cameras', () => {
  it('lists active cameras once, pointing at their frame on this server', () => {
    const camera = row('public.kafkamessages_camera', { id: 6, status: 'active', linear_reference: 'A5 (40km)' })
    const cameras = normaliseCameras([camera, camera, row('x', { id: 7, status: 'inactive', linear_reference: 'A8 (23.1km)' })], T0)
    expect(cameras).toMatchObject([{ id: 'camera:6', kind: 'camera', ts: T0, props: { road: 'A5 (40km)', image: '/api/camera/6' } }])
  })
})

describe('road events in Lithuania and Estonia', () => {
  // As served by restrictions.eismoinfo.lt and tarktee.ee on 2026-11-09, cut down.
  it('reads Via Lietuva: roadworks, closures and road damage at the middle of their stretch; weak bridges left to hauliers', () => {
    const list = [
      {
        _id: 'a1',
        type: 'CONSTRUCTION',
        subtype: null,
        description: 'Kelio rekonstrukcija. Darbų vykdytojas: UAB „Kelda“ tel. nr.: +370 620 53992',
        startTime: '2026-05-01T00:00:00+03:00',
        endTime: '2026-12-01T00:00:00+02:00',
        location: { polyline: '54.9 23.9 54.91 23.91 54.92 23.92', street: 'A1 Vilnius–Kaunas–Klaipėda 80.1-82.3km.' },
        restrictions: [{ restrictionType: 'speedLimit', value: 50 }, { restrictionType: 'SVKD', value: null }],
      },
      { _id: 'a2', type: 'HAZARD', subtype: 'damagedRoadSurface', startTime: '2026-01-01T00:00:00+02:00', endTime: null, location: { polyline: '55.1 24.1 55.2 24.2', street: '144 Jonava–Kėdainiai' }, restrictions: [{ restrictionType: 'roadClosed', value: null }] },
      { _id: 'a3', type: 'HAZARD', subtype: 'weakBridge', location: { polyline: '55 24 55.1 24.1' }, restrictions: [] },
      { _id: 'a4', type: 'CONSTRUCTION', endTime: '2026-01-01T00:00:00+02:00', location: { polyline: '55 24 55.1 24.1' } },
    ]
    const events = normaliseLtRestrictions(list, T0 + 40 * 86_400_000)
    expect(events).toMatchObject([
      { id: 'road-event:lta1', lon: 23.91, lat: 54.91, props: { category: 'roadworks', type: 'constructionWork', road: 'A1 Vilnius–Kaunas–Klaipėda 80.1-82.3km.', speedLimit: 50, contractor: 'UAB „Kelda“', restrictions: [], source: 'lt' } },
      { id: 'road-event:lta2', props: { category: 'closure', type: 'damagedRoadSurface', restrictions: ['roadClosed'] } },
    ])
  })

  it('reads Transpordiamet: closures as closures, the speed limit out of the text, the kilometres as the place', () => {
    const features = [
      {
        geometry: { type: 'Point', coordinates: [24.86, 59.37] },
        properties: { objectid: 745958, road_nr: 11330, road_name: 'Järveküla-Jüri tee', cause: 'CONSTRUCTION', effect: 'SPEED_LIMITED', extra_info: 'Viadukti ehitus. Kiirus piiratud 50 km/h.', contractor_organization: 'Verston Eesti OÜ', km_from: 7, km_to: 7.5, date_from: T0 - 1, date_to: T0 + 86_400_000 },
      },
      { geometry: { coordinates: [25.5, 58.9] }, properties: { objectid: 2, road_nr: 5, road_name: 'Pärnu-Rakvere-Sõmeru', cause: 'OTHER', effect: 'COMPLETE_CLOSURE', detour_comment: 'Ümbersõit mööda 15 teed', date_to: null } },
    ]
    expect(normaliseEeRestrictions(features, T0)).toMatchObject([
      { id: 'road-event:ee745958', lon: 24.86, lat: 59.37, props: { category: 'roadworks', type: 'constructionWork', road: '11330 Järveküla-Jüri tee', place: 'km 7–7.5', speedLimit: 50, contractor: 'Verston Eesti OÜ', restrictions: ['speedLimited'], source: 'ee' } },
      { props: { category: 'closure', road: '5 Pärnu-Rakvere-Sõmeru', detour: 'Ümbersõit mööda 15 teed', restrictions: ['roadClosed'] } },
    ])
  })

  it('reads Tallinn: a street closure permit and a dig both as roadworks, with the permit page', () => {
    const features = [
      { geometry: { coordinates: [24.768, 59.435] }, properties: { id: 1, name: 'Tänava ajutine sulgemine - Narva mnt 7', work_type: 'Tänava ajutine sulgemine', reason: 'Ehitustööd', proceeding_url: 'https://opinfo.tallinn.ee/menetlus/1', end_time: T0 + 1 } },
      { geometry: { coordinates: [24.75, 59.43] }, properties: { id: 2, name: 'Kaevetöö - F. R. Kreutzwaldi tn 14/1', work_type: 'Kaevetöö', end_time: T0 - 1 } },
      { geometry: { coordinates: [24.75, 59.43] }, properties: { id: 3, name: 'Avariikaevetöö - Pärnu mnt 10', work_type: 'Avariikaevetöö' } },
    ]
    expect(normaliseTallinnWorks(features, T0)).toMatchObject([
      { id: 'road-event:tln1', props: { category: 'roadworks', type: 'streetClosed', road: 'Narva mnt 7', place: 'Tallinn', notes: 'Ehitustööd', url: 'https://opinfo.tallinn.ee/menetlus/1', source: 'tallinn' } },
      { id: 'road-event:tln3', props: { category: 'roadworks', type: 'emergencyDigging', road: 'Pärnu mnt 10' } },
    ])
  })
})
