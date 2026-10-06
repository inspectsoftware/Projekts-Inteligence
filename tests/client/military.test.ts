import { describe, expect, it } from 'vitest'
import type { Ship } from '../../shared/adapters/ships'
import type { AircraftRole } from '../../shared/data/aircraftRoles'
import { type Aircraft, Flag } from '../../shared/entity'
import { airborneMilitary, fromRiga, vesselsOfInterest } from '../../src/ui/windows/military/order'

const NEAR = { lon: 24.3, lat: 57.0 }
const FAR = { lon: 18.0, lat: 54.5 }

function aircraft(hex: string, role: AircraftRole | null, at = NEAR, flags: number = Flag.MIL): Aircraft {
  return {
    id: `aircraft:${hex}`,
    kind: 'aircraft',
    ...at,
    ts: 0,
    flags,
    props: {
      hex,
      callsign: null,
      registration: null,
      type: null,
      category: null,
      squawk: null,
      source: 'adsb',
      nic: null,
      nacP: null,
      gpsLost: false,
      reportsIntegrity: true,
      role,
      description: null,
      operator: null,
    },
  }
}

function ship(mmsi: number, service: Ship['props']['service'], flags = 0, at = NEAR): Ship {
  return {
    id: `ship:${mmsi}`,
    kind: 'ship',
    ...at,
    ts: 0,
    flags,
    props: {
      mmsi,
      imo: null,
      name: null,
      callSign: null,
      type: 'other',
      destination: null,
      heading: null,
      status: null,
      flagState: null,
      service,
      listedAs: null,
      source: 'digitraffic',
    },
  }
}

describe('Air tab order', () => {
  it('lists the roles that say most first, then the nearest, and unknown roles last', () => {
    const listed = airborneMilitary([
      aircraft('unknown', null),
      aircraft('fighter', 'fighter'),
      aircraft('tanker-far', 'tanker', FAR),
      aircraft('transport', 'transport'),
      aircraft('awacs', 'aew', FAR),
      aircraft('tanker-near', 'tanker'),
      aircraft('isr', 'isr', FAR),
      aircraft('bomber', 'bomber'),
    ])
    expect(listed.map((a) => a.props.hex)).toEqual([
      'isr',
      'awacs',
      'tanker-near',
      'tanker-far',
      'bomber',
      'fighter',
      'transport',
      'unknown',
    ])
  })

  it('leaves out civil aircraft and military ones on the ground', () => {
    const listed = airborneMilitary([
      aircraft('airliner', null, NEAR, 0),
      aircraft('parked', 'tanker', NEAR, Flag.MIL | Flag.ON_GROUND),
      aircraft('flying', 'helicopter'),
    ])
    expect(listed.map((a) => a.props.hex)).toEqual(['flying'])
  })
})

describe('Sea tab order', () => {
  it('lists states’ own vessels and listed vessels apart, the weightier kind and the nearer vessel first', () => {
    const { state, listed } = vesselsOfInterest([
      ship(1, null),
      ship(2, 'government'),
      ship(3, 'navy', 0, FAR),
      ship(4, 'navy'),
      ship(5, null, Flag.SHADOW_FLEET),
      ship(6, null, Flag.SANCTIONED | Flag.SHADOW_FLEET, FAR),
      ship(7, null, Flag.SANCTIONED),
      // A sanctioned warship is listed once, as a warship.
      ship(8, 'navy', Flag.SANCTIONED, { lon: 30, lat: 60 }),
    ])
    expect(state.map((s) => s.props.mmsi)).toEqual([4, 3, 8, 2])
    expect(listed.map((s) => s.props.mmsi)).toEqual([7, 6, 5])
  })
})

describe('fromRiga', () => {
  it('gives distance and compass point from Rīga', () => {
    expect(fromRiga({ lon: 25.28, lat: 54.687 })).toBe('262 km S of Rīga') // Vilnius
    expect(fromRiga({ lon: 24.75, lat: 59.44 })).toBe('279 km N of Rīga') // Tallinn
    expect(fromRiga({ lon: 21.01, lat: 56.51 })).toBe('195 km W of Rīga') // Liepāja
    expect(fromRiga({ lon: 26.53, lat: 55.875 })).toBe('191 km SE of Rīga') // Daugavpils
  })
})
