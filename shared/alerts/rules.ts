import { type RoadEvent, plainWords } from '../adapters/roads'
import type { RadiationStation } from '../adapters/sensors'
import { NATO_FLAGS, type Ship, inLatvianWaters } from '../adapters/ships'
import { zoneState } from '../adapters/zones'
import { type AircraftRole, ROLE_LABEL } from '../data/aircraftRoles'
import { type Aircraft, Flag } from '../entity'
import { LEVEL_NAMES } from '../escalation'
import type { WarningLevel, Zone } from '../feeds'
import type { AlertRule, Severity } from './engine'

const SQUAWK_MEANING: Record<string, string> = {
  '7500': 'Squawk 7500: unlawful interference',
  '7600': 'Squawk 7600: radio failure',
  '7700': 'Squawk 7700: general emergency',
}

const has = (aircraft: Aircraft, flag: number) => (aircraft.flags & flag) !== 0

/** Fewer affected aircraft than this is treated as individual equipment trouble, not interference. */
const GPS_INTERFERENCE_MIN_AIRCRAFT = 3

const describeAirframe = (aircraft: Aircraft) =>
  [aircraft.props.type, aircraft.props.registration].filter(Boolean).join(' · ') || undefined

/** Any aircraft in range declaring an emergency, wherever it is. */
export const emergencyRule: AlertRule = {
  id: 'emergency',
  clearAfterMs: 60_000,
  evaluate: ({ entities }) =>
    (entities('aircraft') as Aircraft[])
      .filter((aircraft) => has(aircraft, Flag.EMERGENCY))
      .map((aircraft) => ({
        key: `emergency:${aircraft.id}`,
        severity: 'critical' as const,
        title: `Emergency: ${aircraft.label ?? aircraft.props.hex}`,
        detail: (aircraft.props.squawk && SQUAWK_MEANING[aircraft.props.squawk]) || 'Emergency status declared',
        at: { lon: aircraft.lon, lat: aircraft.lat },
        entityId: aircraft.id,
      })),
}

/** Military aircraft airborne inside the national border. */
export const militaryInsideRule: AlertRule = {
  id: 'military-inside',
  clearAfterMs: 45_000,
  evaluate: ({ entities, insideLatvia }) =>
    (entities('aircraft') as Aircraft[])
      .filter(
        (aircraft) =>
          has(aircraft, Flag.MIL) && !has(aircraft, Flag.ON_GROUND) && insideLatvia(aircraft.lon, aircraft.lat),
      )
      .map((aircraft) => ({
        key: `military:${aircraft.id}`,
        severity: 'warn' as const,
        title: `Military aircraft over Latvia: ${aircraft.label ?? aircraft.props.hex}`,
        detail: describeAirframe(aircraft),
        at: { lon: aircraft.lon, lat: aircraft.lat },
        entityId: aircraft.id,
      })),
}

/** The aircraft a larger operation is built around: the eyes, the ears and the fuel. */
const WATCHED_ROLES: ReadonlySet<AircraftRole> = new Set(['isr', 'aew', 'tanker'])

/** A reconnaissance, early-warning or tanker aircraft airborne anywhere in the region. Quiet: it is routine, but worth knowing. */
export const watchedAircraftRule: AlertRule = {
  id: 'watched-aircraft',
  // The far ones come from a list read every 30 s, and can be missing from it for a poll or two.
  clearAfterMs: 90_000,
  evaluate: ({ entities }) =>
    (entities('aircraft') as Aircraft[]).flatMap((aircraft) => {
      const { role } = aircraft.props
      if (!role || !WATCHED_ROLES.has(role) || !has(aircraft, Flag.MIL) || has(aircraft, Flag.ON_GROUND)) return []
      return [
        {
          key: `watched:${aircraft.id}`,
          severity: 'info' as const,
          title: `${ROLE_LABEL[role]} airborne: ${aircraft.label ?? aircraft.props.hex}`,
          detail: aircraft.props.description ?? describeAirframe(aircraft),
          at: { lon: aircraft.lon, lat: aircraft.lat },
          entityId: aircraft.id,
        },
      ]
    }),
}

/** Several aircraft over Latvia reporting degraded or lost GPS at once. */
export const gpsInterferenceRule: AlertRule = {
  id: 'gps-interference',
  // Aircraft cross the country in minutes; do not flap every time the count dips for one poll.
  clearAfterMs: 120_000,
  evaluate({ entities, insideLatvia }) {
    const affected = (entities('aircraft') as Aircraft[]).filter(
      (aircraft) =>
        has(aircraft, Flag.GPS_DEGRADED) && !has(aircraft, Flag.ON_GROUND) && insideLatvia(aircraft.lon, aircraft.lat),
    )
    if (affected.length < GPS_INTERFERENCE_MIN_AIRCRAFT) return []
    return [
      {
        key: 'gps-interference:latvia',
        severity: 'warn',
        title: 'GPS interference over Latvia',
        detail: `${affected.length} aircraft reporting degraded or lost GPS`,
        at: {
          lon: affected.reduce((sum, aircraft) => sum + aircraft.lon, 0) / affected.length,
          lat: affected.reduce((sum, aircraft) => sum + aircraft.lat, 0) / affected.length,
        },
      },
    ]
  },
}

const WARNING_SEVERITY: Record<WarningLevel, Severity> = { yellow: 'info', orange: 'warn', red: 'critical' }

const RIGA_TIME = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Riga',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

/** "Kurzeme, Zemgale +3" */
function summariseAreas(areas: readonly string[]): string {
  if (areas.length === 0) return 'Latvia'
  const shown = areas.slice(0, 2).join(', ')
  return areas.length > 2 ? `${shown} +${areas.length - 2}` : shown
}

/** Official weather warnings. Yellow ones are listed quietly; orange and red stand out. */
export const weatherWarningRule: AlertRule = {
  id: 'weather-warning',
  clearAfterMs: 10 * 60_000,
  evaluate: ({ warnings, now }) =>
    warnings().map((warning) => {
      const ring = warning.polygons[0]
      return {
        key: `weather:${warning.type}:${warning.level}:${warning.areas.join(';')}`,
        severity: WARNING_SEVERITY[warning.level],
        title: `${warning.type} warning (${warning.level})`,
        detail: `${summariseAreas(warning.areas)} · ${
          warning.onset > now ? `from ${RIGA_TIME.format(warning.onset)}` : `until ${RIGA_TIME.format(warning.expires)}`
        }`,
        // Sea-area warnings come without outlines, so there is nowhere to fly to.
        ...(ring && {
          at: {
            lon: ring.reduce((sum, point) => sum + point[0], 0) / ring.length,
            lat: ring.reduce((sum, point) => sum + point[1], 0) / ring.length,
          },
        }),
      }
    }),
}

/** One quiet alert for however many notices: restricted areas along the eastern border are activated most days. */
function zoneSummary(key: string, title: string, zones: readonly Zone[]) {
  if (zones.length === 0) return []
  const names = [...new Set(zones.map((zone) => zone.title))]
  const at = zones.find((zone) => zone.point)?.point
  return [
    {
      key,
      severity: 'info' as const,
      title,
      detail: zones.length === 1 ? `${zones[0].type} · ${names[0]}` : `${zones.length} notices · ${summariseAreas(names)}`,
      ...(at && { at: { lon: at[0], lat: at[1] } }),
    },
  ]
}

/**
 * Announced military activity where Latvia is: an exercise, firing or danger area that reaches
 * into its waters, or airspace activated for the military inside the Riga flight information region.
 */
export const militaryZoneRule: AlertRule = {
  id: 'military-zone',
  // The feeds are read every quarter of an hour; one late refresh should not withdraw the alert.
  clearAfterMs: 20 * 60_000,
  evaluate({ zones, now }) {
    // Only what is known to apply at this moment: an area between its daily hours, or with times that could not be read, stays quiet.
    const active = (zones?.() ?? []).filter((zone) => zone.military && zoneState(zone, now) === 'active')
    // ponytail: corners only, so an area that crosses Latvian waters with no corner inside them is missed. Test the edges if that ever matters.
    const sea = active.filter(
      (zone) => zone.kind === 'sea' && [...zone.rings.flat(), ...(zone.point ? [zone.point] : [])].some(([lon, lat]) => inLatvianWaters(lon, lat)),
    )
    // A Latvian NOTAM is about Latvian airspace by definition, outline or not. Interference notices have their own alert.
    const air = active.filter((zone) => zone.id.startsWith('air:lv:') && zone.type !== 'GNSS interference')
    return [
      ...zoneSummary('military-zone:sea', 'Exercise or danger area in Latvian waters', sea),
      ...zoneSummary('military-zone:air', 'Military airspace active over Latvia', air),
    ]
  },
}

/** What makes a vessel worth an alert, or null. Its nationality is the country digits of its MMSI and nothing more. */
function vesselConcern(ship: Ship): string | null {
  if ((ship.flags & Flag.SANCTIONED) !== 0) return 'Sanctioned vessel'
  if ((ship.flags & Flag.SHADOW_FLEET) !== 0) return 'Shadow-fleet vessel'
  const { service, flagState } = ship.props
  // A warship whose flag is not known is not assumed to be anybody's.
  return service === 'navy' && flagState && !NATO_FLAGS.has(flagState) ? `Naval vessel (${flagState})` : null
}

/**
 * Sanctioned and shadow-fleet vessels, and warships of states outside NATO: listed quietly while
 * they pass through the waters this map watches, and as a warning once inside Latvia's own.
 */
export const vesselRule: AlertRule = {
  id: 'vessel',
  clearAfterMs: 5 * 60_000,
  evaluate: ({ entities, insideLatvia }) =>
    (entities('ships') as Ship[]).flatMap((ship) => {
      const concern = vesselConcern(ship)
      if (!concern) return []
      // The sea out to the edge of the economic zone, or a harbour or river inside the land border.
      const inside = inLatvianWaters(ship.lon, ship.lat) || insideLatvia(ship.lon, ship.lat)
      const { props } = ship
      return [
        {
          key: `vessel:${ship.id}`,
          severity: inside ? ('warn' as const) : ('info' as const),
          title: `${concern}${inside ? ' in Latvian waters' : ''}: ${props.name ?? `MMSI ${props.mmsi}`}`,
          detail:
            [
              props.flagState,
              props.listedAs ? `listed as ${props.listedAs}` : null,
              props.destination ? `bound for ${props.destination}` : null,
            ]
              .filter(Boolean)
              .join(' · ') || undefined,
          at: { lon: ship.lon, lat: ship.lat },
          entityId: ship.id,
        },
      ]
    }),
}

/** Accidents on the state roads, as reported by the road authority. */
export const roadAccidentRule: AlertRule = {
  id: 'road-accident',
  clearAfterMs: 10 * 60_000,
  evaluate: ({ entities }) =>
    (entities('roads') as RoadEvent[])
      .filter((event) => event.props.category === 'accident')
      .map((event) => ({
        key: `road-accident:${event.id}`,
        severity: 'warn' as const,
        title: `Road accident: ${event.props.road}`,
        detail: event.props.restrictions.map(plainWords).join(', ') || undefined,
        at: { lon: event.lon, lat: event.lat },
        entityId: event.id,
      })),
}

/** Natural background is about 0.05 to 0.2 µSv/h; nothing in Latvia's record comes near this. */
export const RADIATION_ALERT_USVH = 0.3

/** A radiation monitor reading well above natural background. */
export const radiationRule: AlertRule = {
  id: 'radiation',
  clearAfterMs: 2 * 60 * 60_000,
  evaluate: ({ entities }) =>
    (entities('radiation') as RadiationStation[])
      .filter((station) => station.props.usvh >= RADIATION_ALERT_USVH)
      .map((station) => ({
        key: `radiation:${station.id}`,
        severity: 'critical' as const,
        title: `Raised radiation: ${station.props.name}`,
        detail: `${station.props.usvh.toFixed(2)} µSv/h, above normal background`,
        at: { lon: station.lon, lat: station.lat },
        entityId: station.id,
      })),
}

/** News goes stale as an alert long before it leaves the list. */
const NEWS_ALERT_FRESH_MS = 6 * 60 * 60_000

/** A fresh headline the scorer rates a serious incident or worse. Withdrawn once the story is six hours old. */
export const newsRule: AlertRule = {
  id: 'news',
  clearAfterMs: 60_000,
  evaluate: ({ news, now }) =>
    news()
      .filter((item) => item.escalation >= 3 && now - item.at < NEWS_ALERT_FRESH_MS)
      .map((item) => ({
        key: `news:${item.link}`,
        severity: item.escalation >= 4 ? ('critical' as const) : ('warn' as const),
        title: `${LEVEL_NAMES[item.escalation]}: ${item.title}`,
        detail: `Level ${item.escalation} · ${item.publisher}${item.corroboration > 0 ? ` · also reported by ${item.corroboration}` : ''}`,
      })),
}

export const RULES: readonly AlertRule[] = [
  radiationRule,
  newsRule,
  emergencyRule,
  militaryInsideRule,
  watchedAircraftRule,
  gpsInterferenceRule,
  vesselRule,
  roadAccidentRule,
  weatherWarningRule,
  militaryZoneRule,
]
