import type { Ship } from '../../../../shared/adapters/ships'
import { ROLE_ORDER } from '../../../../shared/data/aircraftRoles'
import { type Aircraft, Flag } from '../../../../shared/entity'
import { bearing, haversine } from '../../../../shared/geo/sphere'
import { RIGA } from '../../../../shared/region'

interface Point {
  lon: number
  lat: number
}

const metresFromRiga = (point: Point) => haversine(RIGA.lon, RIGA.lat, point.lon, point.lat)

export const isAirborneMilitary = (aircraft: Aircraft) =>
  (aircraft.flags & Flag.MIL) !== 0 && (aircraft.flags & Flag.ON_GROUND) === 0

/** Military aircraft in the air: by role, the ones that say most first, and nearest Rīga first within a role. Unknown roles come last. */
export function airborneMilitary(aircraft: readonly Aircraft[]): Aircraft[] {
  const rank = (a: Aircraft) => (a.props.role ? ROLE_ORDER.indexOf(a.props.role) : ROLE_ORDER.length)
  return aircraft.filter(isAirborneMilitary).sort((a, b) => rank(a) - rank(b) || metresFromRiga(a) - metresFromRiga(b))
}

const LISTED = Flag.SANCTIONED | Flag.SHADOW_FLEET

/**
 * The vessels worth listing, in two groups: states' own (navies before coast guards), then those
 * on a list (sanctioned before shadow fleet only). Nearest Rīga first within each. A sanctioned
 * warship is a warship first.
 */
export function vesselsOfInterest(ships: readonly Ship[]): { state: Ship[]; listed: Ship[] } {
  const nearest = (a: Ship, b: Ship) => metresFromRiga(a) - metresFromRiga(b)
  const navyFirst = (ship: Ship) => (ship.props.service === 'navy' ? 0 : 1)
  const sanctionedFirst = (ship: Ship) => ((ship.flags & Flag.SANCTIONED) !== 0 ? 0 : 1)
  return {
    state: ships.filter((ship) => ship.props.service !== null).sort((a, b) => navyFirst(a) - navyFirst(b) || nearest(a, b)),
    listed: ships
      .filter((ship) => ship.props.service === null && (ship.flags & LISTED) !== 0)
      .sort((a, b) => sanctionedFirst(a) - sanctionedFirst(b) || nearest(a, b)),
  }
}

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const

/** "312 km SW of Rīga": where something is for a reader who knows where Rīga is. */
export function fromRiga(point: Point): string {
  const compass = COMPASS[Math.round(bearing(RIGA.lon, RIGA.lat, point.lon, point.lat) / 45) % 8]
  return `${Math.round(metresFromRiga(point) / 1000)} km ${compass} of Rīga`
}
