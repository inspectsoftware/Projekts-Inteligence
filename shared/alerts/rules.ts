import { type Aircraft, Flag } from '../entity'
import type { AlertRule } from './engine'

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

export const RULES: readonly AlertRule[] = [emergencyRule, militaryInsideRule, gpsInterferenceRule]
