import { describe, expect, it } from 'vitest'
import { type RoadRow, normaliseCameras, normaliseRoadEvents } from '../../shared/adapters/roads'
import { roadAccidentRule } from '../../shared/alerts/rules'

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
      insideLatvia: () => true,
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
