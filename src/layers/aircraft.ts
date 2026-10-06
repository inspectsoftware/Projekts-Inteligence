import type { Color } from '@deck.gl/core'
import { IconLayer, PathLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers'
import { KEY_ROLES, ROLE_LABEL } from '../../shared/data/aircraftRoles'
import { type Aircraft, type Entity, FEET_TO_M, FPM_TO_MS, Flag, KNOTS_TO_MS } from '../../shared/entity'
import { formatLat, formatLon, formatMgrs } from '../lib/coords'
import { formatAge, formatBearing, formatInt } from '../lib/format'
import { type IconName, getIconAtlas } from '../map/icons'
import { positionAt } from '../map/motion'
import { insideLatvia } from '../runtime/border'
import { getEntities } from '../runtime/entityStore'
import { getTrail } from '../runtime/trails'
import type { InspectorModel, LayerDef } from './types'

const CIVIL: Color = [164, 232, 255]
const MILITARY: Color = [255, 138, 61]
const EMERGENCY: Color = [255, 77, 94]
const GPS_DEGRADED: Color = [255, 214, 92]
const ON_GROUND: Color = [110, 135, 150]
const SELECTED: Color = [255, 255, 255]
const HALO: Color = [4, 7, 10, 215]

const LABEL_FONT = '"JetBrains Mono Variable", ui-monospace, monospace'
const TURBOPROP = /^(AT[4-7]|DH8|SF34|SB20|B350|BE20|BE9|PC12|C208|L410|SW4|JS[34]|D228|D328|AN2[4-6]|F50)/

const is = (a: Entity, flag: number) => (a.flags & flag) !== 0

function iconFor(a: Aircraft): IconName {
  const { category, type } = a.props
  if (category === 'A7') return 'heli'
  if (category === 'A6') return 'fast'
  if (category?.startsWith('C')) return 'dot'
  if (category === 'A1' || category?.startsWith('B') || (type && TURBOPROP.test(type))) return 'prop'
  return 'jet'
}

function sizeFor(a: Aircraft): number {
  switch (a.props.category) {
    case 'A5':
      return 27
    case 'A4':
    case 'A3':
      return 23
    case 'A1':
      return 16
    case 'A7':
      return 19
    default:
      return a.props.category?.startsWith('C') ? 11 : 20
  }
}

function colorFor(a: Aircraft, selectedId: string | null, hoveredId: string | null): Color {
  if (a.id === selectedId || a.id === hoveredId) return SELECTED
  if (is(a, Flag.EMERGENCY)) return EMERGENCY
  if (is(a, Flag.MIL)) return MILITARY
  if (is(a, Flag.GPS_DEGRADED)) return GPS_DEGRADED
  if (is(a, Flag.ON_GROUND)) return ON_GROUND
  return CIVIL
}

/** Flagged aircraft keep their label even when zoomed far out. */
const isNotable = (a: Aircraft) => is(a, Flag.EMERGENCY | Flag.MIL)

function describe(entity: Entity, now: number): InspectorModel {
  const a = entity as Aircraft
  const { props } = a
  const badges: InspectorModel['badges'] = []
  if (is(a, Flag.EMERGENCY)) badges.push({ text: `Emergency ${props.squawk ?? ''}`.trim(), tone: 'danger' })
  if (is(a, Flag.MIL)) badges.push({ text: 'Military', tone: 'mil' })
  if (is(a, Flag.GPS_DEGRADED)) badges.push({ text: props.gpsLost ? 'GPS lost' : 'GPS degraded', tone: 'warn' })
  if (is(a, Flag.ON_GROUND)) badges.push({ text: 'On ground', tone: 'info' })

  const rows: InspectorModel['rows'] = []
  if (is(a, Flag.MIL)) {
    // Read off the type designator, so it is what such an airframe usually does, not what this one is doing.
    rows.push({ label: 'Role (from type)', value: props.role ? ROLE_LABEL[props.role] : 'Military, role unknown' })
  }
  if (props.description) rows.push({ label: 'Airframe', value: props.description })
  if (props.operator) rows.push({ label: 'Operator', value: props.operator })
  if (is(a, Flag.ON_GROUND)) rows.push({ label: 'Altitude', value: 'On ground' })
  else if (a.alt !== undefined) {
    rows.push({ label: 'Altitude', value: `${formatInt(a.alt / FEET_TO_M)} ft · ${formatInt(a.alt)} m` })
  }
  if (a.spd !== undefined) {
    rows.push({ label: 'Ground speed', value: `${formatInt(a.spd / KNOTS_TO_MS)} kt · ${formatInt(a.spd * 3.6)} km/h` })
  }
  if (a.trk !== undefined) rows.push({ label: 'Track', value: formatBearing(a.trk) })
  if (a.vr !== undefined && Math.abs(a.vr) > 0.3) {
    const fpm = Math.round(a.vr / FPM_TO_MS / 50) * 50
    rows.push({ label: 'Vertical rate', value: `${fpm > 0 ? '+' : '−'}${formatInt(Math.abs(fpm))} ft/min` })
  }
  if (props.squawk) rows.push({ label: 'Squawk', value: props.squawk })
  rows.push({
    label: 'Position from',
    value: { adsb: 'ADS-B (own GPS)', mlat: 'Multilateration', tisb: 'TIS-B relay', other: 'Other' }[props.source],
  })
  rows.push({
    label: 'GPS integrity',
    value: !props.reportsIntegrity
      ? 'Not reported by this transponder'
      : `NIC ${props.nic ?? '–'} · NACp ${props.nacP ?? '–'}`,
  })
  rows.push({ label: 'Position', value: `${formatLat(a.lat)}  ${formatLon(a.lon)}` })
  rows.push({ label: 'MGRS', value: formatMgrs(a.lon, a.lat) })
  rows.push({ label: 'Last fix', value: formatAge(now - a.ts) })
  rows.push({ label: 'ICAO address', value: props.hex.toUpperCase() })

  return {
    kicker: 'Aircraft',
    title: props.callsign ?? props.registration ?? props.hex.toUpperCase(),
    subtitle: [props.registration, props.type].filter(Boolean).join(' · ') || undefined,
    badges,
    rows,
    links: [
      { label: 'Live track (adsb.fi)', href: `https://globe.adsb.fi/?icao=${props.hex}` },
      { label: 'Airframe (Planespotters)', href: `https://www.planespotters.net/hex/${props.hex.toUpperCase()}` },
    ],
  }
}

export const aircraftLayer: LayerDef = {
  id: 'aircraft',
  group: 'air',
  label: 'Aircraft',
  hint: 'Live ADS-B and multilateration positions within 250 nm, refreshed every 10 s, plus military aircraft across the wider Baltic region every 30 s',
  defaultOn: true,
  swatch: '#a4e8ff',
  feeds: ['aircraft'],
  describes: ['aircraft'],
  describe,

  stats(entities) {
    const count = (flag: number) => entities.reduce((n, e) => n + (is(e, flag) ? 1 : 0), 0)
    const overLatvia = entities.filter((e) => !is(e, Flag.ON_GROUND) && insideLatvia(e.lon, e.lat)).length
    const roles = (entities as Aircraft[]).map((a) => a.props.role)
    return [
      { label: 'over Latvia', value: overLatvia, tone: 'info' },
      { label: 'Military', value: count(Flag.MIL), tone: 'mil' },
      // One number per role worth noticing; the layer list leaves out the zeros.
      ...[...KEY_ROLES].map((role) => ({
        label: ROLE_LABEL[role],
        value: roles.filter((r) => r === role).length,
        tone: 'mil' as const,
      })),
      { label: 'GPS degraded', value: count(Flag.GPS_DEGRADED), tone: 'warn' },
      { label: 'Emergency', value: count(Flag.EMERGENCY), tone: 'danger' },
    ]
  },

  build({ now, zoom, selectedId, hoveredId, fontsReady }) {
    const data = getEntities('aircraft') as Aircraft[]
    const { canvas, mapping } = getIconAtlas()
    // deck.gl accepts a canvas here at runtime; its typings only list URLs and textures.
    const iconAtlas = canvas as unknown as string
    const scale = Math.min(1.5, Math.max(0.75, 0.75 + (zoom - 5.5) * 0.11))
    const highlight = `${selectedId}|${hoveredId}`
    const allLabels = zoom >= 5.8
    const selected = data.filter((a) => a.id === selectedId)

    const icons = {
      data,
      iconAtlas,
      iconMapping: mapping,
      getIcon: iconFor,
      getPosition: (a: Aircraft) => positionAt(a, now),
      // Icons point north; deck.gl rotates counter-clockwise, headings run clockwise.
      getAngle: (a: Aircraft) => -(a.trk ?? 0),
      sizeUnits: 'pixels' as const,
      sizeScale: scale,
      // Lie flat on the map, so headings stay true when the camera is rotated or tilted.
      billboard: false,
      updateTriggers: { getPosition: now },
    }

    return [
      new PathLayer<Aircraft>({
        id: 'aircraft-trails',
        data,
        getPath: (a) => [...(getTrail(a.id)?.path ?? []), positionAt(a, now)],
        getColor: (a) => {
          const [r, g, b] = colorFor(a, selectedId, null)
          return [r, g, b, a.id === selectedId ? 230 : 70]
        },
        getWidth: (a) => (a.id === selectedId ? 2 : 1.2),
        widthUnits: 'pixels',
        jointRounded: true,
        capRounded: true,
        updateTriggers: { getPath: now, getColor: selectedId, getWidth: selectedId },
      }),
      new IconLayer<Aircraft>({
        ...icons,
        id: 'aircraft-halo',
        getSize: (a) => sizeFor(a) + 6,
        getColor: HALO,
      }),
      new IconLayer<Aircraft>({
        ...icons,
        id: 'aircraft',
        pickable: true,
        getSize: sizeFor,
        getColor: (a) => colorFor(a, selectedId, hoveredId),
        updateTriggers: { ...icons.updateTriggers, getColor: highlight },
      }),
      new ScatterplotLayer<Aircraft>({
        id: 'aircraft-selection',
        data: selected,
        getPosition: (a) => positionAt(a, now),
        getRadius: 19,
        radiusUnits: 'pixels',
        radiusScale: scale,
        filled: false,
        stroked: true,
        getLineColor: [79, 214, 255, 230],
        getLineWidth: 1.5,
        lineWidthUnits: 'pixels',
        updateTriggers: { getPosition: now },
      }),
      new TextLayer<Aircraft>({
        id: 'aircraft-labels',
        data,
        visible: fontsReady,
        getText: (a) => a.label ?? '',
        getPosition: (a) => positionAt(a, now),
        getSize: (a) => (allLabels || isNotable(a) || a.id === selectedId || a.id === hoveredId ? 11 : 0),
        getColor: (a) => {
          const [r, g, b] = colorFor(a, selectedId, hoveredId)
          return [r, g, b, 235]
        },
        getPixelOffset: [13, -10],
        getTextAnchor: 'start',
        getAlignmentBaseline: 'center',
        fontFamily: LABEL_FONT,
        fontWeight: 500,
        fontSettings: { sdf: true },
        outlineWidth: 2.5,
        outlineColor: [4, 7, 10, 255],
        characterSet: 'auto',
        updateTriggers: { getPosition: now, getSize: `${allLabels}|${highlight}`, getColor: highlight },
      }),
    ]
  },
}
