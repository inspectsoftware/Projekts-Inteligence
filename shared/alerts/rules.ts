import { type RoadEvent, plainWords } from '../adapters/roads'
import type { RadiationStation } from '../adapters/sensors'
import { NATO_FLAGS, type Ship, inLatvianWaters } from '../adapters/ships'
import { zoneState } from '../adapters/zones'
import { type AircraftRole, ROLE_LABEL } from '../data/aircraftRoles'
import { type Aircraft, Flag } from '../entity'
import { LEVEL_NAMES } from '../escalation'
import type { WarningLevel, Zone } from '../feeds'
import { msg } from '../i18n'
import type { AlertInput, AlertRule, Severity } from './engine'

type Tr = AlertInput['tr']

const SQUAWK_MEANING: Record<string, string> = {
  '7500': msg('Squawk 7500: unlawful interference'),
  '7600': msg('Squawk 7600: radio failure'),
  '7700': msg('Squawk 7700: general emergency'),
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
  evaluate: ({ entities, tr }) =>
    (entities('aircraft') as Aircraft[])
      .filter((aircraft) => has(aircraft, Flag.EMERGENCY))
      .map((aircraft) => ({
        key: `emergency:${aircraft.id}`,
        severity: 'critical' as const,
        title: tr('Emergency: {name}', { name: aircraft.label ?? aircraft.props.hex }),
        detail: tr((aircraft.props.squawk && SQUAWK_MEANING[aircraft.props.squawk]) || msg('Emergency status declared')),
        at: { lon: aircraft.lon, lat: aircraft.lat },
        entityId: aircraft.id,
      })),
}

/** Military aircraft airborne inside the national border. */
export const militaryInsideRule: AlertRule = {
  id: 'military-inside',
  clearAfterMs: 45_000,
  evaluate: ({ entities, insideLatvia, tr }) =>
    (entities('aircraft') as Aircraft[])
      .filter(
        (aircraft) =>
          has(aircraft, Flag.MIL) && !has(aircraft, Flag.ON_GROUND) && insideLatvia(aircraft.lon, aircraft.lat),
      )
      .map((aircraft) => ({
        key: `military:${aircraft.id}`,
        severity: 'warn' as const,
        title: tr('Military aircraft over Latvia: {name}', { name: aircraft.label ?? aircraft.props.hex }),
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
  evaluate: ({ entities, tr }) =>
    (entities('aircraft') as Aircraft[]).flatMap((aircraft) => {
      const { role } = aircraft.props
      if (!role || !WATCHED_ROLES.has(role) || !has(aircraft, Flag.MIL) || has(aircraft, Flag.ON_GROUND)) return []
      return [
        {
          key: `watched:${aircraft.id}`,
          severity: 'info' as const,
          title: tr('{role} airborne: {name}', { role: tr(ROLE_LABEL[role]), name: aircraft.label ?? aircraft.props.hex }),
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
  evaluate({ entities, insideLatvia, tr }) {
    const affected = (entities('aircraft') as Aircraft[]).filter(
      (aircraft) =>
        has(aircraft, Flag.GPS_DEGRADED) && !has(aircraft, Flag.ON_GROUND) && insideLatvia(aircraft.lon, aircraft.lat),
    )
    if (affected.length < GPS_INTERFERENCE_MIN_AIRCRAFT) return []
    return [
      {
        key: 'gps-interference:latvia',
        severity: 'warn',
        title: tr('GPS interference over Latvia'),
        detail: tr('Aircraft reporting degraded or lost GPS: {n}', { n: affected.length }),
        at: {
          lon: affected.reduce((sum, aircraft) => sum + aircraft.lon, 0) / affected.length,
          lat: affected.reduce((sum, aircraft) => sum + aircraft.lat, 0) / affected.length,
        },
      },
    ]
  },
}

const WARNING_SEVERITY: Record<WarningLevel, Severity> = { yellow: 'info', orange: 'warn', red: 'critical' }

/** The colours as words, as a warning's title names them. */
const WARNING_LEVEL_NAME: Record<WarningLevel, string> = { yellow: msg('yellow'), orange: msg('orange'), red: msg('red') }

/** "Wed 01:00", in Riga's time and the reader's language. */
const rigaTime = (locale = 'en-GB') =>
  new Intl.DateTimeFormat(locale, { timeZone: 'Europe/Riga', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false })

/** "Kurzeme, Zemgale +3" */
function summariseAreas(areas: readonly string[], tr: Tr): string {
  if (areas.length === 0) return tr('Latvia')
  const shown = areas.slice(0, 2).join(', ')
  return areas.length > 2 ? `${shown} +${areas.length - 2}` : shown
}

/** Official weather warnings. Yellow ones are listed quietly; orange and red stand out. */
export const weatherWarningRule: AlertRule = {
  id: 'weather-warning',
  clearAfterMs: 10 * 60_000,
  evaluate({ warnings, now, tr, locale }) {
    const time = rigaTime(locale)
    return warnings().map((warning) => {
      const ring = warning.polygons[0]
      return {
        key: `weather:${warning.type}:${warning.level}:${warning.areas.join(';')}`,
        severity: WARNING_SEVERITY[warning.level],
        title: tr('{type} warning ({level})', { type: tr(warning.type), level: tr(WARNING_LEVEL_NAME[warning.level]) }),
        detail: `${summariseAreas(warning.areas, tr)} · ${
          warning.onset > now ? tr('from {time}', { time: time.format(warning.onset) }) : tr('until {time}', { time: time.format(warning.expires) })
        }`,
        // Sea-area warnings come without outlines, so there is nowhere to fly to.
        ...(ring && {
          at: {
            lon: ring.reduce((sum, point) => sum + point[0], 0) / ring.length,
            lat: ring.reduce((sum, point) => sum + point[1], 0) / ring.length,
          },
        }),
      }
    })
  },
}

/** One quiet alert for however many notices: restricted areas along the eastern border are activated most days. */
function zoneSummary(key: string, title: string, zones: readonly Zone[], tr: Tr) {
  if (zones.length === 0) return []
  const names = [...new Set(zones.map((zone) => zone.title))]
  const at = zones.find((zone) => zone.point)?.point
  return [
    {
      key,
      severity: 'info' as const,
      title,
      detail: zones.length === 1 ? `${tr(zones[0].type)} · ${names[0]}` : `${tr('Notices: {n}', { n: zones.length })} · ${summariseAreas(names, tr)}`,
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
  evaluate({ zones, now, tr }) {
    // Only what is known to apply at this moment: an area between its daily hours, or with times that could not be read, stays quiet.
    const active = (zones?.() ?? []).filter((zone) => zone.military && zoneState(zone, now) === 'active')
    // ponytail: corners only, so an area that crosses Latvian waters with no corner inside them is missed. Test the edges if that ever matters.
    const sea = active.filter(
      (zone) => zone.kind === 'sea' && [...zone.rings.flat(), ...(zone.point ? [zone.point] : [])].some(([lon, lat]) => inLatvianWaters(lon, lat)),
    )
    // A Latvian NOTAM is about Latvian airspace by definition, outline or not. Interference notices have their own alert.
    const air = active.filter((zone) => zone.id.startsWith('air:lv:') && zone.type !== 'GNSS interference')
    return [
      ...zoneSummary('military-zone:sea', tr('Exercise or danger area in Latvian waters'), sea, tr),
      ...zoneSummary('military-zone:air', tr('Military airspace active over Latvia'), air, tr),
    ]
  },
}

/**
 * The alert's title when a vessel is worth one, or null. Its nationality is the country digits of
 * its MMSI and nothing more. Whole sentences, so that a translation can order its words freely.
 */
function vesselTitle(ship: Ship, inside: boolean, tr: Tr): string | null {
  const { service, flagState: flag } = ship.props
  const name = ship.props.name ?? `MMSI ${ship.props.mmsi}`
  if ((ship.flags & Flag.SANCTIONED) !== 0) return inside ? tr('Sanctioned vessel in Latvian waters: {name}', { name }) : tr('Sanctioned vessel: {name}', { name })
  if ((ship.flags & Flag.SHADOW_FLEET) !== 0) return inside ? tr('Shadow-fleet vessel in Latvian waters: {name}', { name }) : tr('Shadow-fleet vessel: {name}', { name })
  // A warship whose flag is not known is not assumed to be anybody's.
  if (service !== 'navy' || !flag || NATO_FLAGS.has(flag)) return null
  return inside ? tr('Naval vessel ({flag}) in Latvian waters: {name}', { flag, name }) : tr('Naval vessel ({flag}): {name}', { flag, name })
}

/**
 * Sanctioned and shadow-fleet vessels, and warships of states outside NATO: listed quietly while
 * they pass through the waters this map watches, and as a warning once inside Latvia's own.
 */
export const vesselRule: AlertRule = {
  id: 'vessel',
  clearAfterMs: 5 * 60_000,
  evaluate: ({ entities, insideLatvia, tr }) =>
    (entities('ships') as Ship[]).flatMap((ship) => {
      // The sea out to the edge of the economic zone, or a harbour or river inside the land border.
      const inside = inLatvianWaters(ship.lon, ship.lat) || insideLatvia(ship.lon, ship.lat)
      const title = vesselTitle(ship, inside, tr)
      if (!title) return []
      const { props } = ship
      return [
        {
          key: `vessel:${ship.id}`,
          severity: inside ? ('warn' as const) : ('info' as const),
          title,
          detail:
            [
              props.flagState,
              props.listedAs ? tr('listed as {list}', { list: props.listedAs }) : null,
              props.destination ? tr('bound for {port}', { port: props.destination }) : null,
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
  evaluate: ({ entities, tr }) =>
    (entities('roads') as RoadEvent[])
      .filter((event) => event.props.category === 'accident')
      .map((event) => ({
        key: `road-accident:${event.id}`,
        severity: 'warn' as const,
        title: tr('Road accident: {road}', { road: event.props.road }),
        detail: event.props.restrictions.map((restriction) => tr(plainWords(restriction))).join(', ') || undefined,
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
  evaluate: ({ entities, tr }) =>
    (entities('radiation') as RadiationStation[])
      .filter((station) => station.props.usvh >= RADIATION_ALERT_USVH)
      .map((station) => ({
        key: `radiation:${station.id}`,
        severity: 'critical' as const,
        title: tr('Raised radiation: {name}', { name: station.props.name }),
        detail: tr('{value} µSv/h, above normal background', { value: station.props.usvh.toFixed(2) }),
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
  evaluate: ({ news, now, tr }) =>
    news()
      .filter((item) => item.escalation >= 3 && now - item.at < NEWS_ALERT_FRESH_MS)
      .map((item) => ({
        key: `news:${item.link}`,
        severity: item.escalation >= 4 ? ('critical' as const) : ('warn' as const),
        title: `${tr(LEVEL_NAMES[item.escalation])}: ${item.title}`,
        detail: [tr('Level {level}', { level: item.escalation }), item.publisher, ...(item.corroboration > 0 ? [tr('also reported by {n}', { n: item.corroboration })] : [])].join(' · '),
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
